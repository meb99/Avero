//! The ASC family: ASUS `format.asc` / `pins.asc` / `nails.asc` file sets and
//! Honhan `.bdv`, which is the same content concatenated into one file and
//! obfuscated with a per-line subtraction key.
//!
//! Each section starts with a few header lines whose count differs between
//! tools, so instead of skipping a fixed number of lines every line is
//! checked against the shape of a data row.

use std::borrow::Cow;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::{contains, line_spans, lines, trim, Fields};
use crate::ParseError;

/// `<<format.asc>>` after BDV obfuscation.
const BDV_ENCODED_MARKER: &[u8] = b"dd:1.3?,r?-=bb";
const FORMAT_MARKER: &[u8] = b"<<format.asc>>";
const PINS_MARKER: &[u8] = b"<<pins.asc>>";
const NAILS_MARKER: &[u8] = b"<<nails.asc>>";

/// Coordinates are stored in inches.
const SCALE: f64 = 1000.0;

pub fn detect_bdv(buf: &[u8]) -> bool {
    contains(buf, BDV_ENCODED_MARKER) || (contains(buf, FORMAT_MARKER) && contains(buf, PINS_MARKER))
}

/// BDV obfuscation: each byte is `key - plain`, where the key starts at 160,
/// grows by one per CRLF line and wraps from 286 back to 159.
pub fn decode_bdv(buf: &[u8]) -> Vec<u8> {
    let mut key: i32 = 0xa0;
    let mut out = Vec::with_capacity(buf.len());
    for (i, &b) in buf.iter().enumerate() {
        if b == b'\r' && buf.get(i + 1) == Some(&b'\n') {
            key += 1;
        }
        out.push(if matches!(b, b'\r' | b'\n' | 0) { b } else { (key - i32::from(b)).rem_euclid(256) as u8 });
        if key > 285 {
            key = 159;
        }
    }
    out
}

/// Inverse of [`decode_bdv`], used by tests.
pub fn encode_bdv(plain: &[u8]) -> Vec<u8> {
    // The transform `key - x` is its own inverse for a fixed key.
    decode_bdv(plain)
}

/// The three ASC sections. Only `pins` is required.
#[derive(Default, Clone, Copy)]
pub struct AscSections<'a> {
    pub format: Option<&'a [u8]>,
    pub pins: Option<&'a [u8]>,
    pub nails: Option<&'a [u8]>,
}

pub fn parse_bdv(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let data: Cow<'_, [u8]> = if contains(buf, FORMAT_MARKER) || contains(buf, PINS_MARKER) {
        Cow::Borrowed(buf)
    } else {
        Cow::Owned(decode_bdv(buf))
    };
    let sections = split_sections(&data);
    if sections.pins.is_none() {
        return Err(ParseError::invalid(FormatId::Bdv, "no <<pins.asc>> section"));
    }
    parse_sections(FormatId::Bdv, sections)
}

/// Splits a BDV body at its `<<name.asc>>` markers.
fn split_sections(data: &[u8]) -> AscSections<'_> {
    fn assign<'a>(sections: &mut AscSections<'a>, marker: &[u8], body: &'a [u8]) {
        match marker {
            FORMAT_MARKER => sections.format = Some(body),
            PINS_MARKER => sections.pins = Some(body),
            NAILS_MARKER => sections.nails = Some(body),
            _ => {}
        }
    }
    let mut sections = AscSections::default();
    let mut current: Option<(&[u8], usize)> = None;
    for (start, end, next) in line_spans(data) {
        let t = trim(&data[start..end]);
        if t.starts_with(b"<<") && t.ends_with(b">>") {
            if let Some((marker, body_start)) = current.take() {
                assign(&mut sections, marker, &data[body_start..start]);
            }
            current = Some((t, next));
        }
    }
    if let Some((marker, body_start)) = current {
        assign(&mut sections, marker, &data[body_start..]);
    }
    sections
}

