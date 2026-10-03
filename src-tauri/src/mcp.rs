//! AI assistants talk to Avero over MCP (Model Context Protocol): a small
//! HTTP server on this Mac only (127.0.0.1), off until switched on in the
//! settings. It answers `initialize` and `ping` itself and hands every other
//! request (tool list, tool calls) to the window, which knows the board, and
//! waits for its answer.
//!
//! Claude Code connects straight to `http://127.0.0.1:<port>/mcp`; Claude
//! Desktop starts `Avero --mcp`, which bridges stdin/stdout to that address
//! (see `bridge`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

/// MCP protocol versions this server speaks, newest first.
const VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
/// How long a tool call may take in the window.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(20);
/// Requests larger than this are refused.
const MAX_BODY: usize = 4 * 1024 * 1024;

type Pending = Arc<Mutex<HashMap<u64, Sender<Value>>>>;

/// The running server and the calls waiting for the window.
#[derive(Default)]
pub struct Mcp {
    running: Mutex<Option<Running>>,
    pending: Pending,
    next: Arc<AtomicU64>,
}

struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
}

/// Something that forwards a request to the window: (call id, JSON-RPC request).
pub type Forward = Arc<dyn Fn(u64, Value) + Send + Sync>;

impl Mcp {
    /// Starts listening on `port` (or keeps the running server on that port).
    pub fn start(&self, port: u16, forward: Forward) -> Result<(), String> {
        let mut running = self.running.lock().map_err(|e| e.to_string())?;
        if let Some(r) = running.as_ref() {
            if r.port == port {
                return Ok(());
            }
            r.stop.store(true, Ordering::SeqCst);
            // Wake the old accept loop so it sees the stop flag.
            let _ = TcpStream::connect(("127.0.0.1", r.port));
        }
        let listener =
            TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("127.0.0.1:{port}: {e}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let (pending, next, flag) = (self.pending.clone(), self.next.clone(), stop.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if flag.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let (pending, next, forward) = (pending.clone(), next.clone(), forward.clone());
                std::thread::spawn(move || {
                    let _ = serve(stream, &pending, &next, &forward);
                });
            }
        });
        *running = Some(Running { port, stop });
        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut running) = self.running.lock() {
            if let Some(r) = running.take() {
                r.stop.store(true, Ordering::SeqCst);
                let _ = TcpStream::connect(("127.0.0.1", r.port));
            }
        }
    }

    pub fn port(&self) -> Option<u16> {
        self.running.lock().ok().and_then(|r| r.as_ref().map(|r| r.port))
    }

    /// The window's answer to call `id`.
    pub fn reply(&self, id: u64, answer: Value) {
        if let Some(tx) = self.pending.lock().ok().and_then(|mut p| p.remove(&id)) {
            let _ = tx.send(answer);
        }
    }
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return Err("request too large".into());
    }
    let mut body = vec![0; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok(Request { method, path, headers, body })
}

fn respond(
    stream: &mut TcpStream,
    status: &str,
    body: Option<&Value>,
    extra: &[(&str, &str)],
) -> std::io::Result<()> {
    let text = body.map(|b| b.to_string()).unwrap_or_default();
    let mut head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n", text.len());
    if body.is_some() {
        head.push_str("Content-Type: application/json\r\n");
    }
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(text.as_bytes())?;
    stream.flush()
}

/// Requests from web pages are refused: only local programs may ask
/// (a page could otherwise reach 127.0.0.1 from the browser).
fn origin_allowed(headers: &HashMap<String, String>) -> bool {
    match headers.get("origin") {
        None => true,
        Some(o) => o == "null" || o.starts_with("http://127.0.0.1") || o.starts_with("http://localhost"),
    }
}

fn serve(
    mut stream: TcpStream,
    pending: &Pending,
    next: &AtomicU64,
    forward: &Forward,
) -> Result<(), String> {
    let req = read_request(&mut stream)?;
    let path = req.path.split('?').next().unwrap_or("");
    if path != "/mcp" && path != "/" {
        return respond(&mut stream, "404 Not Found", None, &[]).map_err(|e| e.to_string());
    }
    if !origin_allowed(&req.headers) {
        return respond(&mut stream, "403 Forbidden", None, &[]).map_err(|e| e.to_string());
    }
    match req.method.as_str() {
        "POST" => {}
        // No server-to-client stream and no sessions to end.
        "DELETE" => return respond(&mut stream, "200 OK", None, &[]).map_err(|e| e.to_string()),
        _ => {
            return respond(&mut stream, "405 Method Not Allowed", None, &[("Allow", "POST")])
                .map_err(|e| e.to_string())
        }
    }
    let message: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(e) => {
            let err =
                json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": e.to_string()}});
            return respond(&mut stream, "400 Bad Request", Some(&err), &[]).map_err(|e| e.to_string());
        }
    };
    let answer = handle(message, pending, next, forward);
    match answer {
        Some(a) => respond(&mut stream, "200 OK", Some(&a), &[]),
        // Notifications and responses get no body.
        None => respond(&mut stream, "202 Accepted", None, &[]),
    }
    .map_err(|e| e.to_string())
}

