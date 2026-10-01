//! XinZhiZao `.pcb` boardviews.
//!
//! Layout, following the reverse engineering done for OpenBoardView:
//!
//! - The file starts with `XZZPCB`. If byte `0x10` is non-zero, everything
//!   before the `v6v6555v6v6` marker is XOR-ed with that byte.
//! - Little-endian `u32` offsets at `0x20` (main data) and `0x28` (nets),
//!   both relative to `0x20`.
//! - The net section is a list of `size, index, name` records.
//! - The main section is a list of `type: u8, size: u32, body` blocks:
//!   arcs (1) and lines (5) on layer 28 form the board outline, parts (7)
//!   are DES-encrypted, test pads (9) are plain.
//! - Coordinates are `u32` in 1/10000 mil.
//!
//! This direct reader uses the DES key users enter in the settings. The separate
//! library converter has its own compatibility default.
//! Without it, everything but the parts is still readable: outline, nets
//! and named test pads.

use des::cipher::{Block, BlockCipherDecrypt, KeyInit};
use des::Des;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::{decode, find};
use crate::ParseError;

const MAGIC: &[u8] = b"XZZPCB";
const XOR_END_MARKER: &[u8] = b"v6v6555v6v6";
const SCALE: f64 = 10_000.0;
const OUTLINE_LAYER: u32 = 28;

pub fn detect(buf: &[u8]) -> bool {
    if buf.starts_with(MAGIC) {
        return true;
    }
    match (buf.get(..MAGIC.len()), buf.get(0x10)) {
        (Some(head), Some(&key)) if key != 0 => head.iter().map(|b| b ^ key).eq(MAGIC.iter().copied()),
        _ => false,
    }
}

/// The byte-parity pattern every genuine XZZ key has (least significant
/// byte first). Catches typos before a wrong key produces garbage.
pub fn key_is_plausible(key: u64) -> bool {
    const PARITY: [u32; 8] = [1, 1, 1, 1, 1, 1, 1, 0];
    (0..8).all(|i| {
        let byte = (key >> (i * 8)) as u8;
        u32::from(byte.count_ones().is_multiple_of(2)) == PARITY[i]
    })
}

/// Parses `0x1234…`, `1234…` or with spaces/colons between byte pairs.
pub fn parse_key(text: &str) -> Option<u64> {
    let hex: String = text
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .chars()
        .filter(|c| !matches!(c, ' ' | ':' | '_'))
        .collect();
    if hex.is_empty() || hex.len() > 16 {
        return None;
    }
    u64::from_str_radix(&hex, 16).ok()
}

/// DES-ECB over 8-byte blocks with the key in big-endian byte order. A
/// trailing partial block is passed through unchanged.
fn des_blocks(data: &[u8], key: u64, apply: impl Fn(&Des, &mut Block<Des>)) -> Vec<u8> {
    let cipher = Des::new(&key.to_be_bytes().into());
    let (blocks, rest) = data.as_chunks::<8>();
    let mut out = Vec::with_capacity(data.len());
    for b in blocks {
        let mut block: Block<Des> = (*b).into();
        apply(&cipher, &mut block);
        out.extend_from_slice(block.as_slice());
    }
    out.extend_from_slice(rest);
    out
}

pub(crate) fn des_decrypt(data: &[u8], key: u64) -> Vec<u8> {
    des_blocks(data, key, |c, b| c.decrypt_block(b))
}

/// Encryption counterpart, for building test files.
pub fn des_encrypt(data: &[u8], key: u64) -> Vec<u8> {
    use des::cipher::BlockCipherEncrypt;
    des_blocks(data, key, |c, b| c.encrypt_block(b))
}

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(buf: &'a [u8], pos: usize) -> Self {
        Self { buf, pos }
    }

    fn err(&self, what: &str) -> ParseError {
        ParseError::invalid(
            FormatId::Xzz,
            format!("unexpected end of data reading {what} at byte {}", self.pos),
        )
    }

    fn u8(&mut self, what: &str) -> Result<u8, ParseError> {
        let b = *self.buf.get(self.pos).ok_or_else(|| self.err(what))?;
        self.pos += 1;
        Ok(b)
    }

    fn u32(&mut self, what: &str) -> Result<u32, ParseError> {
        let b = self.buf.get(self.pos..self.pos + 4).ok_or_else(|| self.err(what))?;
        self.pos += 4;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn bytes(&mut self, n: usize, what: &str) -> Result<&'a [u8], ParseError> {
        let end = self.pos.checked_add(n).ok_or_else(|| self.err(what))?;
        let b = self.buf.get(self.pos..end).ok_or_else(|| self.err(what))?;
        self.pos = end;
        Ok(b)
    }

    fn skip(&mut self, n: usize) {
        self.pos = self.pos.saturating_add(n);
    }
}

