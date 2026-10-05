//! Cadence Allegro ASCII extracts ("extracta" reports, often called
//! Fabmaster or Allegro ASCII boardviews).
//!
//! The file is a set of tables. An `A!` line names the columns
//! (`A!REFDES!SYM_X!SYM_Y!…`), the `S!` lines after it are rows; a `J!` line
//! at the top names the design and its units. Tables are recognised by
//! their columns, whatever order an extract writes them in:
//!
//! - components: `REFDES`, `SYM_X`, `SYM_Y`, `SYM_MIRROR`, device and value;
//! - pins: `REFDES`, `PIN_NUMBER`, `PIN_X`, `PIN_Y`, often `NET_NAME`;
//! - net list: `NET_NAME`, `REFDES`, `PIN_NUMBER` without coordinates;
//! - vias: `VIA_X`, `VIA_Y`, `NET_NAME`;
//! - pad stacks: `PAD_NAME`, `LAYER`, `PADSHAPE1`, `PADWIDTH`, `PADHGHT`;
//! - graphics: `CLASS`, `SUBCLASS`, `GRAPHIC_DATA_NAME`, `GRAPHIC_DATA_1…`
//!   (board outline from `BOARD GEOMETRY` / `OUTLINE`, tracks from `ETCH`).
//!
//! Coordinates are absolute with Y up; units come from the `J!` line.

use std::collections::{HashMap, HashSet};

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint, RawTrace};
use crate::model::{FormatId, Mount, PadShape, Point, Side, TestPointKind};
use crate::text::decode;
use crate::ParseError;

pub fn detect(buf: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&buf[..buf.len().min(8192)]);
    let mut headers = 0;
    let mut rows = 0;
    for line in head.lines().take(400) {
        let l = line.trim_start();
        if l.starts_with("A!")
            && (l.contains("REFDES") || l.contains("NET_NAME") || l.contains("CLASS!SUBCLASS"))
        {
            headers += 1;
        } else if l.starts_with("S!") {
            rows += 1;
        }
    }
    headers >= 1 && rows >= 1
}

/// One table: its column names and rows.
struct Table {
    columns: HashMap<String, usize>,
    rows: Vec<Vec<String>>,
}

impl Table {
    fn has(&self, names: &[&str]) -> bool {
        names.iter().all(|n| self.columns.contains_key(*n))
    }
    fn get<'a>(&self, row: &'a [String], name: &str) -> Option<&'a str> {
        self.columns.get(name).and_then(|&i| row.get(i)).map(|s| s.trim()).filter(|s| !s.is_empty())
    }
    fn num(&self, row: &[String], name: &str) -> Option<f64> {
        self.get(row, name).and_then(|s| s.parse::<f64>().ok()).filter(|v| v.is_finite())
    }
}

fn split(line: &str) -> Vec<String> {
    // "S!a!b!c!" → ["a", "b", "c"]: the leading tag and the trailing empty field go.
    let mut fields: Vec<String> = line.split('!').skip(1).map(str::to_string).collect();
    if fields.last().is_some_and(String::is_empty) {
        fields.pop();
    }
    fields
}

/// Mils per unit of the `J!` line's unit word (mils when it names none).
fn unit_scale(j_line: &str) -> f64 {
    for word in j_line.split('!') {
        match word.trim().to_ascii_lowercase().as_str() {
            "mils" | "mil" => return 1.0,
            "millimeters" | "millimeter" | "mm" => return 1000.0 / 25.4,
            "inches" | "inch" | "in" => return 1000.0,
            "microns" | "micron" | "um" => return 1.0 / 25.4,
            "centimeters" | "cm" => return 10000.0 / 25.4,
            _ => {}
        }
    }
    1.0
}

fn tables(text: &str) -> (Vec<Table>, f64) {
    let mut out: Vec<Table> = Vec::new();
    let mut scale = 1.0;
    for line in text.lines() {
        let l = line.trim_start();
        if l.starts_with("J!") {
            scale = unit_scale(l);
        } else if l.starts_with("A!") {
            let columns =
                split(l).into_iter().enumerate().map(|(i, c)| (c.trim().to_ascii_uppercase(), i)).collect();
            out.push(Table { columns, rows: Vec::new() });
        } else if l.starts_with("S!") {
            if let Some(t) = out.last_mut() {
                t.rows.push(split(l));
            }
        }
    }
    (out, scale)
}

