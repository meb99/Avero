//! BoardViewer raw formats: `BVRAW_FORMAT_1` (tabular, inches) and
//! `BVRAW_FORMAT_3` (one `KEY value` per line, mils).

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::{contains, lines, trim, Fields};
use crate::ParseError;

pub fn detect_v1(buf: &[u8]) -> bool {
    contains(buf, b"BVRAW_FORMAT_1")
}

pub fn detect_v3(buf: &[u8]) -> bool {
    contains(buf, b"BVRAW_FORMAT_3")
}

fn side_letter(s: &str) -> Side {
    match s {
        "T" | "(T)" => Side::Top,
        "B" | "(B)" => Side::Bottom,
        _ => Side::Both,
    }
}

#[derive(Clone, Copy, PartialEq)]
enum V1Block {
    None,
    Layout,
    Pins,
    Nails,
}

pub fn parse_v1(buf: &[u8]) -> Result<RawBoard, ParseError> {
    const SCALE: f64 = 1000.0; // inches
    let mut board = RawBoard::new(FormatId::Bvr);
    let mut block = V1Block::None;
    let mut skip_header = false;

    for raw_line in lines(buf) {
        let line = trim(raw_line);
        if line.is_empty() {
            continue;
        }
        let next = match line {
            b"<<Layout>>" => Some(V1Block::Layout),
            b"<<Pin>>" => Some(V1Block::Pins),
            b"<<Nail>>" => Some(V1Block::Nails),
            _ => None,
        };
        if let Some(next) = next {
            block = next;
            skip_header = true; // one column header line follows each marker
            continue;
        }
        if std::mem::take(&mut skip_header) {
            continue;
        }

        match block {
            V1Block::None => {}
            V1Block::Layout => {
                let mut f = Fields::new(line);
                if let Some(x) = f.float() {
                    f.eat(b',');
                    if let Some(y) = f.float() {
                        board.outline_path.push(Point::new(x * SCALE, y * SCALE));
                    }
                }
            }
            V1Block::Pins => {
                let mut f = Fields::new(line);
                let row = (f.string(), f.string(), f.int(), f.string(), f.float(), f.float(), f.int());
                let (Some(part_name), Some(loc), Some(_id), Some(number), Some(x), Some(y), Some(_layer)) =
                    row
                else {
                    continue;
                };
                let net = f.string().unwrap_or_default();
                let side = if loc == "(T)" { Side::Top } else { Side::Bottom };
                if board.parts.last().is_none_or(|p| p.name != part_name) {
                    board.parts.push(RawPart::new(part_name, side, Mount::Smd));
                }
                if let Some(part) = board.parts.last_mut() {
                    part.pins.push(RawPin {
                        pos: Point::new(x * SCALE, y * SCALE),
                        net,
                        number: Some(number),
                        ..Default::default()
                    });
                }
            }
            V1Block::Nails => {
                // The first, tab-separated field is the nail name.
                let rest =
                    line.iter().position(|&b| b == b'\t').map_or(&line[line.len()..], |i| &line[i + 1..]);
                let mut f = Fields::new(rest);
                let row = (f.float(), f.float(), f.int(), f.string(), f.string());
                let (Some(x), Some(y), Some(_kind), Some(_grid), Some(loc)) = row else {
                    continue;
                };
                let _net_id = f.string();
                board.test_points.push(RawTestPoint {
                    kind: TestPointKind::Nail,
                    pos: Point::new(x * SCALE, y * SCALE),
                    side: if loc == "(T)" { Side::Top } else { Side::Bottom },
                    net: f.string().unwrap_or_default(),
                    probe: None,
                    radius: None,
                    name: None,
                });
            }
        }
    }

    if board.parts.is_empty() && board.outline_path.is_empty() {
        return Err(ParseError::invalid(FormatId::Bvr, "no parts or outline found"));
    }
    Ok(board)
}

