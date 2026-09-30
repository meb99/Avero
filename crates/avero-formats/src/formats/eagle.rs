//! Autodesk EAGLE and Fusion 360 boards (`.brd`, XML, EAGLE 6 and later).
//!
//! Read are the packages of the embedded libraries (SMD and through-hole
//! pads), the placed elements (name, value, position, rotation `R90`,
//! mirrored = bottom `MR90`), the signals (which element pad belongs to
//! which net, plus vias) and the board outline from layer 20 (Dimension).
//! Coordinates are millimetres with Y pointing up. Binary EAGLE files from
//! before version 6 are not supported.

use std::collections::HashMap;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::decode;
use crate::ParseError;

const MILS_PER_MM: f64 = 1000.0 / 25.4;
const DIMENSION_LAYER: &str = "20";

pub fn detect(buf: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&buf[..buf.len().min(1024)]);
    head.trim_start_matches('\u{feff}').trim_start().starts_with('<') && head.contains("<eagle")
}

fn err(message: impl Into<String>) -> ParseError {
    ParseError::invalid(FormatId::Eagle, message)
}

struct PadDef {
    name: String,
    x: f64,
    y: f64,
    through: bool,
    radius: Option<f64>,
}

struct Element {
    name: String,
    value: String,
    library: String,
    package: String,
    x: f64,
    y: f64,
    angle: f64,
    mirror: bool,
}

fn attrs(e: &BytesStart) -> HashMap<String, String> {
    e.attributes()
        .filter_map(Result::ok)
        .filter_map(|a| {
            let key = a.key.as_ref().to_string();
            a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok().map(|v| (key, v.into_owned()))
        })
        .collect()
}

fn num(a: &HashMap<String, String>, key: &str) -> f64 {
    a.get(key).and_then(|v| v.trim().parse().ok()).unwrap_or(0.0)
}

/// `R90`, `MR180`, `SMR270` → (angle in degrees, mirrored).
fn rotation(rot: Option<&String>) -> (f64, bool) {
    let rot = rot.map(String::as_str).unwrap_or("");
    let mirror = rot.contains('M');
    let angle = rot.rsplit_once('R').and_then(|(_, a)| a.parse().ok()).unwrap_or(0.0);
    (angle, mirror)
}

fn mils(x: f64, y: f64) -> Point {
    Point::new(x * MILS_PER_MM, y * MILS_PER_MM)
}

