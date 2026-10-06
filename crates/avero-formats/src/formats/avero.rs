//! Versioned local editor documents. Rebuild all indices from validated
//! geometry; never trust cached bounds or net membership supplied in JSON.
use crate::{
    builder::{RawBoard, RawPart, RawPin, RawTestPoint, RawTrace},
    model::*,
    ParseError,
};
use serde::Deserialize;
const F: FormatId = FormatId::Avero;
fn err(s: impl Into<String>) -> ParseError {
    ParseError::invalid(F, s)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    avero_board: u32,
    board: Geometry,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Geometry {
    unit: String,
    outline: Vec<Vec<Point>>,
    parts: Vec<PartData>,
    pins: Vec<PinData>,
    nets: Vec<NetData>,
    #[serde(default)]
    test_points: Vec<TestData>,
    #[serde(default)]
    traces: Vec<TraceData>,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default)]
    layers: Vec<LayerData>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartData {
    name: String,
    side: Side,
    mount: Mount,
    first_pin: usize,
    pin_count: usize,
    outline: Vec<Point>,
    device: Option<String>,
    package: Option<Package>,
    #[serde(default)]
    marker: bool,
    #[serde(default)]
    estimated: bool,
    #[serde(default)]
    pads: Vec<PadMark>,
}
#[derive(Deserialize)]
struct PinData {
    part: usize,
    number: String,
    name: Option<String>,
    x: f64,
    y: f64,
    radius: f64,
    side: Side,
    net: usize,
    probe: Option<i32>,
    pad: Option<PadShape>,
}
#[derive(Deserialize)]
struct NetData {
    name: String,
}
#[derive(Deserialize)]
struct TestData {
    kind: TestPointKind,
    x: f64,
    y: f64,
    radius: f64,
    side: Side,
    net: usize,
    probe: Option<i32>,
    name: Option<String>,
    via: Option<ViaData>,
}
#[derive(Deserialize)]
struct ViaData {
    layers: Vec<String>,
    drill: f64,
    buried: bool,
}
#[derive(Deserialize)]
struct TraceData {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    width: f64,
    side: Side,
    layer: usize,
    net: usize,
}
#[derive(Deserialize)]
struct LayerData {
    name: String,
}

pub fn detect(buf: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&buf[..buf.len().min(128)]);
    head.trim_start().starts_with('{') && head.contains("\"averoBoard\"")
}
pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let doc: Document = serde_json::from_slice(buf).map_err(|e| err(e.to_string()))?;
    if doc.avero_board != 1 || doc.board.unit != "mil" {
        return Err(err("unknown document version or coordinate unit"));
    }
    let g = doc.board;
    if g.parts.len() > 200_000 || g.pins.len() > 2_000_000 || g.traces.len() > 5_000_000 {
        return Err(err("too much geometry"));
    }
    let check = |p: Point| {
        if p.x.is_finite() && p.y.is_finite() && p.x.abs() < 1e9 && p.y.abs() < 1e9 {
            Ok(())
        } else {
            Err(err("invalid coordinate"))
        }
    };
    let net = |i: usize| g.nets.get(i).map(|n| n.name.clone()).ok_or_else(|| err("invalid net index"));
    let mut out = RawBoard::new(F);
    for path in g.outline {
        for p in &path {
            check(*p)?;
        }
        out.outline_segments.extend(path.windows(2).map(|w| (w[0], w[1])));
    }
    let mut seen = vec![false; g.pins.len()];
    for (i, p) in g.parts.into_iter().enumerate() {
        if p.name.trim().is_empty() {
            return Err(err("empty component name"));
        }
        let end = p.first_pin.checked_add(p.pin_count).ok_or_else(|| err("pin range overflow"))?;
        let pins = g.pins.get(p.first_pin..end).ok_or_else(|| err("invalid component pin range"))?;
        for v in &p.outline {
            check(*v)?;
        }
        for pad in &p.pads {
            check(Point::new(pad.x, pad.y))?;
            if !pad.radius.is_finite() || pad.radius <= 0. || pad.radius > 1e6 {
                return Err(err("invalid decorative pad"));
            }
        }
        let mut part = RawPart::new(p.name, p.side, p.mount);
        part.outline = Some(p.outline);
        part.device = p.device;
        part.package = p.package;
        part.marker = p.marker;
        part.estimated = p.estimated;
        part.pads = p.pads;
        for (j, pin) in pins.iter().enumerate() {
            if pin.part != i || seen[p.first_pin + j] {
                return Err(err("pin belongs to another component"));
            }
            seen[p.first_pin + j] = true;
            check(Point::new(pin.x, pin.y))?;
            if !pin.radius.is_finite() || pin.radius <= 0. || pin.radius > 1e6 {
                return Err(err("invalid pad radius"));
            }
            if let Some(s) = pin.pad {
                if ![s.w, s.h, s.angle].iter().all(|v| v.is_finite()) || s.w <= 0. || s.h <= 0. {
                    return Err(err("invalid pad shape"));
                }
            }
            part.pins.push(RawPin {
                pos: Point::new(pin.x, pin.y),
                side: Some(pin.side),
                net: net(pin.net)?,
                number: Some(pin.number.clone()),
                name: pin.name.clone(),
                radius: Some(pin.radius),
                probe: pin.probe,
                pad: pin.pad,
            });
        }
        out.parts.push(part);
    }
    if seen.iter().any(|v| !*v) {
        return Err(err("unowned pin"));
    }
    for p in g.test_points {
        check(Point::new(p.x, p.y))?;
        if !p.radius.is_finite() || p.radius <= 0. {
            return Err(err("invalid test point radius"));
        }
        if let Some(v) = p.via {
            if !v.drill.is_finite() || v.drill < 0. {
                return Err(err("invalid via drill"));
            }
            out.via_details.insert(
                out.test_points.len(),
                ViaDetails { layers: v.layers, drill: v.drill, buried: v.buried },
            );
        }
        out.test_points.push(RawTestPoint {
            kind: p.kind,
            pos: Point::new(p.x, p.y),
            side: p.side,
            net: net(p.net)?,
            probe: p.probe,
            radius: Some(p.radius),
            name: p.name,
        });
    }
    for t in g.traces {
        let from = Point::new(t.x1, t.y1);
        let to = Point::new(t.x2, t.y2);
        check(from)?;
        check(to)?;
        if !t.width.is_finite() || t.width < 0. {
            return Err(err("invalid trace width"));
        }
        let layer = g.layers.get(t.layer).ok_or_else(|| err("invalid layer index"))?.name.clone();
        out.traces.push(RawTrace { from, to, width: t.width, side: t.side, layer, net: net(t.net)? });
    }
    for w in g.warnings {
        out.warn(w);
    }
    Ok(out)
}