fn yes(v: Option<&str>) -> bool {
    v.is_some_and(|v| matches!(v.to_ascii_uppercase().as_str(), "YES" | "Y" | "TRUE" | "1" | "MIRRORED"))
}

/// Size of a pad stack on the outer layer, and whether it goes through the board.
#[derive(Default, Clone, Copy)]
struct Stack {
    w: f64,
    h: f64,
    round: bool,
    top: bool,
    bottom: bool,
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let text = decode(buf);
    let (tables, scale) = tables(&text);
    if tables.is_empty() {
        return Err(ParseError::invalid(FormatId::AllegroAscii, "no A!/S! tables"));
    }
    let mils = |v: f64| v * scale;
    let pt = |x: f64, y: f64| Point::new(mils(x), mils(y));

    // Pad stacks: size on the top (or first) layer, and the layers they reach.
    let mut stacks: HashMap<String, Stack> = HashMap::new();
    for t in tables.iter().filter(|t| t.has(&["PAD_NAME", "LAYER"])) {
        for row in &t.rows {
            let Some(name) = t.get(row, "PAD_NAME") else { continue };
            let layer = t.get(row, "LAYER").unwrap_or("").to_ascii_uppercase();
            let s = stacks.entry(name.to_string()).or_default();
            let outer_top = layer == "TOP" || layer == "BEGIN LAYER";
            let outer_bottom = layer == "BOTTOM" || layer == "END LAYER";
            s.top |= outer_top;
            s.bottom |= outer_bottom;
            if (outer_top || (s.w == 0.0 && outer_bottom)) && s.w == 0.0 {
                s.w = t.num(row, "PADWIDTH").map(mils).unwrap_or(0.0);
                s.h = t.num(row, "PADHGHT").map(mils).unwrap_or(s.w);
                let shape = t.get(row, "PADSHAPE1").unwrap_or("").to_ascii_uppercase();
                s.round = shape.contains("CIRCLE") || shape.contains("OBLONG") || shape.contains("ROUND");
            }
        }
    }

    // Components.
    struct Comp {
        side: Side,
        device: Option<String>,
    }
    let mut comps: HashMap<String, Comp> = HashMap::new();
    for t in tables.iter().filter(|t| t.has(&["REFDES", "SYM_X", "SYM_Y"]) && !t.has(&["PIN_X"])) {
        for row in &t.rows {
            let Some(name) = t.get(row, "REFDES") else { continue };
            let side = if yes(t.get(row, "SYM_MIRROR")) { Side::Bottom } else { Side::Top };
            let device = ["COMP_DEVICE_TYPE", "COMP_PART_NUMBER", "COMP_VALUE", "SYM_NAME"]
                .iter()
                .filter_map(|c| t.get(row, c))
                .next()
                .map(str::to_string);
            let value = t.get(row, "COMP_VALUE").map(str::to_string);
            let device = match (device, value) {
                (Some(d), Some(v)) if !d.contains(&v) => Some(format!("{d} {v}")),
                (d, v) => d.or(v),
            };
            comps.insert(name.to_string(), Comp { side, device });
        }
    }

    // Nets by pin from a net list table.
    let mut net_of: HashMap<(String, String), String> = HashMap::new();
    for t in tables.iter().filter(|t| t.has(&["NET_NAME", "REFDES", "PIN_NUMBER"]) && !t.has(&["PIN_X"])) {
        for row in &t.rows {
            if let (Some(net), Some(part), Some(pin)) =
                (t.get(row, "NET_NAME"), t.get(row, "REFDES"), t.get(row, "PIN_NUMBER"))
            {
                net_of.insert((part.to_string(), pin.to_string()), net.to_string());
            }
        }
    }

