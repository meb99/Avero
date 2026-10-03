//! Altium Designer boards saved as text ("PCB ASCII", `.PcbDoc`).
//!
//! Each line is one record of `|KEY=VALUE` fields. Read are the nets, the
//! components (designator, side, library reference and footprint), their
//! pads (absolute positions, size, shape, rotation, net), free pads, vias,
//! copper tracks and arcs as traces, and the board edge: the board shape
//! from the `Board` record (`VX0`, `VY0` …), else the tracks and arcs on the
//! keep-out layer. Coordinates are in mils with Y up, the same as Avero's;
//! values carry a unit (`1234.5mil`, sometimes `mm`).
//!
//! The binary `.PcbDoc` (an OLE compound file) is a different format and is
//! not read here.

use std::collections::HashMap;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint, RawTrace};
use crate::model::{FormatId, Mount, PadShape, Point, Side, TestPointKind};
use crate::text::decode;
use crate::ParseError;

const MILS_PER_MM: f64 = 1000.0 / 25.4;
/// Altium writes 65535 (or -1) for "no net" and "no component".
const NONE_IDS: [&str; 3] = ["65535", "-1", ""];

pub fn detect(buf: &[u8]) -> bool {
    if buf.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
        return false;
    }
    let head = &buf[..buf.len().min(4096)];
    let text = String::from_utf8_lossy(head);
    text.contains("KIND=Protel_Advanced_PCB") && !text.contains("Binary")
}

/// One record's fields, keys upper-cased.
struct Record<'a> {
    fields: HashMap<String, &'a str>,
}

impl<'a> Record<'a> {
    fn parse(line: &'a str) -> Self {
        let fields = line
            .split('|')
            .filter_map(|f| f.split_once('='))
            .map(|(k, v)| (k.trim().to_ascii_uppercase(), v.trim()))
            .collect();
        Self { fields }
    }

    fn get(&self, key: &str) -> Option<&'a str> {
        self.fields.get(key).copied().filter(|v| !v.is_empty())
    }

    fn first(&self, keys: &[&str]) -> Option<&'a str> {
        keys.iter().find_map(|k| self.get(k))
    }

    /// A length in mils.
    fn len(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(length)
    }

    fn num(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite())
    }

    /// An id that refers to another record, `None` for Altium's "none".
    fn reference(&self, key: &str) -> Option<&'a str> {
        self.fields.get(key).copied().map(str::trim).filter(|v| !NONE_IDS.contains(v))
    }
}

/// `1234.5mil`, `3.2mm` or a bare number (mils).
fn length(value: &str) -> Option<f64> {
    let v = value.trim();
    let lower = v.to_ascii_lowercase();
    let (number, scale) = if let Some(n) = lower.strip_suffix("mil") {
        (n.to_string(), 1.0)
    } else if let Some(n) = lower.strip_suffix("mm") {
        (n.to_string(), MILS_PER_MM)
    } else {
        (lower, 1.0)
    };
    number.trim().parse::<f64>().ok().filter(|n| n.is_finite()).map(|n| n * scale)
}

fn point(r: &Record, x: &str, y: &str) -> Option<Point> {
    Some(Point::new(r.len(x)?, r.len(y)?))
}

/// Copper layer to board side; inner layers belong to neither.
fn copper_side(layer: &str) -> Option<Side> {
    match layer {
        "TOP" => Some(Side::Top),
        "BOTTOM" => Some(Side::Bottom),
        "MULTILAYER" => Some(Side::Both),
        l if l.starts_with("MID") => Some(Side::Both),
        _ => None,
    }
}

/// Points along an arc; angles in degrees, counter-clockwise.
fn arc_points(center: Point, radius: f64, start: f64, end: f64) -> Vec<Point> {
    let mut sweep = end - start;
    if sweep <= 0.0 {
        sweep += 360.0;
    }
    let steps = ((sweep / 360.0) * 48.0).ceil().clamp(2.0, 48.0) as usize;
    (0..=steps)
        .map(|k| {
            let a = (start + sweep * k as f64 / steps as f64).to_radians();
            Point::new(center.x + radius * a.cos(), center.y + radius * a.sin())
        })
        .collect()
}

fn arc_of(r: &Record) -> Option<Vec<Point>> {
    let center = point(r, "LOCATION.X", "LOCATION.Y")?;
    let radius = r.len("RADIUS").filter(|v| *v > 0.0)?;
    Some(arc_points(center, radius, r.num("STARTANGLE").unwrap_or(0.0), r.num("ENDANGLE").unwrap_or(360.0)))
}