/// Readings are restored separately after geometry validation, using the
/// same quantity whitelist as the XZZ reader.
pub fn restore_readings(board: &mut Board, buf: &[u8]) -> Result<(), ParseError> {
    let doc: serde_json::Value = serde_json::from_slice(buf).map_err(|e| err(e.to_string()))?;
    if let Some(readings) = doc["board"]["readings"].as_array() {
        if readings.len() > 2_000_000 {
            return Err(err("too many readings"));
        }
        for r in readings {
            let quantity = match r["quantity"].as_str() {
                Some("diode") => "diode",
                Some("voltage") => "voltage",
                Some("resistance") => "resistance",
                _ => return Err(err("unknown reading quantity")),
            };
            let text = |key: &str| {
                r[key].as_str().map(str::to_string).ok_or_else(|| err(format!("missing reading {key}")))
            };
            let value = if r["value"].is_null() {
                None
            } else {
                Some(
                    r["value"]
                        .as_f64()
                        .filter(|v| v.is_finite())
                        .ok_or_else(|| err("invalid reading value"))?,
                )
            };
            if quantity != "voltage" && value.is_some_and(|v| v < 0.) {
                return Err(err("negative diode/resistance reading"));
            }
            let conditions: Option<MeasurementConditions> = if r["conditions"].is_null() {
                None
            } else {
                Some(
                    serde_json::from_value(r["conditions"].clone())
                        .map_err(|e| err(format!("invalid reading conditions: {e}")))?,
                )
            };
            if let Some(c) = &conditions {
                if c.power.as_deref().is_some_and(|v| !["off", "standby", "on"].contains(&v))
                    || c.polarity.as_deref().is_some_and(|v| !["red-gnd", "black-gnd"].contains(&v))
                    || c.assembly
                        .as_deref()
                        .is_some_and(|v| !["complete", "ic-removed", "parts-removed"].contains(&v))
                    || c.temperature.is_some_and(|v| !v.is_finite())
                {
                    return Err(err("invalid measurement conditions"));
                }
            }
            let part = text("part")?;
            let pin = text("pin")?;
            let matches = board
                .parts
                .iter()
                .enumerate()
                .filter(|(_, p)| p.name.eq_ignore_ascii_case(&part))
                .flat_map(|(i, _)| board.part_pins(i))
                .filter(|p| p.number.eq_ignore_ascii_case(&pin))
                .count();
            if matches != 1 {
                board
                    .warnings
                    .push(format!("Reading {part}.{pin} has {matches} matching pins and was not assigned."));
                continue;
            }
            let source_format = Some(r["sourceFormat"].as_str().unwrap_or("Avero").to_string());
            board.readings.push(FileReading {
                part,
                pin,
                quantity,
                value,
                raw: text("raw")?,
                list: text("list")?,
                source_format,
                conditions,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn editor_save_roundtrip_preserves_geometry_and_connectivity() {
        let mut b = crate::demo::board();
        b.pins[0].x += 37.;
        let json = serde_json::to_vec(&serde_json::json!({"averoBoard":1,"board":b})).unwrap();
        let got = crate::parse(&json, Some("edited.averoboard")).unwrap();
        assert_eq!(got.pins.len(), b.pins.len());
        assert!((got.pins[0].x - b.pins[0].x).abs() < 1e-9);
        assert_eq!(got.nets[got.pins[0].net as usize].name, b.nets[b.pins[0].net as usize].name);
    }
    #[test]
    fn forged_indices_fail_instead_of_panicking() {
        let b = crate::demo::board();
        let mut doc = serde_json::json!({"averoBoard":1,"board":b});
        doc["board"]["parts"][0]["firstPin"] = serde_json::json!(usize::MAX);
        assert!(crate::parse(&serde_json::to_vec(&doc).unwrap(), Some("bad.averoboard")).is_err());
    }
}
