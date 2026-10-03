// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `Avero --mcp [port]`: the AI connection's bridge for Claude Desktop
    // (stdin/stdout to the running app), no window.
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--mcp") {
        let port = args.get(i + 1).and_then(|p| p.parse().ok()).unwrap_or(avero_lib::MCP_DEFAULT_PORT);
        avero_lib::mcp_bridge(port);
        return;
    }
    avero_lib::run()
}
