//! Test_Link `.brd`, the most widespread boardview format.
//!
//! Plain text with the blocks `var_data:`, `Format:`, `Parts:`, `Pins:` and
//! `Nails:`. Many files are obfuscated with a simple byte rotation; those
//! start with the bytes `23 E2 63 28`, which decode to `str_`.

use std::borrow::Cow;
use std::collections::HashMap;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::{contains, lines, trim, Fields};
use crate::ParseError;

pub const ENCODED_SIGNATURE: [u8; 4] = [0x23, 0xe2, 0x63, 0x28];

pub fn detect(buf: &[u8]) -> bool {
    buf.starts_with(&ENCODED_SIGNATURE) || (contains(buf, b"str_length:") && contains(buf, b"var_data:"))
}

/// Reverses the obfuscation: rotate each byte left by two bits and invert it.
/// Line breaks and NUL bytes are left alone by the encoder.
pub fn decode(buf: &[u8]) -> Cow<'_, [u8]> {
    if !buf.starts_with(&ENCODED_SIGNATURE) {
        return Cow::Borrowed(buf);
    }
    Cow::Owned(
        buf.iter().map(|&b| if matches!(b, b'\r' | b'\n' | 0) { b } else { !b.rotate_left(2) }).collect(),
    )
}

/// Inverse of [`decode`], used by tests and the demo exporter.
pub fn encode(plain: &[u8]) -> Vec<u8> {
    plain.iter().map(|&b| if matches!(b, b'\r' | b'\n' | 0) { b } else { (!b).rotate_right(2) }).collect()
}

#[derive(Clone, Copy, PartialEq)]
enum Block {
    None,
    Header,
    VarData,
    Format,
    Parts,
    Pins,
    Nails,
}

struct BrdPin {
    pos: Point,
    probe: i64,
    part: usize,
    net: String,
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let data = decode(buf);
    let mut board = RawBoard::new(FormatId::Brd);
    let mut block = Block::None;
    let mut seen_block = false;
    let mut declared = [0i64; 4];
    let mut pins: Vec<BrdPin> = Vec::new();
    let mut nails: Vec<RawTestPoint> = Vec::new();
    let mut skipped = 0usize;

    for raw_line in lines(&data) {
        let line = trim(raw_line);
        if line.is_empty() {
            continue;
        }
        let next = match line {
            b"str_length:" => Some(Block::Header),
            b"var_data:" => Some(Block::VarData),
            b"Format:" | b"format:" => Some(Block::Format),
            b"Parts:" | b"Pins1:" => Some(Block::Parts),
            b"Pins:" | b"Pins2:" => Some(Block::Pins),
            b"Nails:" => Some(Block::Nails),
            _ => None,
        };
        if let Some(next) = next {
            block = next;
            seen_block = true;
            continue;
        }

        let mut f = Fields::new(line);
        let ok = match block {
            Block::None | Block::Header => true,
            Block::VarData => {
                for d in &mut declared {
                    *d = f.int().unwrap_or(0);
                }
                true
            }
            Block::Format => match (f.int(), f.int()) {
                (Some(x), Some(y)) => {
                    board.outline_path.push(Point::new(x as f64, y as f64));
                    true
                }
                _ => false,
            },
            Block::Parts => match (f.string(), f.int()) {
                (Some(name), Some(kind)) => {
                    // The second field packs mount type and side together.
                    let mount = if kind & 0xc != 0 { Mount::Smd } else { Mount::ThroughHole };
                    let side = match kind {
                        1 | 4..=7 => Side::Top,
                        2 | 8.. => Side::Bottom,
                        _ => Side::Both,
                    };
                    board.parts.push(RawPart::new(name, side, mount));
                    true
                }
                _ => false,
            },
            Block::Pins => match (f.int(), f.int(), f.int(), f.int()) {
                (Some(x), Some(y), Some(probe), Some(part)) => {
                    pins.push(BrdPin {
                        pos: Point::new(x as f64, y as f64),
                        probe,
                        part: usize::try_from(part).unwrap_or(0),
                        net: f.string().unwrap_or_default(),
                    });
                    true
                }
                _ => false,
            },
            Block::Nails => match (f.int(), f.int(), f.int(), f.int()) {
                (Some(probe), Some(x), Some(y), Some(side)) => {
                    nails.push(RawTestPoint {
                        kind: TestPointKind::Nail,
                        pos: Point::new(x as f64, y as f64),
                        side: if side == 1 { Side::Top } else { Side::Bottom },
                        net: f.string().unwrap_or_default(),
                        probe: i32::try_from(probe).ok(),
                        radius: None,
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

    if !seen_block {
        return Err(ParseError::invalid(FormatId::Brd, "no BRD blocks found"));
    }

    // Lenovo variant: pins carry no net name, only the probe number of a nail.
    let nail_nets: HashMap<i32, &str> =
        nails.iter().filter_map(|n| Some((n.probe?, n.net.as_str()))).collect();

    let part_count = board.parts.len();
    let mut orphans = 0usize;
    for pin in pins {
        let net = if pin.net.is_empty() {
            i32::try_from(pin.probe)
                .ok()
                .and_then(|p| nail_nets.get(&p))
                .map_or(String::new(), |n| (*n).to_string())
        } else {
            pin.net
        };
        if pin.part == 0 || pin.part > part_count {
            orphans += 1;
            board.test_points.push(RawTestPoint {
                kind: TestPointKind::Nail,
                pos: pin.pos,
                side: Side::Both,
                net,
                probe: i32::try_from(pin.probe).ok(),
                radius: None,
            });
            continue;
        }
        board.parts[pin.part - 1].pins.push(RawPin {
            pos: pin.pos,
            net,
            probe: i32::try_from(pin.probe).ok().filter(|p| *p >= 0),
            ..Default::default()
        });
    }
    board.test_points.extend(nails);

    if skipped > 0 {
        board.warn(format!("{skipped} unreadable lines were skipped"));
    }
    if orphans > 0 {
        board.warn(format!("{orphans} pins without a valid part were shown as test points"));
    }
    let [_, parts, pins, _] = declared;
    if parts > 0 && parts as usize != part_count {
        board.warn(format!("header declares {parts} parts, file contains {part_count}"));
    }
    if pins > 0 && pins as usize != board.pin_count() + orphans {
        board.warn(format!("header declares {pins} pins, file contains {}", board.pin_count() + orphans));
    }
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoding_reverses_encoding() {
        let plain = b"str_length:\r\n0 0\r\nvar_data:\n";
        let encoded = encode(plain);
        assert!(encoded.starts_with(&ENCODED_SIGNATURE));
        assert_eq!(decode(&encoded).as_ref(), plain);
    }
}
