//! "Panel" CAD exports (`###Panel Added`, `COMP` / `C_PIN` / `NET` / `N_VIA`
//! records). Not to be confused with GenCAD, which also uses `.cad`.

use std::collections::HashMap;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::{contains, lines, trim, Fields};
use crate::ParseError;

const SCALE: f64 = 1000.0;

pub fn detect(buf: &[u8]) -> bool {
    contains(buf, b"###Panel Added") && contains(buf, b"C_PIN")
}

fn clean_net(net: String) -> String {
    match net.strip_prefix('/') {
        Some(rest) => rest.to_string(),
        None => net,
    }
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let mut board = RawBoard::new(FormatId::Cad);
    let mut by_name: HashMap<String, usize> = HashMap::new();
    let mut via_net = String::new();
    let mut orphans = 0usize;

    for raw_line in lines(buf) {
        let line = trim(raw_line);
        let mut f = Fields::new(line);
        let Some(tag) = f.raw() else { continue };

        if tag.starts_with(b"C_PIN") {
            let (Some(part_ref), Some(x), Some(y)) = (f.string(), f.float(), f.float()) else {
                continue;
            };
            for _ in 0..3 {
                f.float();
            }
            let _unknown = f.string();
            let net = clean_net(f.string().unwrap_or_default());
            // Pin references look like `U12-3`: part name, dash, pin number.
            let (part_name, number) = match part_ref.split_once('-') {
                Some((p, n)) => (p.to_string(), Some(n.to_string())),
                None => (part_ref, None),
            };
            match by_name.get(&part_name) {
                Some(&i) => board.parts[i].pins.push(RawPin {
                    pos: Point::new(x * SCALE, y * SCALE),
                    net,
                    number,
                    ..Default::default()
                }),
                None => orphans += 1,
            }
        } else if tag.starts_with(b"COMP") {
            let Some(name) = f.string() else { continue };
            for _ in 0..5 {
                f.raw();
            }
            let side = if f.string().as_deref() == Some("1") { Side::Top } else { Side::Bottom };
            by_name.insert(name.clone(), board.parts.len());
            board.parts.push(RawPart::new(name, side, Mount::Smd));
        } else if tag.starts_with(b"NET") {
            via_net = clean_net(f.string().unwrap_or_default());
        } else if tag.starts_with(b"N_VIA") {
            let (Some(x), Some(y)) = (f.float(), f.float()) else {
                continue;
            };
            let _ = f.raw();
            let top = f.float() == Some(1.0);
            board.test_points.push(RawTestPoint {
                kind: TestPointKind::Via,
                pos: Point::new(x * SCALE, y * SCALE),
                side: if top { Side::Top } else { Side::Bottom },
                net: via_net.clone(),
                probe: None,
                radius: None,
                name: None,
            });
        }
    }

    if board.parts.is_empty() {
        return Err(ParseError::invalid(FormatId::Cad, "no COMP records found"));
    }
    if orphans > 0 {
        board.warn(format!("{orphans} pins reference unknown parts and were skipped"));
    }
    Ok(board)
}
