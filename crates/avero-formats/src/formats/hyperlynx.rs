//! HyperLynx 2.x ASCII signal-integrity transfer files. Units come from the
//! UNITS record, never the extension. Copper pours are explicitly reported.
use crate::{
    builder::{RawBoard, RawPart, RawPin, RawTestPoint, RawTrace},
    model::*,
    ParseError,
};
use std::collections::HashMap;
const F: FormatId = FormatId::HyperLynx;
fn err(s: impl Into<String>) -> ParseError {
    ParseError::invalid(F, s)
}
pub fn detect(buf: &[u8]) -> bool {
    let s = String::from_utf8_lossy(&buf[..buf.len().min(8192)]);
    s.contains("{VERSION=") && s.contains("{UNITS=")
}
fn fields(s: &str) -> HashMap<String, String> {
    let mut parts = Vec::new();
    let mut at = 0;
    let mut quoted = false;
    for (i, c) in s.char_indices() {
        if c == '"' {
            quoted = !quoted;
        }
        if c.is_whitespace() && !quoted {
            if i > at {
                parts.push(&s[at..i]);
            }
            at = i + c.len_utf8();
        }
    }
    if at < s.len() {
        parts.push(&s[at..]);
    }
    parts
        .into_iter()
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_string(), v.trim_matches('"').to_string()))
        .collect()
}
fn number(f: &HashMap<String, String>, key: &str) -> Result<f64, ParseError> {
    f.get(key)
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .ok_or_else(|| err(format!("missing/invalid {key}")))
}
fn side(layer: &str) -> Side {
    match layer.to_ascii_lowercase().as_str() {
        "top" | "1" => Side::Top,
        "bottom" | "2" => Side::Bottom,
        _ => Side::Both,
    }
}
#[derive(Clone)]
struct Stack {
    layer: String,
    w: f64,
    h: f64,
    angle: f64,
    round: bool,
    hole: f64,
}
pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let text = crate::text::decode(buf);
    if !detect(buf) {
        return Err(err("missing HyperLynx header"));
    }
    let scale = if text.contains("{UNITS=ENGLISH") {
        1000.
    } else if text.contains("{UNITS=METRIC") {
        1000. / 0.0254
    } else {
        return Err(err("unsupported/unspecified length unit"));
    };
    let mut out = RawBoard::new(F);
    let mut stacks: HashMap<String, Stack> = HashMap::new();
    let mut components = HashMap::new();
    let mut context = Vec::<String>::new();
    let mut pours = 0;
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('*') || line.starts_with("//") {
            continue;
        }
        if let Some(rest) = line.strip_prefix('{') {
            let title = rest.split('}').next().unwrap_or(rest).trim().to_string();
            if !line.contains('}') {
                context.push(title.clone());
            }
            if title.starts_with("POLYGON ") || title.starts_with("POLYVOID ") {
                pours += 1;
            }
            continue;
        }
        if line.starts_with('}') {
            context.pop();
            continue;
        }
        let Some(record) = line.strip_prefix('(').and_then(|s| s.split_once(')').map(|(a, _)| a)) else {
            continue;
        };
        if let Some(title) = context.last().and_then(|s| s.strip_prefix("PADSTACK=")) {
            let mut name = title.split(',');
            let id = name.next().unwrap_or("");
            let hole = name.next().and_then(|n| n.parse::<f64>().ok()).unwrap_or(0.) * scale;
            let row: Vec<_> = record.split(',').map(str::trim).collect();
            if row.len() < 5 {
                return Err(err("short pad-stack row"));
            }
            let n = |i: usize| {
                row[i]
                    .parse::<f64>()
                    .ok()
                    .filter(|v| v.is_finite())
                    .ok_or_else(|| err("invalid pad-stack dimensions"))
            };
            let candidate = Stack {
                layer: row[0].into(),
                w: n(2)? * scale,
                h: n(3)? * scale,
                angle: n(4)?,
                round: row[1] == "0",
                hole,
            };
            stacks.entry(id.into()).or_insert(candidate);
            continue;
        }
        let kind = record.split_whitespace().next().unwrap_or("");
        let f = fields(record);
        let p = |x: &str, y: &str| -> Result<Point, ParseError> {
            Ok(Point::new(number(&f, x)? * scale, number(&f, y)? * scale))
        };
        if context.last().is_some_and(|s| s == "DEVICES") {
            let Some(name) = f.get("REF") else {
                continue;
            };
            let layer = f.get("L").map(String::as_str).unwrap_or("Top");
            let idx = out.parts.len();
            let mut part = RawPart::new(name, side(layer), Mount::Smd);
            part.device = f.get("NAME").cloned();
            components.insert(name.clone(), idx);
            out.parts.push(part);
            continue;
        }
        let net = context
            .iter()
            .rev()
            .find_map(|s| s.strip_prefix("NET="))
            .unwrap_or("")
            .trim_matches('"')
            .to_string();
        let layer = f.get("L").cloned().unwrap_or_else(|| "Top".into());
        match kind {
            "PERIMETER_SEGMENT" => out.outline_segments.push((p("X1", "Y1")?, p("X2", "Y2")?)),
            "SEG" => out.traces.push(RawTrace {
                from: p("X1", "Y1")?,
                to: p("X2", "Y2")?,
                width: number(&f, "W")? * scale,
                side: side(&layer),
                layer,
                net,
            }),
            "ARC" | "PERIMETER_ARC" => {
                let a = p("X1", "Y1")?;
                let b = p("X2", "Y2")?;
                let c = p("XC", "YC")?;
                let radius = a.distance(c);
                let start = (a.y - c.y).atan2(a.x - c.x);
                let end = (b.y - c.y).atan2(b.x - c.x);
                let sweep = (end - start).rem_euclid(std::f64::consts::TAU);
                let mut previous = a;
                for i in 1..=48 {
                    let angle = start + sweep * i as f64 / 48.;
                    let next = if i == 48 {
                        b
                    } else {
                        Point::new(c.x + radius * angle.cos(), c.y + radius * angle.sin())
                    };
                    if kind == "PERIMETER_ARC" {
                        out.outline_segments.push((previous, next));
                    } else {
                        out.traces.push(RawTrace {
                            from: previous,
                            to: next,
                            width: number(&f, "W")? * scale,
                            side: side(&layer),
                            layer: layer.clone(),
                            net: net.clone(),
                        });
                    }
                    previous = next;
                }
            }
            "PIN" => {
                let pos = p("X", "Y")?;
                let refdes = f
                    .get("R")
                    .and_then(|s| s.rsplit_once('.'))
                    .ok_or_else(|| err("pin lacks component/pin reference"))?;
                let idx = if let Some(i) = components.get(refdes.0) {
                    *i
                } else {
                    let i = out.parts.len();
                    out.parts.push(RawPart::new(refdes.0, side(&layer), Mount::Smd));
                    components.insert(refdes.0.into(), i);
                    i
                };
                let stack = f.get("P").and_then(|s| stacks.get(s));
                let mut pin = RawPin { pos, number: Some(refdes.1.into()), net, ..Default::default() };
                if let Some(s) = stack {
                    pin.side = Some(if s.hole > 0. { Side::Both } else { side(&s.layer) });
                    pin.radius = Some(s.w.max(s.h) / 2.);
                    pin.pad = Some(PadShape { w: s.w, h: s.h, angle: s.angle, round: s.round });
                    if s.hole > 0. {
                        out.parts[idx].mount = Mount::ThroughHole;
                    }
                } else {
                    out.warn("A pin has no available pad stack; its pad size is derived from spacing.");
                }
                out.parts[idx].pins.push(pin);
            }
            "VIA" => {
                let pos = p("X", "Y")?;
                let stack = f.get("P").and_then(|s| stacks.get(s));
                let radius = stack.map(|s| s.w.max(s.h) / 2.);
                let l1 = f.get("L1").cloned().unwrap_or_else(|| "Top".into());
                let l2 = f.get("L2").cloned().unwrap_or_else(|| "Bottom".into());
                let buried = side(&l1) == Side::Both && side(&l2) == Side::Both;
                out.via_details.insert(
                    out.test_points.len(),
                    ViaDetails { layers: vec![l1, l2], drill: stack.map(|s| s.hole).unwrap_or(0.), buried },
                );
                out.test_points.push(RawTestPoint {
                    kind: TestPointKind::Via,
                    pos,
                    side: Side::Both,
                    net,
                    probe: None,
                    radius,
                    name: None,
                });
            }
            _ => {}
        }
    }
    if !context.is_empty() {
        return Err(err("unclosed HyperLynx section"));
    }
    if pours > 0 {
        out.warn(format!("{pours} polygon/void records are not drawn as filled copper; component connectivity is imported."));
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    #[test]
    fn metric_is_meters_not_mm_and_net_names_come_from_net_blocks() {
        let b=crate::parse(b"{VERSION=2.10}\n{UNITS=METRIC LENGTH}\n{DEVICES\n(? REF=U1 NAME=IC L=Top)\n}\n{NET=VCC\n(PIN X=0.0254 Y=0.0127 R=U1.1)\n}\n",Some("test.hyp")).unwrap();
        assert!((b.pins[0].x - 1000.).abs() < 1e-9);
        assert!((b.pins[0].y - 500.).abs() < 1e-9);
        assert_eq!(b.nets[b.pins[0].net as usize].name, "VCC");
    }
}
