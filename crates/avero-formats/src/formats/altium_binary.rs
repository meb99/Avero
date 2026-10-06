//! Altium PCB 6 compound documents. Binary record layouts adapted from
//! tscircuit/altiumts (MIT); attribution is in THIRD_PARTY.md.
//! Shared ASCII and binary normalization keeps pad/net semantics consistent.
use std::io::{Cursor, Read};

use crate::{builder::RawBoard, model::FormatId, ParseError};

const F: FormatId = FormatId::AltiumBinary;
const MAX_STREAM: u64 = 128 * 1024 * 1024;
const MAX_RECORDS: usize = 2_000_000;
fn err(message: impl Into<String>) -> ParseError {
    ParseError::invalid(F, message)
}

pub fn detect(buf: &[u8]) -> bool {
    buf.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
}

fn layer(id: u8) -> String {
    match id {
        1 => "TOP".into(),
        2..=31 => format!("MID-LAYER{}", id - 1),
        32 => "BOTTOM".into(),
        56 => "KEEPOUT".into(),
        74 => "MULTILAYER".into(),
        39..=54 => format!("MID-PLANE{}", id - 38),
        _ => format!("LAYER{id}"),
    }
}

struct Records<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Records<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ParseError> {
        let end = self.at.checked_add(n).ok_or_else(|| err("record size overflow"))?;
        let out =
            self.bytes.get(self.at..end).ok_or_else(|| err(format!("truncated stream at {}", self.at)))?;
        self.at = end;
        Ok(out)
    }
    fn block(&mut self) -> Result<&'a [u8], ParseError> {
        let n = u32::from_le_bytes(self.take(4)?.try_into().unwrap()) as usize & 0x00ff_ffff;
        self.take(n)
    }
    fn more(&self) -> bool {
        self.at < self.bytes.len()
    }
}
fn i32_at(p: &[u8], at: usize) -> i32 {
    i32::from_le_bytes(p[at..at + 4].try_into().unwrap())
}
fn u16_at(p: &[u8], at: usize) -> u16 {
    u16::from_le_bytes(p[at..at + 2].try_into().unwrap())
}
fn f64_at(p: &[u8], at: usize) -> Result<f64, ParseError> {
    let v = f64::from_le_bytes(p[at..at + 8].try_into().unwrap());
    if v.is_finite() {
        Ok(v)
    } else {
        Err(err("non-finite geometry"))
    }
}
fn mil(p: &[u8], at: usize) -> String {
    format!("{}mil", i32_at(p, at) as f64 / 10_000.)
}
fn decode(p: &[u8]) -> String {
    encoding_rs::WINDOWS_1252.decode(p).0.into_owned()
}
fn stream(cfb: &mut cfb::CompoundFile<Cursor<&[u8]>>, path: &str) -> Result<Option<Vec<u8>>, ParseError> {
    if !cfb.is_stream(path) {
        return Ok(None);
    }
    let mut input = cfb.open_stream(path).map_err(|e| err(format!("{path}: {e}")))?;
    if input.len() > MAX_STREAM {
        return Err(err(format!("{path}: stream too large")));
    }
    let mut bytes = Vec::new();
    input.read_to_end(&mut bytes).map_err(|e| err(format!("{path}: {e}")))?;
    Ok(Some(bytes))
}

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let mut cfb = cfb::CompoundFile::open(Cursor::new(buf))
        .map_err(|e| err(format!("invalid compound document: {e}")))?;
    if !cfb.is_stream("/Board6/Data") {
        return Err(err("not a PCB 6 document: Board6/Data is absent"));
    }
    let mut text = String::from("|RECORD=Board|KIND=Protel_Advanced_PCB|\n");
    let mut warnings = Vec::new();
    let mut total = 0usize;
    for (family, kind) in [("Board6", "Board"), ("Nets6", "Net"), ("Components6", "Component")] {
        let Some(bytes) = stream(&mut cfb, &format!("/{family}/Data"))? else {
            continue;
        };
        let mut r = Records { bytes: &bytes, at: 0 };
        let mut count = 0;
        while r.more() {
            let raw = decode(r.block()?);
            let raw = raw.trim_end_matches('\0');
            if !raw.starts_with('|') {
                return Err(err(format!("invalid property record in {family}")));
            }
            let raw = raw.replace(['\n', '\r'], " ");
            text.push_str(&format!("|RECORD={kind}|ID={count}{raw}\n"));
            count += 1;
            total += 1;
            if total > MAX_RECORDS {
                return Err(err("too many records"));
            }
        }
        verify_count(&mut cfb, family, count)?;
    }
    for (family, typ, min) in [("Tracks6", 4, 33), ("Arcs6", 1, 45), ("Vias6", 3, 31), ("Pads6", 2, 106)] {
        let Some(bytes) = stream(&mut cfb, &format!("/{family}/Data"))? else {
            continue;
        };
        let mut r = Records { bytes: &bytes, at: 0 };
        let mut count = 0;
        while r.more() {
            if r.take(1)?[0] != typ {
                return Err(err(format!("unexpected record type in {family}")));
            }
            let mut name = String::new();
            let p = if typ == 2 {
                let n = r.block()?;
                if let Some(&len) = n.first() {
                    let raw = n.get(1..1 + len as usize).ok_or_else(|| err("truncated pad name"))?;
                    name = decode(raw).replace(['|', '\n', '\r'], " ");
                }
                for _ in 0..3 {
                    r.block()?;
                }
                let geometry = r.block()?;
                let stack = r.block()?;
                if !stack.is_empty() {
                    warnings.push("Pad-stack variations are retained by the source file; the viewer shows the primary pad shape.".into());
                }
                geometry
            } else {
                r.block()?
            };
            if p.len() < min {
                return Err(err(format!("short {family} geometry record")));
            }
            let l = layer(p[0]);
            let net = u16_at(p, 3);
            let component = u16_at(p, 7);
            match typ {
                4 => text.push_str(&format!("|RECORD=Track|LAYER={l}|NET={net}|X1={}|Y1={}|X2={}|Y2={}|WIDTH={}|\n", mil(p,13),mil(p,17),mil(p,21),mil(p,25),mil(p,29))),
                1 => text.push_str(&format!("|RECORD=Arc|LAYER={l}|NET={net}|LOCATION.X={}|LOCATION.Y={}|RADIUS={}|STARTANGLE={}|ENDANGLE={}|WIDTH={}|\n",mil(p,13),mil(p,17),mil(p,21),f64_at(p,25)?,f64_at(p,33)?,mil(p,41))),
                3 => text.push_str(&format!("|RECORD=Via|LAYER={l}|NET={net}|X={}|Y={}|DIAMETER={}|HOLESIZE={}|FROMLAYER={}|TOLAYER={}|\n",mil(p,13),mil(p,17),mil(p,21),mil(p,25),layer(p[29]),layer(p[30]))),
                2 => {
                    let shape = if p[49] == 1 { "ROUND" } else { "RECTANGLE" };
                    if ![1,2].contains(&p[49]) { warnings.push(format!("Pad shape {} is shown with its bounding rectangle.", p[49])); }
                    text.push_str(&format!("|RECORD=Pad|NAME={name}|LAYER={l}|NET={net}|COMPONENT={component}|X={}|Y={}|XSIZE={}|YSIZE={}|HOLESIZE={}|SHAPE={shape}|ROTATION={}|\n",mil(p,13),mil(p,17),mil(p,21),mil(p,25),mil(p,45),f64_at(p,52)?));
                }
                _ => unreachable!(),
            }
            count += 1;
            total += 1;
            if total > MAX_RECORDS || text.len() > MAX_STREAM as usize * 2 {
                return Err(err("decoded board too large"));
            }
        }
        verify_count(&mut cfb, family, count)?;
    }
    for family in ["Fills6", "Regions6", "ShapeBasedRegions6", "ComponentBodies6", "Texts6", "Polygons6"] {
        if let Some(header) = stream(&mut cfb, &format!("/{family}/Header"))? {
            if header.len() >= 4 {
                let n = u32::from_le_bytes(header[..4].try_into().unwrap());
                if n > 0 {
                    warnings.push(format!(
                        "{family}: {n} decorative/area primitives are not drawn by this importer."
                    ));
                }
            }
        }
    }
    let mut board = super::altium::parse(text.as_bytes())?;
    board.format = F;
    warnings.sort();
    warnings.dedup();
    for warning in warnings {
        board.warn(warning);
    }
    Ok(board)
}