/// The board shape from the `Board` record: vertices `VXn`/`VYn`, where
/// `KINDn=1` makes the edge from vertex n an arc around `CXn`/`CYn`.
fn board_shape(r: &Record) -> Vec<Point> {
    let mut path = Vec::new();
    for i in 0..10_000 {
        let Some(v) = point(r, &format!("VX{i}"), &format!("VY{i}")) else { break };
        let arc = r.get(&format!("KIND{i}")) == Some("1");
        let center = point(r, &format!("CX{i}"), &format!("CY{i}"));
        let radius = r.len(&format!("R{i}"));
        let (sa, ea) = (r.num(&format!("SA{i}")), r.num(&format!("EA{i}")));
        match (arc, center, radius, sa, ea) {
            (true, Some(c), Some(rad), Some(sa), Some(ea)) if rad > 0.0 => {
                let mut pts = arc_points(c, rad, sa, ea);
                // Run the arc from this vertex on.
                let d = |p: &Point| (p.x - v.x).powi(2) + (p.y - v.y).powi(2);
                if let (Some(a), Some(b)) = (pts.first(), pts.last()) {
                    if d(b) < d(a) {
                        pts.reverse();
                    }
                }
                path.extend(pts);
            }
            _ => path.push(v),
        }
    }
    if path.len() >= 3 && path.first() != path.last() {
        path.push(path[0]);
    }
    path
}

