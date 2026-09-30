//! BRD2, the `BRDOUT:` / `NETS:` / `PARTS:` / `PINS:` / `NAILS:` variant.
//!
//! Nets are numbered, parts store their bounding box and the index of their
//! first pin, and everything on the bottom side is stored with Y mirrored.

use std::collections::HashMap;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::{contains, lines, trim, Fields};
use crate::ParseError;

pub fn detect(buf: &[u8]) -> bool {
    contains(buf, b"BRDOUT:") && contains(buf, b"NETS:")
}

#[derive(Clone, Copy, PartialEq)]
enum Block {
    None,
    Format,
    Nets,
    Parts,
    Pins,
    Nails,
}

struct Brd2Part {
    name: String,
    p1: Point,
    p2: Point,
    first_pin: usize,
    side: Side,
}

struct Brd2Pin {
    pos: Point,
    net: u32,
    side: Side,
}

fn side_code(code: i64) -> Side {
    match code {
        1 => Side::Top,
        2 => Side::Bottom,
        _ => Side::Both,
    }
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let mut board = RawBoard::new(FormatId::Brd2);
    let mut block = Block::None;
    let mut max_y = 0.0f64;
    let mut nets: HashMap<u32, String> = HashMap::new();
    let mut parts: Vec<Brd2Part> = Vec::new();
    let mut pins: Vec<Brd2Pin> = Vec::new();
    let mut skipped = 0usize;

    for raw_line in lines(buf) {
        let line = trim(raw_line);
        if line.is_empty() {
            continue;
        }
        let headers: [(&[u8], Block); 5] = [
            (b"BRDOUT:", Block::Format),
            (b"NETS:", Block::Nets),
            (b"PARTS:", Block::Parts),
            (b"PINS:", Block::Pins),
            (b"NAILS:", Block::Nails),
        ];
        if let Some((tag, next)) = headers.iter().find(|(tag, _)| line.starts_with(tag)) {
            block = *next;
            if block == Block::Format {
                let mut f = Fields::new(&line[tag.len()..]);
                let _count = f.int();
                let _max_x = f.int();
                max_y = f.int().unwrap_or(0) as f64;
            }
            continue;
        }

        let mut f = Fields::new(line);
        let ok = match block {
            Block::None => true,
            Block::Format => match (f.int(), f.int()) {
                (Some(x), Some(y)) => {
                    board.outline_path.push(Point::new(x as f64, y as f64));
                    true
                }
                _ => false,
            },
            Block::Nets => match (f.int(), f.string()) {
                (Some(id), Some(name)) => {
                    nets.insert(id as u32, name);
                    true
                }
                _ => false,
            },
            Block::Parts => {
                let name = f.string();
                let coords = (f.int(), f.int(), f.int(), f.int());
                match (name, coords, f.int(), f.int()) {
                    (Some(name), (Some(x1), Some(y1), Some(x2), Some(y2)), Some(first), side) => {
                        parts.push(Brd2Part {
                            name,
                            p1: Point::new(x1 as f64, y1 as f64),
                            p2: Point::new(x2 as f64, y2 as f64),
                            first_pin: usize::try_from(first).unwrap_or(0),
                            side: side_code(side.unwrap_or(0)),
                        });
                        true
                    }
                    _ => false,
                }
            }
            Block::Pins => match (f.int(), f.int(), f.int(), f.int()) {
                (Some(x), Some(y), Some(net), Some(side)) => {
                    pins.push(Brd2Pin {
                        pos: Point::new(x as f64, y as f64),
                        net: net as u32,
                        side: side_code(side),
                    });
                    true
                }
                _ => false,
            },
            Block::Nails => match (f.int(), f.int(), f.int(), f.int(), f.int()) {
                (Some(probe), Some(x), Some(y), Some(net), Some(side)) => {
                    let top = side == 1;
                    let y = if top { y as f64 } else { max_y - y as f64 };
                    board.test_points.push(RawTestPoint {
                        kind: TestPointKind::Nail,
                        pos: Point::new(x as f64, y),
                        side: if top { Side::Top } else { Side::Bottom },
                        net: nets.get(&(net as u32)).cloned().unwrap_or_default(),
                        probe: i32::try_from(probe).ok(),
                        radius: None,
                        name: None,
                    });
                    true
                }
                _ => false,
            },
        };
        if !ok {
            skipped += 1;
        }
    }

    if parts.is_empty() && pins.is_empty() {
        return Err(ParseError::invalid(FormatId::Brd2, "no parts or pins found"));
    }

    // A part owns the pins from its first pin up to the next part's first pin.
    for i in 0..parts.len() {
        let start = parts[i].first_pin.min(pins.len());
        let end = parts.get(i + 1).map_or(pins.len(), |p| p.first_pin).clamp(start, pins.len());
        let part = &parts[i];

        let mut through_hole = true;
        let mut raw_pins = Vec::with_capacity(end - start);
        for pin in &pins[start..end] {
            if pin.side == part.side && pin.side != Side::Both {
                through_hole = false;
            }
            let y = if pin.side == Side::Top { pin.pos.y } else { max_y - pin.pos.y };
            raw_pins.push(RawPin {
                pos: Point::new(pin.pos.x, y),
                side: Some(pin.side),
                net: nets.get(&pin.net).cloned().unwrap_or_default(),
                ..Default::default()
            });
        }

        let (side, mount) = if through_hole && !raw_pins.is_empty() {
            (Side::Both, Mount::ThroughHole)
        } else {
            (part.side, Mount::Smd)
        };
        let flip = |p: Point| {
            if part.side == Side::Bottom {
                Point::new(p.x, max_y - p.y)
            } else {
                p
            }
        };
        let (a, b) = (flip(part.p1), flip(part.p2));
        let outline = (a.x != b.x && a.y != b.y).then(|| {
            vec![Point::new(a.x, a.y), Point::new(b.x, a.y), Point::new(b.x, b.y), Point::new(a.x, b.y)]
        });

        let mut raw = RawPart::new(part.name.clone(), side, mount);
        raw.pins = raw_pins;
        raw.outline = outline;
        board.parts.push(raw);
    }

    if skipped > 0 {
        board.warn(format!("{skipped} unreadable lines were skipped"));
    }
    Ok(board)
}