    // Pins, grouped into parts in the order they come.
    let mut board = RawBoard::new(FormatId::AllegroAscii);
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut seen_pins: HashSet<(String, String)> = HashSet::new();
    for t in tables.iter().filter(|t| t.has(&["REFDES", "PIN_X", "PIN_Y"])) {
        for row in &t.rows {
            let (Some(name), Some(x), Some(y)) =
                (t.get(row, "REFDES"), t.num(row, "PIN_X"), t.num(row, "PIN_Y"))
            else {
                continue;
            };
            let number =
                t.get(row, "PIN_NUMBER").or_else(|| t.get(row, "PIN_NAME")).unwrap_or("").to_string();
            if !seen_pins.insert((name.to_string(), number.clone())) {
                continue;
            }
            let comp = comps.get(name);
            let mirrored = t.get(row, "SYM_MIRROR").map(|_| yes(t.get(row, "SYM_MIRROR")));
            let side = comp
                .map(|c| c.side)
                .or(mirrored.map(|m| if m { Side::Bottom } else { Side::Top }))
                .unwrap_or(Side::Top);
            let stack = t.get(row, "PAD_STACK_NAME").and_then(|s| stacks.get(s)).copied();
            let through = stack.is_some_and(|s| s.top && s.bottom);
            let i = *index.entry(name.to_string()).or_insert_with(|| {
                let mut part = RawPart::new(name, side, Mount::Smd);
                part.device = comp.and_then(|c| c.device.clone());
                board.parts.push(part);
                board.parts.len() - 1
            });
            let part = &mut board.parts[i];
            if through {
                part.mount = Mount::ThroughHole;
            }
            let net = t
                .get(row, "NET_NAME")
                .map(str::to_string)
                .or_else(|| net_of.get(&(name.to_string(), number.clone())).cloned())
                .unwrap_or_default();
            let pad = stack.filter(|s| s.w > 0.0).and_then(|s| {
                let angle = t.num(row, "PIN_ROTATION").unwrap_or(0.0).rem_euclid(360.0);
                (!(s.round && (s.w - s.h).abs() < 1e-6)).then_some(PadShape {
                    w: s.w,
                    h: s.h,
                    angle,
                    round: s.round,
                })
            });
            part.pins.push(RawPin {
                pos: pt(x, y),
                side: through.then_some(Side::Both),
                net,
                number: (!number.is_empty()).then_some(number),
                name: t.get(row, "PIN_NAME").map(str::to_string),
                radius: stack.filter(|s| s.w > 0.0).map(|s| s.w.max(s.h) / 2.0),
                pad,
                ..Default::default()
            });
        }
    }

    // Vias and test points.
    for t in tables.iter().filter(|t| t.has(&["VIA_X", "VIA_Y"])) {
        for row in &t.rows {
            let (Some(x), Some(y)) = (t.num(row, "VIA_X"), t.num(row, "VIA_Y")) else { continue };
            let test = t.get(row, "TEST_POINT").is_some();
            let stack = t.get(row, "PAD_STACK_NAME").and_then(|s| stacks.get(s)).copied();
            board.test_points.push(RawTestPoint {
                kind: if test { TestPointKind::Nail } else { TestPointKind::Via },
                pos: pt(x, y),
                side: Side::Both,
                net: t.get(row, "NET_NAME").unwrap_or("").to_string(),
                probe: None,
                radius: stack.filter(|s| s.w > 0.0).map(|s| s.w.max(s.h) / 2.0),
                name: None,
            });
        }
    }