pub fn parse_sections(format: FormatId, sections: AscSections<'_>) -> Result<RawBoard, ParseError> {
    let mut board = RawBoard::new(format);
    let mut skipped = 0usize;

    if let Some(body) = sections.format {
        for line in lines(body) {
            let mut f = Fields::new(trim(line));
            if let (Some(x), Some(y)) = (f.float(), f.float()) {
                if f.is_empty() {
                    board.outline_path.push(Point::new(x * SCALE, y * SCALE));
                }
            }
        }
    }

    let pins = sections.pins.ok_or_else(|| ParseError::invalid(format, "pins.asc is missing"))?;
    for line in lines(pins) {
        let line = trim(line);
        if line.is_empty() {
            continue;
        }
        let mut f = Fields::new(line);
        if line.starts_with(b"Part") {
            f.raw();
            if let (Some(name), Some(loc)) = (f.string(), f.string()) {
                if loc.starts_with('(') {
                    let side = if loc == "(T)" { Side::Top } else { Side::Bottom };
                    board.parts.push(RawPart::new(name, side, Mount::Smd));
                    continue;
                }
            }
            continue; // a column header
        }
        let row = (f.int(), f.string(), f.float(), f.float(), f.int());
        let (Some(_id), Some(number), Some(x), Some(y), Some(_layer)) = row else {
            continue; // header or comment
        };
        let net = f.string().unwrap_or_default();
        let probe = f.int().and_then(|p| i32::try_from(p).ok());
        match board.parts.last_mut() {
            Some(part) => part.pins.push(RawPin {
                pos: Point::new(x * SCALE, y * SCALE),
                net,
                number: Some(number),
                probe,
                ..Default::default()
            }),
            None => skipped += 1,
        }
    }

    if let Some(body) = sections.nails {
        for line in lines(body) {
            let line = trim(line);
            if line.is_empty() {
                continue;
            }
            let mut f = Fields::new(line);
            f.skip_bytes(1); // row marker
            let row = (f.int(), f.float(), f.float(), f.int(), f.string(), f.string());
            let (Some(probe), Some(x), Some(y), Some(_kind), Some(_grid), Some(loc)) = row else {
                continue;
            };
            if !loc.starts_with('(') {
                continue;
            }
            let _net_id = f.string();
            board.test_points.push(RawTestPoint {
                kind: TestPointKind::Nail,
                pos: Point::new(x * SCALE, y * SCALE),
                side: if loc == "(T)" { Side::Top } else { Side::Bottom },
                net: f.string().unwrap_or_default(),
                probe: i32::try_from(probe).ok(),
                radius: None,
                name: None,
            });
        }
    }

    if board.parts.is_empty() {
        return Err(ParseError::invalid(format, "no parts found in pins section"));
    }
    if skipped > 0 {
        board.warn(format!("{skipped} pins appeared before any part and were skipped"));
    }
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoded_marker_decodes_to_format_header() {
        assert_eq!(decode_bdv(BDV_ENCODED_MARKER), FORMAT_MARKER);
    }

    #[test]
    fn key_advances_per_line() {
        let plain = b"<<format.asc>>\r\nabc\r\n";
        let encoded = encode_bdv(plain);
        assert_ne!(&encoded[16..19], b"abc");
        assert_eq!(decode_bdv(&encoded), plain);
    }

    #[test]
    fn splits_sections() {
        let data = b"<<format.asc>>\r\n0 0\r\n<<pins.asc>>\r\nPart U1 (T)\r\n<<nails.asc>>\r\n-1 0 0\r\n";
        let s = split_sections(data);
        assert_eq!(s.format, Some(&b"0 0\r\n"[..]));
        assert_eq!(s.pins, Some(&b"Part U1 (T)\r\n"[..]));
        assert_eq!(s.nails, Some(&b"-1 0 0\r\n"[..]));
    }
}
