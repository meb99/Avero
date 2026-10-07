//! Standard GenCAD header attributes. Other viewers can ignore these;
//! Avero retains the original XZZ bytes and an inventory, including
//! details GenCAD cannot express.
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::{Read, Write};

use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use serde::{Deserialize, Serialize};

use crate::{model::Board, ParseError, MAX_FILE_SIZE};

const PREFIX: &[u8] = b"ATTRIBUTE AVERO_XZZ ";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionReport {
    pub source_bytes: usize,
    pub parts: usize,
    pub pins: usize,
    pub traces: usize,
    pub arcs: usize,
    pub vias: usize,
    pub contours: usize,
    pub outline_lines: usize,
    pub outline_arcs: usize,
    pub texts: usize,
    pub board_texts: Vec<BoardText>,
    pub readings: usize,
    pub assigned_readings: usize,
    pub unreadable_readings: usize,
    pub layers: Vec<u32>,
    pub blocks: BTreeMap<u8, usize>,
    pub preserved_blocks: Vec<PreservedBlock>,
    pub sections: Vec<MetadataSection>,
    pub images: Vec<ImageReference>,
    pub aliases: Vec<PartAlias>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreservedBlock {
    pub scope: String,
    pub kind: u8,
    pub offset: usize,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataSection {
    pub name: String,
    /// Uninterpreted text, not a guessed measurement or executable link.
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardText {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub rotation: f64,
    pub layer: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageReference {
    pub kind: u8,
    pub index: u8,
    pub flags: u8,
    pub width: u32,
    pub height: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartAlias {
    pub source: String,
    pub target: String,
    pub pins: Vec<PinAlias>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinAlias {
    pub source: String,
    pub target: String,
}

fn invalid(message: impl Into<String>) -> ParseError {
    ParseError::invalid(crate::FormatId::GenCad, message)
}

pub(super) fn append(out: &mut Vec<u8>, source: &[u8], report: &ConversionReport) -> Result<(), ParseError> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(source).map_err(|e| invalid(e.to_string()))?;
    let packed = encoder.finish().map_err(|e| invalid(e.to_string()))?;
    let json = serde_json::to_string(report).map_err(|e| invalid(e.to_string()))?;
    let mut section =
        format!("ATTRIBUTE AVERO_XZZ VERSION 1\nATTRIBUTE AVERO_XZZ SOURCE_BYTES {}\n", source.len());
    for (name, bytes) in [("REPORT_HEX", json.as_bytes()), ("DATA", packed.as_slice())] {
        for chunk in bytes.chunks(1024) {
            let _ = write!(section, "ATTRIBUTE AVERO_XZZ {name} ");
            for b in chunk {
                let _ = write!(section, "{b:02x}");
            }
            section.push('\n');
        }
    }
    section.push_str("ATTRIBUTE AVERO_XZZ END 1\n");
    if out.len().saturating_add(section.len()) > MAX_FILE_SIZE {
        return Err(ParseError::TooLarge);
    }
    let at = crate::text::find(out, b"$ENDHEADER").ok_or_else(|| invalid("GenCAD header missing"))?;
    out.splice(at..at, section.bytes());
    Ok(())
}

/// Restores exactly the input file, including its XOR, encrypted parts,
/// unrecognized blocks and original encoding. No keys are stored here.
pub fn original_xzz(cad: &[u8]) -> Result<Option<Vec<u8>>, ParseError> {
    read(cad).map(|a| a.map(|(source, _)| source))
}

/// The exported inventory, including the sections kept as metadata.
pub fn conversion_report(cad: &[u8]) -> Result<Option<ConversionReport>, ParseError> {
    read(cad).map(|a| a.map(|(_, report)| report))
}

fn read(cad: &[u8]) -> Result<Option<(Vec<u8>, ConversionReport)>, ParseError> {
    if cad.len() > MAX_FILE_SIZE {
        return Err(ParseError::TooLarge);
    }
    let mut inside = false;
    let mut ended = false;
    let mut version = None;
    let mut size = None;
    let mut report_bytes = Vec::new();
    let mut packed = Vec::new();
    let mut found = false;
    let mut header_ended = false;
    for line in crate::text::lines(cad) {
        let line = crate::text::trim(line);
        if line == b"$HEADER" {
            inside = true;
            continue;
        }
        if line == b"$ENDHEADER" {
            header_ended = true;
            inside = false;
            continue;
        }
        if !inside {
            continue;
        }
        let Some(line) = line.strip_prefix(PREFIX) else { continue };
        found = true;
        if ended {
            return Err(invalid("XZZ archive record after its end"));
        }
        if line == b"END 1" {
            ended = true;
            continue;
        }
        if let Some(v) = line.strip_prefix(b"VERSION ") {
            if version.replace(v.to_vec()).is_some() {
                return Err(invalid("duplicate XZZ archive version"));
            }
        } else if let Some(n) = line.strip_prefix(b"SOURCE_BYTES ") {
            let n = std::str::from_utf8(n)
                .ok()
                .and_then(|s| s.parse::<usize>().ok())
                .filter(|n| *n <= MAX_FILE_SIZE)
                .ok_or_else(|| invalid("invalid XZZ archive length"))?;
            if size.replace(n).is_some() {
                return Err(invalid("duplicate XZZ archive length"));
            }
        } else if let Some((destination, hex)) = line
            .strip_prefix(b"DATA ")
            .map(|h| (&mut packed, h))
            .or_else(|| line.strip_prefix(b"REPORT_HEX ").map(|h| (&mut report_bytes, h)))
        {
            if hex.len() % 2 != 0 {
                return Err(invalid("invalid XZZ archive hex"));
            }
            for pair in hex.as_chunks::<2>().0 {
                let digit = |b: u8| match b {
                    b'0'..=b'9' => Some(b - b'0'),
                    b'a'..=b'f' => Some(b - b'a' + 10),
                    b'A'..=b'F' => Some(b - b'A' + 10),
                    _ => None,
                };
                let a = digit(pair[0]).ok_or_else(|| invalid("invalid XZZ archive hex"))?;
                let b = digit(pair[1]).ok_or_else(|| invalid("invalid XZZ archive hex"))?;
                destination.push(a * 16 + b);
            }
        } else if !line.is_empty() {
            return Err(invalid("unknown XZZ archive record"));
        }
    }
    if !found {
        return Ok(None);
    }
    if !ended || !header_ended || version.as_deref() != Some(b"1".as_slice()) {
        return Err(invalid("truncated or unsupported XZZ archive"));
    }
    let size = size.ok_or_else(|| invalid("XZZ archive length missing"))?;
    let report: ConversionReport =
        serde_json::from_slice(&report_bytes).map_err(|e| invalid(format!("invalid XZZ inventory: {e}")))?;
    let mut source = Vec::new();
    let mut decoder = ZlibDecoder::new(packed.as_slice());
    (&mut decoder)
        .take(size as u64 + 1)
        .read_to_end(&mut source)
        .map_err(|e| invalid(format!("damaged XZZ archive: {e}")))?;
    if source.len() != size
        || decoder.total_in() as usize != packed.len()
        || report.source_bytes != size
        || !crate::formats::xzz::detect(&source)
    {
        return Err(invalid("XZZ archive does not match its inventory"));
    }
    Ok(Some((source, report)))
}

/// GenCAD cannot express pin reference measurements. Avero restores them
/// from the source, translating only unique aliases created on export.
pub(crate) fn restore(board: &mut Board, cad: &[u8]) -> Result<(), ParseError> {
    let Some((source, report)) = read(cad)? else { return Ok(()) };
    attach_source(board, &source, &report);
    for warning in report.warnings {
        if !board.warnings.contains(&warning) {
            board.warnings.push(warning);
        }
    }
    // Only retained-XZZ exports opt into XZZ's two-view normalization.
    // Ordinary GenCAD panelised boards keep their separate placements.
    crate::fold::fold_side_by_side(board);
    Ok(())
}

pub(super) fn attach_source(board: &mut Board, source: &[u8], report: &ConversionReport) {
    let mut found = crate::formats::xzz::readings(source);
    let mut ambiguous = 0;
    let mut missing = 0;
    found.readings.retain_mut(|r| {
        let mut parts = report.aliases.iter().filter(|p| p.source.eq_ignore_ascii_case(&r.part));
        let Some(part) = parts.next() else {
            missing += 1;
            return false;
        };
        if parts.next().is_some() {
            ambiguous += 1;
            return false;
        }
        let mut pins = part.pins.iter().filter(|p| p.source.eq_ignore_ascii_case(&r.pin));
        let Some(pin) = pins.next() else {
            missing += 1;
            return false;
        };
        if pins.next().is_some() {
            ambiguous += 1;
            return false;
        }
        r.part = part.target.clone();
        r.pin = pin.target.clone();
        true
    });
    let start = board.warnings.len();
    crate::formats::xzz::attach_readings(board, found);
    for warning in &mut board.warnings[start..] {
        *warning = warning.replace("; left out.", "; retained as XZZ metadata and original data.").replace(
            " was left out.",
            " is retained as XZZ metadata and original data; not interpreted as pin readings.",
        );
    }
    if missing > 0 {
        board.warnings.push(format!("{missing} XZZ readings name absent parts or pins. Retained in the embedded original; not assigned to another exported name."));
    }
    if ambiguous > 0 {
        board.warnings.push(format!("{ambiguous} XZZ readings have ambiguous component/pin names. Retained in the embedded original; not assigned to a guessed pin."));
    }
}