fn pad_shape(r: &Record, w: f64, h: f64) -> Option<PadShape> {
    let shape = r.first(&["SHAPE", "TOPSHAPE"]).unwrap_or("ROUND").to_ascii_uppercase();
    let round = shape == "ROUND";
    if w <= 0.0 || h <= 0.0 || (round && (w - h).abs() < 1e-6) {
        return None;
    }
    let angle = r.num("ROTATION").unwrap_or(0.0).rem_euclid(360.0);
    Some(PadShape { w, h, angle, round })
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let text = decode(buf);
    if !text.contains("KIND=Protel_Advanced_PCB") {
        return Err(ParseError::invalid(FormatId::Altium, "not an Altium PCB ASCII file"));
    }
    let mut board = RawBoard::new(FormatId::Altium);
    let mut nets: HashMap<String, String> = HashMap::new();
    let mut components: Vec<RawPart> = Vec::new();
    let mut component_at: HashMap<String, usize> = HashMap::new();
    let mut keepout: Vec<(Point, Point)> = Vec::new();
    let mut shape: Vec<Point> = Vec::new();
    // Pads may come before their component; keep them until the end.
    let mut pads: Vec<(Option<String>, RawPin, bool)> = Vec::new();
    let mut component_count = 0usize;
    let records = || text.lines().filter(|l| l.contains("RECORD=")).map(Record::parse);
    // Nets first: pads, vias and tracks refer to them by id.
    for (i, r) in records().filter(|r| r.get("RECORD") == Some("Net")).enumerate() {
        let id = r.get("ID").map(str::to_string).unwrap_or_else(|| i.to_string());
        nets.insert(id, r.get("NAME").unwrap_or("").to_string());
    }

    let net_name = |nets: &HashMap<String, String>, r: &Record| -> String {
        r.reference("NET").and_then(|id| nets.get(id).cloned()).unwrap_or_default()
    };

    for r in records() {
        match r.get("RECORD").unwrap_or("") {
            "Board" => {
                if shape.is_empty() {
                    shape = board_shape(&r);
                }
            }
            "Component" => {
                let id = r.get("ID").map(str::to_string).unwrap_or_else(|| component_count.to_string());
                component_count += 1;
                let name = r
                    .first(&["SOURCEDESIGNATOR", "NAME"])
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("UNKNOWN-{id}"));
                let side = if r.get("LAYER") == Some("BOTTOM") { Side::Bottom } else { Side::Top };
                let mut part = RawPart::new(name, side, Mount::Smd);
                let mut device: Vec<&str> = Vec::new();
                for v in [r.first(&["SOURCELIBREFERENCE", "SOURCEDESCRIPTION"]), r.get("PATTERN")]
                    .into_iter()
                    .flatten()
                {
                    if !device.iter().any(|d| d.eq_ignore_ascii_case(v)) {
                        device.push(v);
                    }
                }
                part.device = (!device.is_empty()).then(|| device.join(" "));
                component_at.insert(id, components.len());
                components.push(part);
            }
            "Pad" => {
                let Some(pos) = point(&r, "X", "Y") else { continue };
                let w = r.len("XSIZE").or_else(|| r.len("TOPXSIZE")).unwrap_or(0.0);
                let h = r.len("YSIZE").or_else(|| r.len("TOPYSIZE")).unwrap_or(w);
                let layer = r.get("LAYER").unwrap_or("TOP");
                let through = layer == "MULTILAYER";
                let pin = RawPin {
                    pos,
                    side: match layer {
                        "MULTILAYER" => Some(Side::Both),
                        "TOP" => Some(Side::Top),
                        "BOTTOM" => Some(Side::Bottom),
                        _ => None,
                    },
                    net: net_name(&nets, &r),
                    number: r.get("NAME").map(str::to_string),
                    radius: (w > 0.0).then(|| w.max(h) / 2.0),
                    pad: pad_shape(&r, w, h),
                    ..Default::default()
                };
                pads.push((r.reference("COMPONENT").map(str::to_string), pin, through));
            }
            "Via" => {
                let Some(pos) = point(&r, "X", "Y") else { continue };
                board.test_points.push(RawTestPoint {
                    kind: TestPointKind::Via,
                    pos,
                    side: Side::Both,
                    net: net_name(&nets, &r),
                    probe: None,
                    radius: r.len("DIAMETER").map(|d| d / 2.0),
                    name: None,
                });
            }
            "Track" => {
                let (Some(a), Some(b)) = (point(&r, "X1", "Y1"), point(&r, "X2", "Y2")) else { continue };
                let layer = r.get("LAYER").unwrap_or("");
                if layer == "KEEPOUT" {
                    keepout.push((a, b));
                } else if let Some(side) = copper_side(layer) {
                    let net = net_name(&nets, &r);
                    if !net.is_empty() {
                        board.traces.push(RawTrace {
                            from: a,
                            to: b,
                            width: r.len("WIDTH").unwrap_or(0.0),
                            side,
                            layer: layer.to_string(),
                            net,
                        });
                    }
                }
            }
            "Arc" => {
                let Some(pts) = arc_of(&r) else { continue };
                let layer = r.get("LAYER").unwrap_or("");
                let segments = pts.windows(2).map(|w| (w[0], w[1]));
                if layer == "KEEPOUT" {
                    keepout.extend(segments);
                } else if let Some(side) = copper_side(layer) {
                    let net = net_name(&nets, &r);
                    if !net.is_empty() {
                        let width = r.len("WIDTH").unwrap_or(0.0);
                        for (a, b) in segments {
                            board.traces.push(RawTrace {
                                from: a,
                                to: b,
                                width,
                                side,
                                layer: layer.to_string(),
                                net: net.clone(),
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    for (component, pin, through) in pads {
        match component.and_then(|c| component_at.get(&c).copied()) {
            Some(i) => {
                let part = &mut components[i];
                if through {
                    part.mount = Mount::ThroughHole;
                }
                part.pins.push(pin);
            }
            // A pad of its own: a test pad when it has a net and a name.
            None if !pin.net.is_empty() => board.test_points.push(RawTestPoint {
                kind: TestPointKind::Nail,
                pos: pin.pos,
                side: pin.side.unwrap_or(Side::Top),
                net: pin.net,
                probe: None,
                radius: pin.radius,
                name: pin.number,
            }),
            None => {}
        }
    }
    board.parts = components.into_iter().filter(|p| !p.pins.is_empty()).collect();
    if shape.len() >= 3 {
        board.outline_path = shape;
    } else {
        board.outline_segments = keepout;
    }
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lengths_with_units() {
        assert_eq!(length("1234.5mil"), Some(1234.5));
        assert_eq!(length(" 10 "), Some(10.0));
        assert!((length("2.54mm").unwrap() - 100.0).abs() < 1e-9);
        assert_eq!(length("abc"), None);
    }

    #[test]
    fn detects_text_but_not_binary() {
        assert!(detect(b"|RECORD=Board|KIND=Protel_Advanced_PCB|VERSION=5.01|"));
        assert!(!detect(b"|KIND=Protel_Advanced_PCB|PCB 6.0 Binary File"));
        assert!(!detect(&[0xD0, 0xCF, 0x11, 0xE0, 0, 0]));
    }
}
