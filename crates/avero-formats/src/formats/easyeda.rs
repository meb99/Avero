//! EasyEDA Pro V2 line-array projects, with local footprint resolution.
use crate::{
    builder::{RawBoard, RawPart, RawPin, RawTestPoint, RawTrace},
    model::*,
    project::Files,
    ParseError,
};
use serde_json::Value;
use std::collections::HashMap;
const F: FormatId = FormatId::EasyEdaPro;
fn err(s: impl Into<String>) -> ParseError {
    ParseError::invalid(F, s)
}
fn records(bytes: &[u8]) -> Result<Vec<Vec<Value>>, ParseError> {
    let text = std::str::from_utf8(bytes).map_err(|_| err("Expected UTF-8 project records"))?;
    let mut rows = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let row: Vec<Value> = serde_json::from_str(line).map_err(|e| err(e.to_string()))?;
        rows.push(row);
        if rows.len() > 2_000_000 {
            return Err(err("Too many EasyEDA records"));
        }
    }
    Ok(rows)
}
fn text(row: &[Value], i: usize) -> &str {
    row.get(i).and_then(Value::as_str).unwrap_or("")
}
fn n(row: &[Value], i: usize) -> Result<f64, ParseError> {
    row.get(i)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && v.abs() < 1e9)
        .ok_or_else(|| err(format!("Missing/invalid field {i} in {}", text(row, 0))))
}
fn side(layer: i64) -> Side {
    match layer {
        1 => Side::Top,
        2 => Side::Bottom,
        _ => Side::Both,
    }
}
fn layer_name(layer: i64, names: &HashMap<i64, String>) -> String {
    names.get(&layer).cloned().unwrap_or_else(|| format!("LAYER_{layer}"))
}
fn polygon(row: &[Value], s: f64) -> Result<Vec<Point>, ParseError> {
    let p = |x: f64, y: f64| Point::new(x * s, y * s);
    if text(row, 0) == "R" {
        let x = n(row, 1)?;
        let y = n(row, 2)?;
        let w = n(row, 3)?;
        let h = n(row, 4)?;
        let a = n(row, 5)?.to_radians();
        let transform =
            |dx: f64, dy: f64| p(x + dx * a.cos() - dy * a.sin(), y + dx * a.sin() + dy * a.cos());
        return Ok(vec![
            transform(0., 0.),
            transform(w, 0.),
            transform(w, -h),
            transform(0., -h),
            transform(0., 0.),
        ]);
    }
    if text(row, 0) == "CIRCLE" {
        let x = n(row, 1)?;
        let y = n(row, 2)?;
        let r = n(row, 3)?;
        return Ok((0..=96)
            .map(|i| {
                let a = i as f64 * std::f64::consts::TAU / 96.;
                p(x + r * a.cos(), y + r * a.sin())
            })
            .collect());
    }
    let mut out = vec![];
    let mut i = 0;
    while i < row.len() {
        if text(row, i) == "L" {
            i += 1;
            continue;
        }
        if row[i].is_string() {
            return Err(err("Curved/Bezier polygon path is not supported"));
        }
        out.push(p(n(row, i)?, n(row, i + 1)?));
        i += 2;
    }
    if out.len() > 2 && out.first() != out.last() {
        out.push(out[0]);
    }
    Ok(out)
}
pub fn detect(bytes: &[u8]) -> bool {
    let s = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]);
    s.contains("\"DOCTYPE\"") && s.contains("\"PCB\"")
}
pub fn parse(files: &Files, member: &str) -> Result<RawBoard, ParseError> {
    let bytes = files.get(member).ok_or_else(|| err("PCB member is missing"))?;
    let rows = records(bytes)?;
    let version = rows.iter().find(|r| text(r, 0) == "DOCTYPE").map(|r| text(r, 2)).unwrap_or("");
    if version != "1.8" {
        return Err(err(format!(
            "EasyEDA Pro record version {version:?} is not verified (supported: 1.8/V2)"
        )));
    }
    // The exported 1.8 PCB/footprint coordinates are mils, independently of
    // the display/grid unit in CANVAS. Newer V3 records use a different schema.
    let scale = 1.;
    let mut out = RawBoard::new(F);
    let mut attrs: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut mappings = HashMap::new();
    let mut layers = HashMap::new();
    for row in &rows {
        match text(row, 0) {
            "LAYER" => {
                let id = n(row, 1)? as i64;
                layers.insert(id, text(row, 3).to_string());
            }
            "ATTR" => {
                let offset = if row.get(5).is_some_and(Value::is_string) { 5 } else { 7 };
                attrs
                    .entry(text(row, 3).into())
                    .or_default()
                    .insert(text(row, offset).into(), text(row, offset + 1).into());
            }
            "PAD_NET" => {
                mappings
                    .insert((text(row, 1).to_string(), text(row, 2).to_string()), text(row, 3).to_string());
            }
            _ => {}
        }
    }
    let prefix = member.rsplit_once("PCB/").map(|(p, _)| p).unwrap_or("");
    let mut footprints: HashMap<String, Vec<Vec<Value>>> = HashMap::new();
    let mut unshown = HashMap::<String, usize>::new();
    for row in &rows {
        match text(row, 0) {
            "COMPONENT" => {
                let id = text(row, 1);
                let given = attrs.get(id);
                let prop = |key: &str| {
                    given
                        .and_then(|a| a.get(key).map(String::as_str))
                        .or_else(|| row.get(7).and_then(|p| p.get(key)).and_then(Value::as_str))
                        .unwrap_or("")
                };
                let name = prop("Designator");
                if name.is_empty() {
                    return Err(err(format!("Component {id} has no designator")));
                }
                let fp = prop("Footprint");
                if fp.is_empty() {
                    return Err(err(format!("Component {name} has no local footprint reference")));
                }
                if !footprints.contains_key(fp) {
                    let path = format!("{prefix}FOOTPRINT/{fp}.efoo");
                    let bytes = files.get(&path).ok_or_else(|| {
                        err(format!(
                            "Footprint for {name} is missing: {path}. Open the complete .epro project."
                        ))
                    })?;
                    footprints.insert(fp.into(), records(bytes)?);
                }
                let component_side = side(n(row, 3)? as i64);
                let x = n(row, 4)? * scale;
                let y = n(row, 5)? * scale;
                let angle = n(row, 6)?;
                let a = angle.to_radians();
                let transform = |p: Point| {
                    let px = if component_side == Side::Bottom { -p.x } else { p.x };
                    Point::new(x + px * a.cos() - p.y * a.sin(), y + px * a.sin() + p.y * a.cos())
                };
                let mut part = RawPart::new(name, component_side, Mount::Smd);
                part.device = Some(prop("Name").to_string()).filter(|s| !s.is_empty());
                for pad in footprints[fp].iter().filter(|p| text(p, 0) == "PAD") {
                    let number = text(pad, 5).to_owned();
                    if number.is_empty() {
                        return Err(err(format!("Unnamed pad in {name}")));
                    }
                    let pos = transform(Point::new(n(pad, 6)? * scale, n(pad, 7)? * scale));
                    let shape =
                        pad.get(10).and_then(Value::as_array).ok_or_else(|| err("Pad shape is missing"))?;
                    let w = n(shape, 1)? * scale;
                    let h = shape.get(2).and_then(Value::as_f64).unwrap_or(w / scale) * scale;
                    if w <= 0. || h <= 0. {
                        return Err(err("Invalid pad dimensions"));
                    }
                    let round = matches!(text(shape, 0), "ROUND" | "ELLIPSE" | "OBLONG");
                    if !round && text(shape, 0) != "RECT" {
                        *unshown.entry("custom pad outline (drawn as bounds)".into()).or_default() += 1;
                    }
                    let through = pad.get(9).is_some_and(|v| !v.is_null());
                    if through {
                        part.mount = Mount::ThroughHole;
                    }
                    let pa = n(pad, 8)?;
                    part.pins.push(RawPin {
                        pos,
                        side: Some(if through { Side::Both } else { component_side }),
                        net: mappings
                            .get(&(id.into(), number.clone()))
                            .cloned()
                            .unwrap_or_else(|| text(pad, 3).into()),
                        number: Some(number),
                        radius: Some(w.min(h) / 2.),
                        pad: Some(PadShape {
                            w,
                            h,
                            angle: angle + if component_side == Side::Bottom { -pa } else { pa },
                            round,
                        }),
                        ..Default::default()
                    });
                }
                if part.pins.is_empty() {
                    return Err(err(format!("No pads resolved for {name}")));
                }
                out.parts.push(part);
            }
            "LINE" => {
                let layer = n(row, 4)? as i64;
                let from = Point::new(n(row, 5)? * scale, n(row, 6)? * scale);
                let to = Point::new(n(row, 7)? * scale, n(row, 8)? * scale);
                if layer == 11 {
                    out.outline_segments.push((from, to));
                } else if matches!(layer, 1 | 2 | 15..=46) {
                    out.traces.push(RawTrace {
                        from,
                        to,
                        width: n(row, 9)? * scale,
                        side: side(layer),
                        layer: layer_name(layer, &layers),
                        net: text(row, 3).into(),
                    });
                }
            }
            "POLY" => {
                let layer = n(row, 4)? as i64;
                if layer == 11 {
                    let path = row
                        .get(6)
                        .and_then(Value::as_array)
                        .ok_or_else(|| err("Board outline is missing"))?;
                    let points = polygon(path, scale)?;
                    for pair in points.windows(2) {
                        out.outline_segments.push((pair[0], pair[1]));
                    }
                } else {
                    *unshown.entry("polygon".into()).or_default() += 1;
                }
            }
            "VIA" => {
                let pos = Point::new(n(row, 5)? * scale, n(row, 6)? * scale);
                out.test_points.push(RawTestPoint {
                    kind: TestPointKind::Via,
                    pos,
                    side: Side::Both,
                    net: text(row, 3).into(),
                    probe: None,
                    radius: Some(n(row, 8)? * scale / 2.),
                    name: None,
                });
                *unshown.entry("via rule/span".into()).or_default() += 1;
            }
            "PAD" => return Err(err("Standalone PCB pads require an explicit component mapping")),
            "POUR" | "FILL" | "REGION" | "ARC" | "CARC" | "STRING" => {
                *unshown.entry(text(row, 0).into()).or_default() += 1;
            }
            _ => {}
        }
    }
    for (kind, count) in unshown {
        out.warn(format!("EasyEDA Pro: {count} {kind} records are not fully drawn/decoded."));
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn footprint_rotation_bottom_and_named_connectivity() {
        let pcb=b"[\"DOCTYPE\",\"PCB\",\"1.8\"]\n[\"COMPONENT\",\"c\",0,2,100,200,90,{\"Designator\":\"U1\",\"Footprint\":\"fp\"},0]\n[\"PAD_NET\",\"c\",\"A1\",\"GND\"]";
        let fp = b"[\"PAD\",\"p\",0,\"\",1,\"A1\",10,0,0,null,[\"RECT\",20,30]]";
        let files =
            Files::from([("PCB/a.epcb".into(), pcb.to_vec()), ("FOOTPRINT/fp.efoo".into(), fp.to_vec())]);
        let b = crate::project::parse_member(&files, None).unwrap();
        assert!((b.pins[0].x - 100.).abs() < 1e-9);
        assert!((b.pins[0].y - 190.).abs() < 1e-9);
        assert_eq!(b.pins[0].side, Side::Bottom);
        assert_eq!(b.nets[b.pins[0].net as usize].name, "GND");
        assert_eq!(b.pins[0].pad.unwrap().w, 20.);
    }
    #[test]
    fn missing_footprint_is_reported_not_guessed() {
        let files=Files::from([("PCB/a.epcb".into(),b"[\"DOCTYPE\",\"PCB\",\"1.8\"]\n[\"COMPONENT\",\"c\",0,1,0,0,0,{\"Designator\":\"U1\",\"Footprint\":\"missing\"},0]".to_vec())]);
        assert!(parse(&files, "PCB/a.epcb").unwrap_err().to_string().contains("complete .epro"));
    }
}