fn verify_count(
    cfb: &mut cfb::CompoundFile<Cursor<&[u8]>>,
    family: &str,
    count: usize,
) -> Result<(), ParseError> {
    if let Some(bytes) = stream(cfb, &format!("/{family}/Header"))? {
        if bytes.len() < 4 {
            return Err(err(format!("short {family} header")));
        }
        let expected = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        if expected != count {
            return Err(err(format!("{family}: expected {expected} records, found {count}")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn doc(pad: Vec<u8>) -> Vec<u8> {
        let mut doc = cfb::CompoundFile::create(Cursor::new(Vec::<u8>::new())).unwrap();
        for (family, data) in [
            ("Board6", b"|KIND=Protel_Advanced_PCB|".to_vec()),
            ("Nets6", b"|NAME=VCC|".to_vec()),
            ("Components6", b"|SOURCEDESIGNATOR=U1|LAYER=TOP|".to_vec()),
            ("Pads6", pad),
        ] {
            doc.create_storage(format!("/{family}")).unwrap();
            let data = if family != "Pads6" {
                [(data.len() as u32).to_le_bytes().to_vec(), data].concat()
            } else {
                data
            };
            doc.create_stream(format!("/{family}/Data")).unwrap().write_all(&data).unwrap();
            doc.create_stream(format!("/{family}/Header")).unwrap().write_all(&1u32.to_le_bytes()).unwrap();
        }
        doc.into_inner().into_inner()
    }
    #[test]
    fn binary_pad_has_actual_coordinates_number_and_net() {
        let mut geom = vec![0; 106];
        geom[0] = 1;
        geom[49] = 2;
        geom[13..17].copy_from_slice(&1_234_000i32.to_le_bytes());
        geom[17..21].copy_from_slice(&(-560_000i32).to_le_bytes());
        geom[21..25].copy_from_slice(&200_000i32.to_le_bytes());
        geom[25..29].copy_from_slice(&400_000i32.to_le_bytes());
        let mut pads = vec![2];
        for payload in [vec![2, b'A', b'1'], vec![], vec![], vec![], geom, vec![]] {
            pads.extend((payload.len() as u32).to_le_bytes());
            pads.extend(payload);
        }
        let board = crate::parse(&doc(pads), Some("test.PcbDoc")).unwrap();
        assert_eq!(board.format, F);
        assert_eq!(board.parts[0].name, "U1");
        let p = &board.pins[0];
        assert_eq!(p.number, "A1");
        assert_eq!(p.x, 123.4);
        assert_eq!(p.y, -56.);
        assert_eq!(board.nets[p.net as usize].name, "VCC");
        assert_eq!(p.pad.unwrap().h, 40.);
    }
    #[test]
    fn truncated_primitive_is_rejected() {
        assert!(parse(&doc(vec![2, 255, 255, 255, 0])).is_err());
    }
}
