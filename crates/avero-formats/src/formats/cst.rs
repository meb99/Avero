//! IBM/Lenovo `.cst`, a binary format. Only the part list, the net list and
//! the `CPad` pin table are understood; the board outline is not.
//!
//! The layout follows the reverse engineering done for OpenBoardView.

use crate::builder::{RawBoard, RawPart, RawPin};
use crate::model::{FormatId, Mount, Point, Side};
use crate::text::{decode, find};
use crate::ParseError;

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn err(&self, what: &str) -> ParseError {
        ParseError::invalid(
            FormatId::Cst,
            format!("unexpected end of file while reading {what} at byte {}", self.pos),
        )
    }

    fn i16(&mut self, what: &str) -> Result<i16, ParseError> {
        let bytes = self.buf.get(self.pos..self.pos + 2).ok_or_else(|| self.err(what))?;
        self.pos += 2;
        Ok(i16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn u8(&mut self, what: &str) -> Result<u8, ParseError> {
        let b = *self.buf.get(self.pos).ok_or_else(|| self.err(what))?;
        self.pos += 1;
        Ok(b)
    }

    fn bytes(&mut self, n: usize, what: &str) -> Result<&'a [u8], ParseError> {
        let s = self.buf.get(self.pos..self.pos + n).ok_or_else(|| self.err(what))?;
        self.pos += n;
        Ok(s)
    }

    fn skip(&mut self, n: usize, what: &str) -> Result<(), ParseError> {
        self.bytes(n, what).map(|_| ())
    }

    fn back(&mut self, n: usize, what: &str) -> Result<(), ParseError> {
        self.pos = self.pos.checked_sub(n).ok_or_else(|| self.err(what))?;
        Ok(())
    }
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let mut r = Reader { buf, pos: 0 };
    let mut board = RawBoard::new(FormatId::Cst);

    let part_count = r.i16("part count")?.max(0) as usize;
    r.skip(4, "section signature")?;
    let name_len = r.i16("section name")?.max(0) as usize;
    r.skip(name_len, "section name")?;

    for _ in 0..part_count {
        let len = r.u8("part name length")? as usize;
        let name = decode(r.bytes(len, "part name")?).into_owned();
        r.skip(4, "part record")?;
        let side = match r.u8("part layer")? {
            0x0c => Side::Top,
            0x01 => Side::Bottom,
            _ => Side::Both,
        };
        r.skip(6, "part record")?;
        board.parts.push(RawPart::new(name, side, Mount::Smd));
    }

    // The net count overlaps the last two bytes of the final part record.
    r.back(2, "net count")?;
    let net_count = r.i16("net count")?.max(0) as usize;
    let mut nets = Vec::with_capacity(net_count);
    for _ in 0..net_count {
        let len = r.u8("net name length")? as usize;
        nets.push(decode(r.bytes(len, "net name")?).into_owned());
    }

    let cpad = find(&buf[r.pos..], b"CPad").ok_or_else(|| r.err("CPad section"))? + r.pos;
    r.pos = cpad;
    r.back(8, "CPad header")?;
    let pin_count = r.i16("pin count")?.max(0) as usize;
    r.skip(10, "CPad header")?;

    let mut orphans = Vec::new();
    for _ in 0..pin_count {
        let part = r.i16("pin part")?;
        let probe = r.i16("pin probe")?;
        let net = r.i16("pin net")?;
        let x = r.i16("pin x")?;
        let y = r.i16("pin y")?;
        let _shape = r.i16("pin shape")?;
        r.skip(4, "pin record")?;

        let pin = RawPin {
            pos: Point::new(f64::from(x), f64::from(y)),
            net: usize::try_from(net).ok().and_then(|n| nets.get(n)).cloned().unwrap_or_default(),
            probe: Some(i32::from(probe)),
            ..Default::default()
        };
        match usize::try_from(part).ok().and_then(|p| board.parts.get_mut(p)) {
            Some(p) => p.pins.push(pin),
            None => orphans.push(pin),
        }
    }

    if !orphans.is_empty() {
        let mut part = RawPart::new("...", Side::Both, Mount::ThroughHole);
        part.pins = orphans;
        board.parts.push(part);
    }
    Ok(board)
}