fn u32_at(buf: &[u8], pos: usize, what: &str) -> Result<u32, ParseError> {
    Cursor::new(buf, pos).u32(what)
}

fn point(x: u32, y: u32) -> Point {
    Point::new(f64::from(x) / SCALE, f64::from(y) / SCALE)
}

pub fn parse(input: &[u8], key: Option<u64>) -> Result<RawBoard, ParseError> {
    if key.is_some_and(|k| !key_is_plausible(k)) {
        return Err(ParseError::InvalidKey);
    }

    let mut buf = input.to_vec();
    if let Some(&xor) = buf.get(0x10) {
        if xor != 0 {
            let end = find(&buf, XOR_END_MARKER).unwrap_or(buf.len());
            for b in &mut buf[..end] {
                *b ^= xor;
            }
        }
    }

    let main_start = u32_at(&buf, 0x20, "main data offset")? as usize + 0x20;
    let net_start = u32_at(&buf, 0x28, "net data offset")? as usize + 0x20;
    let main_size = u32_at(&buf, main_start, "main data size")? as usize;
    let net_size = u32_at(&buf, net_start, "net data size")? as usize;

    let nets = parse_nets(Cursor::new(&buf, net_start + 4).bytes(net_size, "net data")?)?;
    let net_name = |index: u32| -> String {
        match nets.get(&index).map(String::as_str) {
            None | Some("NC") => String::new(),
            Some(n) => n.to_string(),
        }
    };

    let mut board = RawBoard::new(FormatId::Xzz);
    let mut outline: Vec<(Point, Point)> = Vec::new();
    let mut c = Cursor::new(&buf, main_start + 4);
    let end = main_start + 4 + main_size;
    if end > buf.len() {
        return Err(c.err("main data"));
    }
    let mut unknown_blocks = 0usize;
    let mut failed_parts = 0usize;

    while c.pos < end {
        let kind = c.u8("block type")?;
        let size = c.u32("block size")? as usize;
        let body = c.bytes(size, "block")?;
        match kind {
            0x01 => {
                let mut b = Cursor::new(body, 0);
                let [layer, x, y, r, start, stop] = [(); 6].map(|_| b.u32("arc"));
                if layer? == OUTLINE_LAYER {
                    outline.extend(arc(
                        point(x?, y?),
                        f64::from(r?) / SCALE,
                        f64::from(start?) / SCALE,
                        f64::from(stop?) / SCALE,
                    ));
                }
            }
            0x05 => {
                let mut b = Cursor::new(body, 0);
                let [layer, x1, y1, x2, y2] = [(); 5].map(|_| b.u32("line"));
                if layer? == OUTLINE_LAYER {
                    outline.push((point(x1?, y1?), point(x2?, y2?)));
                }
            }
            0x07 => match key {
                Some(key) => match parse_part(&des_decrypt(body, key), &net_name) {
                    Ok(part) => board.parts.push(part),
                    Err(_) => failed_parts += 1,
                },
                None => board.locked_parts += 1,
            },
            0x09 => board.test_points.push(parse_test_pad(body, &net_name)?),
            // Vias and text are not needed for a boardview.
            0x02 | 0x06 => {}
            _ => unknown_blocks += 1,
        }
    }

    // Without a key, only a board with test pads is worth showing.
    if key.is_none() && board.test_points.is_empty() {
        return Err(ParseError::XzzAllLocked(board.locked_parts));
    }
    if board.parts.is_empty() && failed_parts > 0 {
        return Err(ParseError::invalid(
            FormatId::Xzz,
            "the part data could not be decrypted. Is the XZZ key correct?",
        ));
    }
    if failed_parts > 0 {
        board.warn(format!("{failed_parts} parts could not be read"));
    }
    if unknown_blocks > 0 {
        board.warn(format!("{unknown_blocks} blocks of unknown type were skipped"));
    }

    // Move the board to the origin, as XZZ coordinates are offset.
    if let Some(origin) = outline
        .iter()
        .flat_map(|(a, b)| [a, b])
        .copied()
        .reduce(|m, p| Point::new(m.x.min(p.x), m.y.min(p.y)))
    {
        let shift = |p: Point| Point::new(p.x - origin.x, p.y - origin.y);
        outline = outline.into_iter().map(|(a, b)| (shift(a), shift(b))).collect();
        for part in &mut board.parts {
            for pin in &mut part.pins {
                pin.pos = shift(pin.pos);
            }
        }
        for tp in &mut board.test_points {
            tp.pos = shift(tp.pos);
        }
    }
    board.outline_segments = outline;
    Ok(board)
}