    // Graphics: the board outline and copper tracks.
    let mut outline = Vec::new();
    for t in tables.iter().filter(|t| t.has(&["CLASS", "SUBCLASS", "GRAPHIC_DATA_NAME", "GRAPHIC_DATA_1"])) {
        for row in &t.rows {
            let class = t.get(row, "CLASS").unwrap_or("").to_ascii_uppercase();
            let sub = t.get(row, "SUBCLASS").unwrap_or("").to_ascii_uppercase();
            let kind = t.get(row, "GRAPHIC_DATA_NAME").unwrap_or("").to_ascii_uppercase();
            let d = |k: usize| t.num(row, &format!("GRAPHIC_DATA_{k}"));
            let is_edge = class == "BOARD GEOMETRY" && matches!(sub.as_str(), "OUTLINE" | "DESIGN_OUTLINE");
            let segments: Vec<(Point, Point)> = match kind.as_str() {
                "LINE" => match (d(1), d(2), d(3), d(4)) {
                    (Some(x1), Some(y1), Some(x2), Some(y2)) => vec![(pt(x1, y1), pt(x2, y2))],
                    _ => vec![],
                },
                "ARC" => match (d(1), d(2), d(3), d(4), d(5), d(6), d(7)) {
                    (Some(x1), Some(y1), Some(x2), Some(y2), Some(cx), Some(cy), Some(r)) => {
                        let ccw = !t
                            .get(row, "GRAPHIC_DATA_9")
                            .unwrap_or("")
                            .to_ascii_uppercase()
                            .starts_with("CLOCKWISE");
                        arc(pt(x1, y1), pt(x2, y2), pt(cx, cy), mils(r), ccw)
                    }
                    _ => vec![],
                },
                "RECTANGLE" => match (d(1), d(2), d(3), d(4)) {
                    (Some(x1), Some(y1), Some(x2), Some(y2)) if is_edge => {
                        let c = [pt(x1, y1), pt(x2, y1), pt(x2, y2), pt(x1, y2)];
                        (0..4).map(|i| (c[i], c[(i + 1) % 4])).collect()
                    }
                    _ => vec![],
                },
                _ => vec![],
            };
            if is_edge {
                outline.extend(segments);
            } else if class == "ETCH" && kind != "RECTANGLE" {
                let Some(net) = t.get(row, "NET_NAME").filter(|n| !n.is_empty()) else { continue };
                let width = match kind.as_str() {
                    "LINE" => d(5),
                    _ => d(8),
                }
                .map(mils)
                .unwrap_or(0.0);
                let side = match sub.as_str() {
                    "TOP" => Side::Top,
                    "BOTTOM" => Side::Bottom,
                    _ => Side::Both,
                };
                for (a, b) in segments {
                    board.traces.push(RawTrace {
                        from: a,
                        to: b,
                        width,
                        side,
                        layer: sub.clone(),
                        net: net.to_string(),
                    });
                }
            }
        }
    }
    board.outline_segments = outline;
    board.parts.retain(|p| !p.pins.is_empty());
    if board.parts.is_empty() && board.test_points.is_empty() {
        return Err(ParseError::invalid(FormatId::AllegroAscii, "no pins or vias in the extract"));
    }
    Ok(board)
}

/// An arc from `a` to `b` around `c` as short segments.
fn arc(a: Point, b: Point, c: Point, r: f64, ccw: bool) -> Vec<(Point, Point)> {
    let a0 = (a.y - c.y).atan2(a.x - c.x);
    let mut a1 = (b.y - c.y).atan2(b.x - c.x);
    let tau = std::f64::consts::TAU;
    if ccw {
        while a1 <= a0 {
            a1 += tau;
        }
    } else {
        while a1 >= a0 {
            a1 -= tau;
        }
    }
    let r = if r > 0.0 { r } else { (a.x - c.x).hypot(a.y - c.y) };
    let steps = (((a1 - a0).abs() / tau) * 48.0).ceil().clamp(2.0, 48.0) as usize;
    let at = |k: usize| {
        let t = a0 + (a1 - a0) * k as f64 / steps as f64;
        Point::new(c.x + r * t.cos(), c.y + r * t.sin())
    };
    (0..steps).map(|k| (at(k), at(k + 1))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_units_and_detects() {
        assert!((unit_scale("J!x.brd!date!millimeters!") - 39.3700787).abs() < 1e-4);
        assert_eq!(unit_scale("J!x.brd!date!mils!"), 1.0);
        assert!(detect(b"J!a!b!\nA!REFDES!SYM_X!SYM_Y!\nS!U1!1!2!\n"));
        assert!(!detect(b"just text\nwith ! marks!\n"));
    }
}
