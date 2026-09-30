//! KiCad boards (`.kicad_pcb`, KiCad 5 and later).
//!
//! The file is an S-expression tree in millimetres with Y pointing down.
//! Read are the net table, footprints (`footprint`, or `module` in KiCad 5)
//! with reference, value, side, position and rotation, their pads (number,
//! size, through-hole or SMD, net), vias, and the board edge from the
//! `Edge.Cuts` graphics. Pad positions are stored relative to the
//! footprint and rotated with it; footprints on the back side are already
//! stored flipped, so no extra mirroring is needed.

use std::collections::HashMap;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::decode;
use crate::ParseError;

const MILS_PER_MM: f64 = 1000.0 / 25.4;
const MAX_DEPTH: usize = 64;

/// A line piece in KiCad millimetres.
type Segment = ((f64, f64), (f64, f64));

pub fn detect(buf: &[u8]) -> bool {
    let head = &buf[..buf.len().min(256)];
    let text = String::from_utf8_lossy(head);
    let t = text.trim_start_matches('\u{feff}').trim_start();
    t.starts_with("(kicad_pcb")
}

/// One node of the S-expression tree.
#[derive(Debug)]
enum Sx {
    Atom(String),
    List(Vec<Sx>),
}

impl Sx {
    fn items(&self) -> &[Sx] {
        match self {
            Sx::List(items) => items,
            Sx::Atom(_) => &[],
        }
    }

    fn atom(&self) -> Option<&str> {
        match self {
            Sx::Atom(s) => Some(s),
            Sx::List(_) => None,
        }
    }

    /// The keyword a list starts with.
    fn head(&self) -> &str {
        self.items().first().and_then(Sx::atom).unwrap_or("")
    }

    fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Sx> + 'a {
        self.items().iter().filter(move |c| c.head() == name)
    }

    fn child(&self, name: &str) -> Option<&Sx> {
        self.items().iter().find(|c| c.head() == name)
    }

    /// The i-th atom after the keyword.
    fn arg(&self, i: usize) -> Option<&str> {
        self.items().get(i + 1).and_then(Sx::atom)
    }

    fn num(&self, i: usize) -> Option<f64> {
        self.arg(i).and_then(|s| s.parse().ok())
    }
}

fn err(message: impl Into<String>) -> ParseError {
    ParseError::invalid(FormatId::KiCad, message)
}

fn parse_sexpr(text: &str) -> Result<Sx, ParseError> {
    let mut stack: Vec<Vec<Sx>> = Vec::new();
    let mut chars = text.char_indices().peekable();
    let mut root = None;
    while let Some((_, c)) = chars.next() {
        match c {
            '(' => {
                if stack.len() >= MAX_DEPTH {
                    return Err(err("nested too deeply"));
                }
                stack.push(Vec::new());
            }
            ')' => {
                let list = stack.pop().ok_or_else(|| err("unbalanced parentheses"))?;
                match stack.last_mut() {
                    Some(parent) => parent.push(Sx::List(list)),
                    None => {
                        root = Some(Sx::List(list));
                        break;
                    }
                }
            }
            '"' => {
                let mut s = String::new();
                loop {
                    match chars.next() {
                        None => return Err(err("unterminated string")),
                        Some((_, '"')) => break,
                        Some((_, '\\')) => match chars.next() {
                            Some((_, 'n')) => s.push('\n'),
                            Some((_, other)) => s.push(other),
                            None => return Err(err("unterminated string")),
                        },
                        Some((_, other)) => s.push(other),
                    }
                }
                stack.last_mut().ok_or_else(|| err("text outside the board"))?.push(Sx::Atom(s));
            }
            c if c.is_whitespace() => {}
            _ => {
                let mut s = String::from(c);
                while let Some(&(_, n)) = chars.peek() {
                    if n.is_whitespace() || n == '(' || n == ')' || n == '"' {
                        break;
                    }
                    s.push(n);
                    chars.next();
                }
                stack.last_mut().ok_or_else(|| err("text outside the board"))?.push(Sx::Atom(s));
            }
        }
    }
    root.ok_or_else(|| err("unbalanced parentheses"))
}

/// KiCad millimetres (Y down) to mils (Y up).
fn mils(x: f64, y: f64) -> Point {
    Point::new(x * MILS_PER_MM, -y * MILS_PER_MM)
}

fn xy(node: Option<&Sx>) -> Option<(f64, f64)> {
    let n = node?;
    Some((n.num(0)?, n.num(1)?))
}

/// KiCad rotation: counter-clockwise on screen, with Y pointing down.
fn rotate((x, y): (f64, f64), deg: f64) -> (f64, f64) {
    let (s, c) = deg.to_radians().sin_cos();
    (x * c + y * s, -x * s + y * c)
}