/// One JSON-RPC message (or a batch) to its answer; None for notifications.
pub fn handle(message: Value, pending: &Pending, next: &AtomicU64, forward: &Forward) -> Option<Value> {
    if let Value::Array(batch) = message {
        let out: Vec<Value> = batch.into_iter().filter_map(|m| handle(m, pending, next, forward)).collect();
        return (!out.is_empty()).then_some(Value::Array(out));
    }
    let id = message.get("id").cloned()?;
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let ok = |result: Value| json!({"jsonrpc": "2.0", "id": id, "result": result});
    match method {
        "initialize" => {
            let asked = message.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = VERSIONS.iter().find(|v| **v == asked).copied().unwrap_or(VERSIONS[0]);
            Some(ok(json!({
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": false}},
                "serverInfo": {"name": "avero", "title": "Avero Boardview", "version": env!("CARGO_PKG_VERSION")},
                "instructions": "Avero is a boardview for electronics repair. Tools read the board open in Avero (parts, nets, pins, signal paths, measurements, fault-finding steps) and can select things in Avero to show them to the user."
            })))
        }
        "ping" => Some(ok(json!({}))),
        _ => {
            // Everything else is the window's: tools/list, tools/call.
            let call = next.fetch_add(1, Ordering::SeqCst);
            let (tx, rx) = channel();
            pending.lock().ok()?.insert(call, tx);
            forward(call, message.clone());
            let answer = rx.recv_timeout(ANSWER_TIMEOUT);
            pending.lock().ok()?.remove(&call);
            Some(match answer {
                Ok(Value::Object(mut o)) if o.contains_key("error") => {
                    json!({"jsonrpc": "2.0", "id": id, "error": o.remove("error").unwrap_or(Value::Null)})
                }
                Ok(result) => ok(result),
                Err(_) => {
                    json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": "Avero did not answer in time (is a board open?)"}})
                }
            })
        }
    }
}

/// `Avero --mcp`: MCP over stdin/stdout for Claude Desktop, each message
/// passed to the running app's server. Returns when stdin closes.
pub fn bridge(port: u16) {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let id = serde_json::from_str::<Value>(&line).ok().and_then(|v| v.get("id").cloned());
        match post(port, &line) {
            Ok(Some(answer)) => {
                let _ = writeln!(stdout, "{answer}");
            }
            Ok(None) => {}
            Err(e) => {
                if let Some(id) = id {
                    let err = json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": format!("Avero is not reachable on port {port}: start Avero and switch on the AI connection in its settings ({e})")}});
                    let _ = writeln!(stdout, "{err}");
                }
            }
        }
        let _ = stdout.flush();
    }
}

fn post(port: u16, body: &str) -> Result<Option<String>, String> {
    let mut s = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(ANSWER_TIMEOUT + Duration::from_secs(5))).ok();
    let req = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("bad response")?;
    if head.starts_with("HTTP/1.1 202") || body.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(body.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn forward_echo(pending: Pending) -> Forward {
        Arc::new(move |call, msg: Value| {
            let pending = pending.clone();
            std::thread::spawn(move || {
                let tool = msg.pointer("/params/name").and_then(Value::as_str).unwrap_or("").to_string();
                let answer = if tool == "broken" {
                    json!({"error": {"code": -32602, "message": "unknown tool"}})
                } else {
                    json!({"content": [{"type": "text", "text": format!("called {tool}")}]})
                };
                if let Some(tx) = pending.lock().unwrap().remove(&call) {
                    tx.send(answer).unwrap();
                }
            });
        })
    }

    #[test]
    fn answers_initialize_itself_and_forwards_tool_calls() {
        let pending: Pending = Arc::default();
        let next = AtomicU64::new(1);
        let fwd = forward_echo(pending.clone());
        let init = handle(
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}}),
            &pending,
            &next,
            &fwd,
        )
        .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "avero");
        // Unknown versions get the newest.
        let init = handle(
            json!({"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {"protocolVersion": "1999"}}),
            &pending,
            &next,
            &fwd,
        )
        .unwrap();
        assert_eq!(init["result"]["protocolVersion"], VERSIONS[0]);
        // Notifications get no answer.
        assert!(handle(
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            &pending,
            &next,
            &fwd
        )
        .is_none());
        let call = handle(
            json!({"jsonrpc": "2.0", "id": "a", "method": "tools/call", "params": {"name": "get_board"}}),
            &pending,
            &next,
            &fwd,
        )
        .unwrap();
        assert_eq!(call["id"], "a");
        assert_eq!(call["result"]["content"][0]["text"], "called get_board");
        let err = handle(
            json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "broken"}}),
            &pending,
            &next,
            &fwd,
        )
        .unwrap();
        assert_eq!(err["error"]["code"], -32602);
        assert!(pending.lock().unwrap().is_empty());
    }

    #[test]
    fn serves_http_and_the_stdio_bridge_reaches_it() {
        let mcp = Mcp::default();
        let pending = mcp.pending.clone();
        // Port 0 is not allowed for the settings; pick a free one.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        mcp.start(port, forward_echo(pending)).unwrap();
        let answer = post(port, r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"find"}}"#)
            .unwrap()
            .unwrap();
        let v: Value = serde_json::from_str(&answer).unwrap();
        assert_eq!(v["result"]["content"][0]["text"], "called find");
        assert_eq!(post(port, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap(), None);
        // A web page's request is refused.
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        write!(
            s,
            "POST /mcp HTTP/1.1\r\nOrigin: https://evil.example\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut raw = String::new();
        s.read_to_string(&mut raw).unwrap();
        assert!(raw.starts_with("HTTP/1.1 403"), "{raw}");
        mcp.stop();
    }
}