/// BVR3 writers disagree on `PIN_ORIGIN`: some store it relative to the
/// part origin (as OpenBoardView reads it), others absolute. Whichever
/// reading keeps pins closer to their part origin is the right one.
fn pins_are_absolute(parts: &[(RawPart, Point)]) -> bool {
    let (mut absolute, mut relative) = (Vec::new(), Vec::new());
    for (part, origin) in parts {
        for pin in &part.pins {
            absolute.push(((pin.pos.x - origin.x).powi(2) + (pin.pos.y - origin.y).powi(2)).sqrt());
            relative.push((pin.pos.x.powi(2) + pin.pos.y.powi(2)).sqrt());
        }
    }
    let median = |v: &mut Vec<f64>| {
        v.sort_by(f64::total_cmp);
        v.get(v.len() / 2).copied().unwrap_or(0.0)
    };
    !absolute.is_empty() && median(&mut absolute) < median(&mut relative)
}

pub fn parse_v3(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let mut board = RawBoard::new(FormatId::Bvr3);
    let mut done: Vec<(RawPart, Point)> = Vec::new();
    let mut part: Option<(RawPart, Point)> = None;
    let mut pin = RawPin::default();
    let mut pin_side: Option<Side> = None;

    for raw_line in lines(buf) {
        let line = trim(raw_line);
        if line.is_empty() {
            continue;
        }
        let split = line.iter().position(u8::is_ascii_whitespace).unwrap_or(line.len());
        let (key, value) = line.split_at(split);
        let mut f = Fields::new(value);

        match key {
            b"PART_NAME" => {
                let name = f.string().unwrap_or_default();
                part = Some((RawPart::new(name, Side::Top, Mount::Smd), Point::default()));
            }
            b"PART_SIDE" => {
                if let (Some((p, _)), Some(s)) = (part.as_mut(), f.string()) {
                    p.side = side_letter(&s);
                }
            }
            b"PART_ORIGIN" => {
                if let (Some((_, origin)), Some(x), Some(y)) = (part.as_mut(), f.float(), f.float()) {
                    *origin = Point::new(x, y);
                }
            }
            b"PART_MOUNT" => {
                if let (Some((p, _)), Some(m)) = (part.as_mut(), f.string()) {
                    p.mount = if m == "SMD" { Mount::Smd } else { Mount::ThroughHole };
                }
            }
            b"PART_OUTLINE_RELATIVE" => {
                if let Some((p, origin)) = part.as_mut() {
                    let pts = read_points(&mut f);
                    if pts.len() >= 3 {
                        p.outline = Some(
                            pts.into_iter().map(|q| Point::new(q.x + origin.x, q.y + origin.y)).collect(),
                        );
                    }
                }
            }
            b"PIN_NUMBER" => pin.number = f.string(),
            b"PIN_NAME" => pin.name = f.string(),
            b"PIN_SIDE" => pin_side = f.string().map(|s| side_letter(&s)),
            b"PIN_ORIGIN" => {
                // As written; resolved against the part origin at the end.
                if let (Some(x), Some(y)) = (f.float(), f.float()) {
                    pin.pos = Point::new(x, y);
                }
            }
            b"PIN_RADIUS" => pin.radius = f.float(),
            b"PIN_NET" => pin.net = f.string().unwrap_or_default(),
            b"PIN_END" => {
                pin.side = pin_side.take();
                let finished = std::mem::take(&mut pin);
                match part.as_mut() {
                    Some((p, _)) => p.pins.push(finished),
                    None => board.warn("pin outside of a part was skipped"),
                }
            }
            b"PART_END" => {
                if let Some(finished) = part.take() {
                    done.push(finished);
                }
            }
            b"OUTLINE_POINTS" => board.outline_path.extend(read_points(&mut f)),
            b"OUTLINE_SEGMENTED" => {
                let pts = read_points(&mut f);
                board.outline_segments.extend(pts.as_chunks::<2>().0.iter().map(|[a, b]| (*a, *b)));
            }
            _ => {}
        }
    }

    let absolute = pins_are_absolute(&done);
    for (mut p, origin) in done {
        if !absolute {
            for pin in &mut p.pins {
                pin.pos = Point::new(pin.pos.x + origin.x, pin.pos.y + origin.y);
            }
        }
        board.parts.push(p);
    }

    if board.parts.is_empty() && board.outline_path.is_empty() && board.outline_segments.is_empty() {
        return Err(ParseError::invalid(FormatId::Bvr3, "no parts or outline found"));
    }
    Ok(board)
}

fn read_points(f: &mut Fields<'_>) -> Vec<Point> {
    let mut out = Vec::new();
    while let (Some(x), Some(y)) = (f.float(), f.float()) {
        out.push(Point::new(x, y));
    }
    out
}