/// Straight or curved wire (`curve` is the arc angle in degrees).
fn wire_segments(a: &HashMap<String, String>, out: &mut Vec<(Point, Point)>) {
    let (x1, y1, x2, y2) = (num(a, "x1"), num(a, "y1"), num(a, "x2"), num(a, "y2"));
    let curve = num(a, "curve");
    if curve.abs() < 1e-6 {
        out.push((mils(x1, y1), mils(x2, y2)));
        return;
    }
    // Arc through both ends, sweeping `curve` degrees counter-clockwise.
    let sweep = curve.to_radians();
    let (dx, dy) = (x2 - x1, y2 - y1);
    let chord = (dx * dx + dy * dy).sqrt();
    if chord < 1e-9 {
        return;
    }
    let r = chord / (2.0 * (sweep / 2.0).sin()).abs();
    // The center lies on the chord's normal; tan handles direction and sweeps over 180°.
    let d = (chord / 2.0) / (sweep / 2.0).tan();
    let (mx, my) = ((x1 + x2) / 2.0, (y1 + y2) / 2.0);
    let (cx, cy) = (mx - d * dy / chord, my + d * dx / chord);
    let a0 = (y1 - cy).atan2(x1 - cx);
    let steps = ((sweep.abs() / std::f64::consts::TAU) * 48.0).ceil().max(2.0) as usize;
    let at = |k: usize| {
        let t = a0 + sweep * k as f64 / steps as f64;
        mils(cx + r * t.cos(), cy + r * t.sin())
    };
    for k in 0..steps {
        out.push((at(k), at(k + 1)));
    }
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let text = decode(buf);
    let mut reader = Reader::from_str(&text);

    let mut packages: HashMap<(String, String), Vec<PadDef>> = HashMap::new();
    let mut elements: Vec<Element> = Vec::new();
    let mut pad_net: HashMap<(String, String), String> = HashMap::new();
    let mut vias: Vec<(Point, String, Option<f64>)> = Vec::new();
    let mut outline = Vec::new();

    // Where we are in the tree.
    let (mut library, mut package, mut signal) = (String::new(), None::<String>, None::<String>);
    let (mut in_plain, mut in_board) = (false, false);

    loop {
        let event = reader.read_event().map_err(|e| err(format!("XML: {e}")))?;
        let (e, empty) = match &event {
            Event::Start(e) => (e, false),
            Event::Empty(e) => (e, true),
            Event::End(end) => {
                match end.name().as_ref() {
                    "library" => library.clear(),
                    "package" => package = None,
                    "signal" => signal = None,
                    "plain" => in_plain = false,
                    "board" => in_board = false,
                    _ => {}
                }
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        let a = attrs(e);
        match e.name().as_ref() {
            "board" if !empty => in_board = true,
            "plain" if !empty => in_plain = true,
            "library" if !empty && in_board => library = a.get("name").cloned().unwrap_or_default(),
            "package" if !empty && !library.is_empty() => package = a.get("name").cloned(),
            "signal" if !empty => signal = a.get("name").cloned(),
            "smd" | "pad" => {
                if let Some(pkg) = &package {
                    let through = e.name().as_ref() == "pad";
                    let radius = if through {
                        let d = num(&a, "diameter");
                        (d > 0.0).then(|| d * MILS_PER_MM / 2.0)
                    } else {
                        Some(num(&a, "dx").max(num(&a, "dy")) * MILS_PER_MM / 2.0)
                    };
                    packages.entry((library.clone(), pkg.clone())).or_default().push(PadDef {
                        name: a.get("name").cloned().unwrap_or_default(),
                        x: num(&a, "x"),
                        y: num(&a, "y"),
                        through,
                        radius,
                    });
                }
            }
            "element" => {
                let (angle, mirror) = rotation(a.get("rot"));
                elements.push(Element {
                    name: a.get("name").cloned().unwrap_or_default(),
                    value: a.get("value").cloned().unwrap_or_default(),
                    library: a.get("library").cloned().unwrap_or_default(),
                    package: a.get("package").cloned().unwrap_or_default(),
                    x: num(&a, "x"),
                    y: num(&a, "y"),
                    angle,
                    mirror,
                });
            }
            "contactref" => {
                if let (Some(net), Some(el), Some(pad)) = (&signal, a.get("element"), a.get("pad")) {
                    pad_net.insert((el.clone(), pad.clone()), net.clone());
                }
            }
            "via" => {
                if let Some(net) = &signal {
                    let d = num(&a, "diameter").max(num(&a, "drill"));
                    vias.push((
                        mils(num(&a, "x"), num(&a, "y")),
                        net.clone(),
                        (d > 0.0).then(|| d * MILS_PER_MM / 2.0),
                    ));
                }
            }
            "wire" if in_plain && a.get("layer").map(String::as_str) == Some(DIMENSION_LAYER) => {
                wire_segments(&a, &mut outline);
            }
            _ => {}
        }
    }

    if elements.is_empty() && packages.is_empty() {
        return Err(err("no board data (EAGLE schematic or library file?)"));
    }

    let mut board = RawBoard::new(FormatId::Eagle);
    let mut missing = 0usize;
    for el in elements {
        let Some(pads) = packages.get(&(el.library.clone(), el.package.clone())) else {
            missing += 1;
            continue;
        };
        let side = if el.mirror { Side::Bottom } else { Side::Top };
        let mut part = RawPart::new(el.name.clone(), side, Mount::Smd);
        part.device = (!el.value.is_empty()).then(|| el.value.clone());
        let (s, c) = el.angle.to_radians().sin_cos();
        for pad in pads {
            let x = if el.mirror { -pad.x } else { pad.x };
            let (dx, dy) = (x * c - pad.y * s, x * s + pad.y * c);
            if pad.through {
                part.mount = Mount::ThroughHole;
            }
            part.pins.push(RawPin {
                pos: mils(el.x + dx, el.y + dy),
                side: pad.through.then_some(Side::Both),
                net: pad_net.get(&(el.name.clone(), pad.name.clone())).cloned().unwrap_or_default(),
                number: Some(pad.name.clone()),
                radius: pad.radius,
                ..Default::default()
            });
        }
        if !part.pins.is_empty() {
            board.parts.push(part);
        }
    }
    if missing > 0 {
        board.warn(format!("{missing} elements reference packages that are not in the file"));
    }
    for (pos, net, radius) in vias {
        board.test_points.push(RawTestPoint {
            kind: TestPointKind::Via,
            pos,
            side: Side::Both,
            net,
            probe: None,
            radius,
            name: None,
        });
    }
    board.outline_segments = outline;
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rotations() {
        assert_eq!(rotation(Some(&"R90".into())), (90.0, false));
        assert_eq!(rotation(Some(&"MR180".into())), (180.0, true));
        assert_eq!(rotation(Some(&"SMR270".into())), (270.0, true));
        assert_eq!(rotation(None), (0.0, false));
    }
}
