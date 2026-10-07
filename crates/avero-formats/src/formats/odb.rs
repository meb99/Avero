//! ODB++ assembly/connectivity and line copper from local project files.
use crate::{
    builder::{RawBoard, RawPart, RawPin, RawTrace},
    model::*,
    project::{content, Files},
    ParseError,
};
use std::collections::HashMap;
const F: FormatId = FormatId::Odb;
fn err(s: impl Into<String>) -> ParseError {
    ParseError::invalid(F, s)
}
fn data(files: &Files, name: &str) -> Result<String, ParseError> {
    let bytes = content(files, name)?.ok_or_else(|| err(format!("Missing {name}")))?;
    std::str::from_utf8(&bytes).map(str::to_owned).map_err(|_| err("ODB++ text is not UTF-8/ASCII"))
}
fn number(row: &[&str], i: usize) -> Result<f64, ParseError> {
    row.get(i).and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && v.abs() < 1e9).ok_or_else(
        || err(format!("Invalid numeric field {i} in {}", row.first().copied().unwrap_or("record"))),
    )
}
fn integer(row: &[&str], i: usize) -> Result<usize, ParseError> {
    row.get(i).and_then(|v| v.parse::<usize>().ok()).ok_or_else(|| err("Invalid ODB++ index"))
}
fn scale(text: &str, default: f64) -> Result<f64, ParseError> {
    for l in text.lines().take(60) {
        if let Some(unit) = l.trim().strip_prefix("UNITS=") {
            return match unit.trim() {
                "MM" => Ok(1000. / 25.4),
                "INCH" => Ok(1000.),
                _ => Err(err(format!("Unknown ODB++ unit {unit}"))),
            };
        }
    }
    Ok(default)
}
fn line(row: &str) -> Vec<&str> {
    row.split(';').next().unwrap_or(row).split_whitespace().collect()
}
fn net_name(nets: &[String], index: usize) -> Result<String, ParseError> {
    let name = nets.get(index).ok_or_else(|| err(format!("Net index {index} does not exist")))?;
    Ok(if name == "$NONE$" { "UNCONNECTED".into() } else { name.clone() })
}
#[derive(Default)]
struct Package {
    pins: Vec<String>,
}
pub fn parse(files: &Files, step: &str) -> Result<RawBoard, ParseError> {
    let root = step.rsplit_once("steps/").map(|(r, _)| r).unwrap_or("");
    let job_unit = content(files, &format!("{root}misc/info"))?
        .map(|b| scale(&String::from_utf8_lossy(&b), 1000.))
        .transpose()?
        .unwrap_or(1000.);
    let eda = data(files, &format!("{step}/eda/data"))?;
    let mut out = RawBoard::new(F);
    let mut nets = vec![];
    let mut packages: Vec<Package> = vec![];
    let mut eda_layers = vec![];
    let mut feature_nets = HashMap::new();
    let mut current_net = None;
    for l in eda.lines() {
        let r = line(l);
        match r.first().copied() {
            Some("NET") => {
                let name = r.get(1).ok_or_else(|| err("Unnamed net"))?;
                current_net = Some(nets.len());
                nets.push((*name).to_owned());
            }
            Some("LYR") => eda_layers = r[1..].iter().map(|n| (*n).to_owned()).collect(),
            Some("PKG") => packages.push(Package::default()),
            Some("PIN") => {
                if let Some(p) = packages.last_mut() {
                    p.pins.push(r.get(1).copied().ok_or_else(|| err("Unnamed package pin"))?.into());
                }
            }
            Some("FID") => {
                if let Some(net) = current_net {
                    let layer = integer(&r, 2)?;
                    let index = integer(&r, 3)?;
                    let name = eda_layers.get(layer).ok_or_else(|| err("FID layer does not exist"))?;
                    if let Some(old) = feature_nets.insert((name.clone(), index), net) {
                        if old != net {
                            return Err(err("Conflicting feature nets"));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let mut placements = false;
    for (layer, side) in [("comp_+_top", Side::Top), ("comp_+_bot", Side::Bottom)] {
        let name = format!("{step}/layers/{layer}/components");
        let Some(bytes) = content(files, &name)? else {
            continue;
        };
        placements = true;
        let text = std::str::from_utf8(&bytes).map_err(|_| err("Invalid component text"))?;
        let s = scale(text, job_unit)?;
        let mut current: Option<(usize, usize)> = None;
        for raw in text.lines() {
            let r = line(raw);
            match r.first().copied() {
                Some("CMP") => {
                    if r.len() < 8 {
                        return Err(err("Short component record"));
                    }
                    let pkg = integer(&r, 1)?;
                    if pkg >= packages.len() {
                        return Err(err("Component package does not exist"));
                    }
                    let x = number(&r, 2)? * s;
                    let y = number(&r, 3)? * s;
                    number(&r, 4)?;
                    let mut p = RawPart::new(r[6], side, Mount::Smd);
                    p.device = Some(r[7].into()).filter(|v| v != "???");
                    p.outline = Some(vec![
                        Point::new(x - 10., y - 10.),
                        Point::new(x + 10., y - 10.),
                        Point::new(x + 10., y + 10.),
                        Point::new(x - 10., y + 10.),
                    ]);
                    p.marker = true;
                    let index = out.parts.len();
                    out.parts.push(p);
                    current = Some((index, pkg));
                }
                Some("TOP") => {
                    let (index, pkg) = current.ok_or_else(|| err("Toeprint has no component"))?;
                    let pin_index = integer(&r, 1)?;
                    let package_name = packages[pkg]
                        .pins
                        .get(pin_index)
                        .ok_or_else(|| err("Toeprint pin is not in its package"))?;
                    let number = r
                        .get(8)
                        .filter(|v| !v.is_empty())
                        .map(|v| (*v).to_owned())
                        .unwrap_or_else(|| package_name.clone());
                    if &number != package_name {
                        out.warn(format!("ODB++ toeprint {number} differs from package pin {package_name}; the explicit toeprint name is retained."));
                    }
                    let pin = RawPin {
                        pos: Point::new(number_field(&r, 2)? * s, number_field(&r, 3)? * s),
                        number: Some(number),
                        net: net_name(&nets, integer(&r, 6)?)?,
                        ..Default::default()
                    };
                    out.parts[index].pins.push(pin);
                    out.parts[index].outline = None;
                    out.parts[index].marker = false;
                }
                Some("PRP") => {
                    if let Some((i, _)) = current {
                        if r.get(1).is_some_and(|v| matches!(*v, "VALUE" | "PART_NUMBER")) {
                            if let Some((_, value)) = raw.split_once('\'') {
                                out.parts[i].device = Some(value.split('\'').next().unwrap_or(value).into());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if !placements {
        return Err(err("No component layers found. Panel steps and CMP-only EDA variants are not supported; choose an assembly step."));
    }
    if let Some(bytes) = content(files, &format!("{step}/profile"))? {
        let text = String::from_utf8_lossy(&bytes);
        let s = scale(&text, job_unit)?;
        let mut path = Vec::new();
        let mut curves = 0;
        for raw in text.lines() {
            let r = line(raw);
            match r.first().copied() {
                Some("OB") => {
                    path.clear();
                    path.push(Point::new(number(&r, 1)? * s, number(&r, 2)? * s));
                }
                Some("OS") => path.push(Point::new(number(&r, 1)? * s, number(&r, 2)? * s)),
                Some("OC") => curves += 1,
                Some("OE") => {
                    if curves > 0 {
                        return Err(err(
                            "Curved ODB++ profile needs arc decoding; refusing an incorrect board edge",
                        ));
                    }
                    if path.len() > 2 {
                        if path.first() != path.last() {
                            path.push(path[0]);
                        }
                        for pair in path.windows(2) {
                            out.outline_segments.push((pair[0], pair[1]));
                        }
                    }
                    path.clear();
                }
                _ => {}
            }
        }
    }
    let mut omitted = 0;
    let mut missing_width = 0;
    let mut copper_layers = Vec::new();
    // Matrix row order defines outer layers; use explicit TYPE, never a name guess.
    if let Ok(matrix) = data(files, &format!("{root}matrix/matrix")) {
        let mut kind = String::new();
        let mut name = String::new();
        for l in matrix.lines() {
            let l = l.trim();
            if l.ends_with('{') {
                kind.clear();
                name.clear();
            } else if l == "}" {
                if matches!(kind.as_str(), "SIGNAL" | "POWER_GROUND" | "MIXED") {
                    copper_layers.push(name.clone());
                }
            } else if let Some((k, v)) = l.split_once('=') {
                match k.trim() {
                    "NAME" => name = v.trim().into(),
                    "TYPE" => kind = v.trim().into(),
                    _ => {}
                }
            }
        }
    }
    for layer in &eda_layers {
        let filename = format!("{step}/layers/{layer}/features");
        let Some(bytes) = content(files, &filename)? else {
            continue;
        };
        let text = String::from_utf8_lossy(&bytes);
        let s = scale(&text, job_unit)?;
        let mut symbols = HashMap::new();
        let mut index = 0;
        let side = if copper_layers.first() == Some(layer) {
            Side::Top
        } else if copper_layers.last() == Some(layer) {
            Side::Bottom
        } else {
            Side::Both
        };
        for raw in text.lines() {
            let r = line(raw);
            let Some(kind) = r.first().copied() else {
                continue;
            };
            if let Some(id) = kind.strip_prefix('$') {
                if let Some(name) = r.get(1) {
                    symbols.insert(id.to_owned(), (*name).to_owned());
                }
                continue;
            }
            if !matches!(kind, "L" | "P" | "A" | "S" | "T" | "B") {
                continue;
            }
            let feature = index;
            index += 1;
            if kind != "L" {
                omitted += 1;
                continue;
            }
            if !copper_layers.contains(layer) {
                continue;
            }
            if r.get(6) != Some(&"P") {
                omitted += 1;
                continue;
            }
            let width = r
                .get(5)
                .and_then(|id| symbols.get(*id))
                .and_then(|name| name.strip_prefix('r').or_else(|| name.strip_prefix('s')))
                .and_then(|n| n.parse::<f64>().ok())
                .filter(|v| v.is_finite() && *v > 0.)
                .map(|v| v * s / 1000.);
            let Some(width) = width else {
                missing_width += 1;
                continue;
            };
            let net = feature_nets
                .get(&(layer.clone(), feature))
                .map(|i| net_name(&nets, *i))
                .transpose()?
                .unwrap_or_else(|| "UNCONNECTED".into());
            out.traces.push(RawTrace {
                from: Point::new(number(&r, 1)? * s, number(&r, 2)? * s),
                to: Point::new(number(&r, 3)? * s, number(&r, 4)? * s),
                width,
                side,
                layer: layer.clone(),
                net,
            });
        }
    }
    out.warn("ODB++: package/pin outlines are derived from pin spacing; copper pads, arcs, pours, drill spans and panel step-repeats are not decoded.");
    if omitted > 0 {
        out.warn(format!("{omitted} non-line/negative layer features are not drawn."));
    }
    if missing_width > 0 {
        out.warn(format!(
            "{missing_width} lines have custom symbols whose width cannot be decoded; not drawn."
        ));
    }
    Ok(out)
}
fn number_field(r: &[&str], i: usize) -> Result<f64, ParseError> {
    number(r, i)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Files {
        Files::from([
        ("job/misc/info".into(),b"UNITS=INCH".to_vec()),
        ("job/matrix/matrix".into(),b"LAYER {\nNAME=top\nTYPE=SIGNAL\n}\nLAYER {\nNAME=bottom\nTYPE=SIGNAL\n}".to_vec()),
        ("job/steps/board/eda/data".into(),b"LYR top bottom\nNET $NONE$\nNET GND\nSNT TRC\nFID C 0 0\nPKG IC 0 0 0 1 1\nPIN A1 S 0 0 0 U S".to_vec()),
        ("job/steps/board/layers/comp_+_top/components".into(),b"UNITS=MM\nCMP 0 10 20 90 N U1 CHIP\nTOP 0 10 20 90 N 1 0 A1".to_vec()),
        ("job/steps/board/layers/top/features".into(),b"$0 r10\nL 0 0 1 0 0 P 0".to_vec()),
    ])
    }
    #[test]
    fn units_are_per_file_and_toeprints_are_absolute() {
        let b = crate::project::parse_member(&fixture(), None).unwrap();
        assert!((b.pins[0].x - 10. * 1000. / 25.4).abs() < 1e-9);
        assert_eq!(b.pins[0].number, "A1");
        assert_eq!(b.nets[b.pins[0].net as usize].name, "GND");
        assert_eq!(b.traces[0].x2, 1000.);
        assert_eq!(b.traces[0].width, 10.);
        assert_eq!(b.nets[b.traces[0].net as usize].name, "GND");
    }
    #[test]
    fn invalid_net_is_never_assigned_by_guess() {
        let mut f = fixture();
        f.insert(
            "job/steps/board/layers/comp_+_top/components".into(),
            b"CMP 0 0 0 0 N U1 IC\nTOP 0 0 0 0 N 99 0 A1".to_vec(),
        );
        assert!(parse(&f, "job/steps/board").unwrap_err().to_string().contains("Net index 99"));
    }
}