fn is_edge(node: &Sx) -> bool {
    node.child("layer").and_then(|l| l.arg(0)) == Some("Edge.Cuts")
}

/// Board edge segments from one graphic item, in KiCad millimetres.
fn edge_segments(node: &Sx, out: &mut Vec<Segment>) {
    let start = xy(node.child("start"));
    let end = xy(node.child("end"));
    match node.head() {
        "gr_line" => {
            if let (Some(a), Some(b)) = (start, end) {
                out.push((a, b));
            }
        }
        "gr_rect" => {
            if let (Some((x0, y0)), Some((x1, y1))) = (start, end) {
                let c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)];
                for i in 0..4 {
                    out.push((c[i], c[(i + 1) % 4]));
                }
            }
        }
        "gr_circle" => {
            // KiCad 6+: center + point on circle; KiCad 5: center + end.
            if let (Some(c), Some(p)) = (xy(node.child("center")).or(start), end) {
                let r = ((p.0 - c.0).powi(2) + (p.1 - c.1).powi(2)).sqrt();
                sample_arc(c, r, 0.0, std::f64::consts::TAU, out);
            }
        }
        "gr_arc" => {
            let mid = xy(node.child("mid"));
            match (start, mid, end, node.child("angle").and_then(|a| a.num(0))) {
                // KiCad 6+: three points on the arc.
                (Some(a), Some(m), Some(b), _) => three_point_arc(a, m, b, out),
                // KiCad 5: center, start point and sweep angle.
                (Some(c), None, Some(p), Some(sweep)) => {
                    let r = ((p.0 - c.0).powi(2) + (p.1 - c.1).powi(2)).sqrt();
                    let a0 = (p.1 - c.1).atan2(p.0 - c.0);
                    sample_arc(c, r, a0, a0 + sweep.to_radians(), out);
                }
                _ => {}
            }
        }
        "gr_poly" => {
            let pts: Vec<(f64, f64)> = node
                .child("pts")
                .map(|p| p.children("xy").filter_map(|n| xy(Some(n))).collect())
                .unwrap_or_default();
            for i in 0..pts.len() {
                if pts.len() >= 2 {
                    out.push((pts[i], pts[(i + 1) % pts.len()]));
                }
            }
        }
        _ => {}
    }
}

fn sample_arc(c: (f64, f64), r: f64, a0: f64, a1: f64, out: &mut Vec<Segment>) {
    let steps = (((a1 - a0).abs() / std::f64::consts::TAU) * 48.0).ceil().max(2.0) as usize;
    let at = |k: usize| {
        let a = a0 + (a1 - a0) * k as f64 / steps as f64;
        (c.0 + r * a.cos(), c.1 + r * a.sin())
    };
    for k in 0..steps {
        out.push((at(k), at(k + 1)));
    }
}

fn three_point_arc(a: (f64, f64), m: (f64, f64), b: (f64, f64), out: &mut Vec<Segment>) {
    let d = 2.0 * (a.0 * (m.1 - b.1) + m.0 * (b.1 - a.1) + b.0 * (a.1 - m.1));
    if d.abs() < 1e-12 {
        out.push((a, b));
        return;
    }
    let sq = |p: (f64, f64)| p.0 * p.0 + p.1 * p.1;
    let cx = (sq(a) * (m.1 - b.1) + sq(m) * (b.1 - a.1) + sq(b) * (a.1 - m.1)) / d;
    let cy = (sq(a) * (b.0 - m.0) + sq(m) * (a.0 - b.0) + sq(b) * (m.0 - a.0)) / d;
    let r = ((a.0 - cx).powi(2) + (a.1 - cy).powi(2)).sqrt();
    let angle = |p: (f64, f64)| (p.1 - cy).atan2(p.0 - cx);
    let (a0, am, mut a1) = (angle(a), angle(m), angle(b));
    // Go from start to end the way that passes the middle point.
    let tau = std::f64::consts::TAU;
    let norm = |x: f64| x.rem_euclid(tau);
    let ccw_to_end = norm(a1 - a0);
    let ccw_to_mid = norm(am - a0);
    a1 = if ccw_to_mid <= ccw_to_end { a0 + ccw_to_end } else { a0 - (tau - ccw_to_end) };
    sample_arc((cx, cy), r, a0, a1, out);
}