fn parse_nets(data: &[u8]) -> Result<std::collections::HashMap<u32, String>, ParseError> {
    let mut nets = std::collections::HashMap::new();
    let mut c = Cursor::new(data, 0);
    while c.pos < data.len() {
        let size = c.u32("net record")? as usize;
        let index = c.u32("net index")?;
        let name = c.bytes(size.saturating_sub(8), "net name")?;
        nets.insert(index, decode(name).into_owned());
    }
    Ok(nets)
}

fn parse_part(data: &[u8], net_name: &dyn Fn(u32) -> String) -> Result<RawPart, ParseError> {
    let mut c = Cursor::new(data, 0);
    let part_size = c.u32("part size")? as usize;
    c.skip(18);
    let group_len = c.u32("part group")? as usize;
    c.skip(group_len);
    // The label sub-block with the part name always comes first.
    if c.u8("part label")? != 0x06 {
        return Err(c.err("part label"));
    }
    c.skip(30);
    let name_len = c.u32("part name")? as usize;
    let name = decode(c.bytes(name_len, "part name")?).into_owned();

    let mut part = RawPart::new(name, Side::Top, Mount::Smd);
    let end = part_size + 4;
    while c.pos < end.min(data.len()) {
        match c.u8("sub block")? {
            0x01 | 0x05 | 0x06 => {
                let skip = c.u32("sub block size")? as usize;
                c.skip(skip);
            }
            0x09 => {
                let block_end = c.pos + c.u32("pin size")? as usize + 4;
                c.skip(4);
                let (x, y) = (c.u32("pin x")?, c.u32("pin y")?);
                c.skip(8);
                let name_len = c.u32("pin name")? as usize;
                let number = decode(c.bytes(name_len, "pin name")?).into_owned();
                c.skip(32);
                let net = c.u32("pin net")?;
                c.pos = block_end;
                part.pins.push(RawPin {
                    pos: point(x, y),
                    side: Some(Side::Top),
                    net: net_name(net),
                    number: Some(number),
                    ..Default::default()
                });
            }
            _ => {}
        }
    }
    Ok(part)
}

fn parse_test_pad(data: &[u8], net_name: &dyn Fn(u32) -> String) -> Result<RawTestPoint, ParseError> {
    let mut c = Cursor::new(data, 0);
    let _number = c.u32("test pad")?;
    let (x, y) = (c.u32("test pad x")?, c.u32("test pad y")?);
    c.skip(8);
    let name_len = c.u32("test pad name")? as usize;
    let name = decode(c.bytes(name_len, "test pad name")?).into_owned();
    let net = u32_at(data, data.len().saturating_sub(4), "test pad net")?;
    Ok(RawTestPoint {
        kind: TestPointKind::Nail,
        pos: point(x, y),
        side: Side::Top,
        net: net_name(net),
        probe: None,
        radius: None,
        name: Some(name).filter(|n| !n.is_empty()),
    })
}

/// Arc as ten segments between two angles in degrees, like OpenBoardView.
fn arc(center: Point, r: f64, start: f64, stop: f64) -> Vec<(Point, Point)> {
    let (mut a0, a1) = if start > stop { (stop, start) } else { (start, stop) };
    if a1 - a0 > 180.0 {
        a0 += 360.0;
    }
    let at = |deg: f64| {
        let rad = deg.to_radians();
        Point::new(center.x + r * rad.cos(), center.y + r * rad.sin())
    };
    let steps = 9;
    (0..steps)
        .map(|i| {
            let f = |k: usize| a0 + (a1 - a0) * k as f64 / steps as f64;
            (at(f(i)), at(f(i + 1)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn des_matches_the_standard_test_vector() {
        // FIPS 46 example: key 133457799BBCDFF1, plaintext 0123456789ABCDEF.
        let key = 0x1334_5779_9BBC_DFF1;
        let cipher = des_encrypt(&0x0123_4567_89AB_CDEFu64.to_be_bytes(), key);
        assert_eq!(cipher, 0x85E8_1354_0F0A_B405u64.to_be_bytes());
        assert_eq!(des_decrypt(&cipher, key), 0x0123_4567_89AB_CDEFu64.to_be_bytes());
    }

    #[test]
    fn checks_key_parity() {
        assert!(key_is_plausible(0x8003_0303_0303_0303));
        assert!(!key_is_plausible(0));
        assert!(!key_is_plausible(0x8003_0303_0303_0302));
    }

    #[test]
    fn reads_key_notations() {
        assert_eq!(parse_key("0x8003030303030303"), Some(0x8003_0303_0303_0303));
        assert_eq!(parse_key("80 03 03 03 03 03 03 03"), Some(0x8003_0303_0303_0303));
        assert_eq!(parse_key("xyz"), None);
        assert_eq!(parse_key("0x1234567890abcdef1"), None);
    }
}