/// Reference or value of a footprint: `property` (KiCad 6+) or `fp_text` (KiCad 5).
fn field(fp: &Sx, name: &str) -> Option<String> {
    let property = fp.children("property").find(|p| p.arg(0) == Some(name)).and_then(|p| p.arg(1));
    let text =
        || fp.children("fp_text").find(|t| t.arg(0) == Some(&name.to_lowercase())).and_then(|t| t.arg(1));
    property.or_else(text).map(str::to_string)
}

/// A pad's net: `(net 3 "GND")`, or `(net "GND")` without the number.
fn net_of(node: &Sx, nets: &HashMap<String, String>) -> String {
    let Some(net) = node.child("net") else { return String::new() };
    match (net.arg(0), net.arg(1)) {
        (_, Some(name)) => name.to_string(),
        (Some(id), None) => nets.get(id).cloned().unwrap_or_else(|| {
            if id.parse::<u32>().is_ok() {
                String::new()
            } else {
                id.to_string()
            }
        }),
        _ => String::new(),
    }
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let text = decode(buf);
    let root = parse_sexpr(&text)?;
    if root.head() != "kicad_pcb" {
        return Err(err("not a KiCad board"));
    }
    let nets: HashMap<String, String> = root
        .children("net")
        .filter_map(|n| Some((n.arg(0)?.to_string(), n.arg(1).unwrap_or("").to_string())))
        .collect();

    let mut board = RawBoard::new(FormatId::KiCad);
    let mut edge = Vec::new();
    for node in root.items() {
        match node.head() {
            "gr_line" | "gr_arc" | "gr_rect" | "gr_circle" | "gr_poly" if is_edge(node) => {
                edge_segments(node, &mut edge);
            }
            "footprint" | "module" => {
                let Some(name) = field(node, "Reference").filter(|r| !r.is_empty()) else { continue };
                let bottom = node.child("layer").and_then(|l| l.arg(0)).is_some_and(|l| l.starts_with("B."));
                let at = node.child("at");
                let origin = xy(at).unwrap_or((0.0, 0.0));
                let angle = at.and_then(|a| a.num(2)).unwrap_or(0.0);
                let side = if bottom { Side::Bottom } else { Side::Top };
                let mut part = RawPart::new(name, side, Mount::Smd);
                part.device = field(node, "Value").filter(|v| !v.is_empty() && v != "~");
                for pad in node.children("pad") {
                    let number = pad.arg(0).unwrap_or("").to_string();
                    let kind = pad.arg(1).unwrap_or("");
                    let net = net_of(pad, &nets);
                    // Mounting holes without number or net are not pins.
                    if kind == "np_thru_hole" && number.is_empty() && net.is_empty() {
                        continue;
                    }
                    let local = xy(pad.child("at")).unwrap_or((0.0, 0.0));
                    let (dx, dy) = rotate(local, angle);
                    let size = xy(pad.child("size")).unwrap_or((0.0, 0.0));
                    let through = kind == "thru_hole" || kind == "np_thru_hole";
                    if through {
                        part.mount = Mount::ThroughHole;
                    }
                    part.pins.push(RawPin {
                        pos: mils(origin.0 + dx, origin.1 + dy),
                        side: through.then_some(Side::Both),
                        net,
                        number: (!number.is_empty()).then_some(number),
                        radius: (size.0 > 0.0).then(|| size.0.max(size.1) * MILS_PER_MM / 2.0),
                        ..Default::default()
                    });
                }
                if !part.pins.is_empty() {
                    board.parts.push(part);
                }
            }
            "via" => {
                if let Some((x, y)) = xy(node.child("at")) {
                    board.test_points.push(RawTestPoint {
                        kind: TestPointKind::Via,
                        pos: mils(x, y),
                        side: Side::Both,
                        net: net_of(node, &nets),
                        probe: None,
                        radius: node.child("size").and_then(|s| s.num(0)).map(|d| d * MILS_PER_MM / 2.0),
                        name: None,
                    });
                }
            }
            _ => {}
        }
    }
    board.outline_segments = edge.into_iter().map(|(a, b)| (mils(a.0, a.1), mils(b.0, b.1))).collect();
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nested_lists_and_strings() {
        let sx = parse_sexpr(r#"(a (b "x \"y\"" 1.5) (c))"#).unwrap();
        assert_eq!(sx.head(), "a");
        assert_eq!(sx.child("b").unwrap().arg(0), Some("x \"y\""));
        assert_eq!(sx.child("b").unwrap().num(1), Some(1.5));
        assert!(parse_sexpr("(a (b)").is_err());
    }

    #[test]
    fn rotates_like_kicad() {
        // 90° turns +X into -Y (up on screen).
        let (x, y) = rotate((1.0, 0.0), 90.0);
        assert!((x - 0.0).abs() < 1e-9 && (y + 1.0).abs() < 1e-9);
    }
}
