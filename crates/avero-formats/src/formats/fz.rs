//! ASUS `.fz` boardviews, following OpenBoardView's `FZFile`.
//!
//! - Most files are encrypted with a stream cipher built from RC6 rounds:
//!   every byte is XOR-ed with the low byte of an RC6 encryption of the 16
//!   ciphertext bytes before it. The 44-word key is not part of Avero;
//!   users enter it in the settings. Files whose bytes 4 and 5 are a zlib
//!   header are not encrypted and open without a key.
//! - The plain file holds two zlib streams: the content from byte 4, and a
//!   part description table that starts `len − 4` bytes before the end,
//!   `len` being the little-endian `u32` in the last four bytes.
//! - The content is text. `A!` lines open a block (`REFDES` parts,
//!   `NET_NAME` pins, `TESTVIA` test points), `S!` lines are its rows with
//!   fields separated by `!`. Coordinates are mils unless a
//!   `UNIT:millimeters` line says otherwise; some files use decimal commas.
//! - The description table is tab-separated: part number, description,
//!   quantity, locations (part names), second part number.
//!
//! `.cae` files are the same format with a key of their own (another
//! parity pattern, as in OpenBoardView's `CAEFile`).

use std::collections::HashMap;
use std::io::Read;

use flate2::read::ZlibDecoder;

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::decode;
use crate::ParseError;

pub const KEY_WORDS: usize = 44;
pub type FzKey = [u32; KEY_WORDS];

/// Parity of every key word (1 = even number of set bits), as OpenBoardView
/// checks it. Catches typos before a wrong key produces garbage.
const KEY_PARITY: [u8; KEY_WORDS] = [
    0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 1, 0, 0, 1, 1, 0, 1,
];
/// The same check for `.cae` keys.
const CAE_KEY_PARITY: [u8; KEY_WORDS] = [
    1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1,
    0, 1, 1, 0, 1, 1, 1, 0, 0,
];

/// `.fz` (ASUS) or `.cae`: one format, two keys.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Variant {
    Fz,
    Cae,
}

impl Variant {
    fn format(self) -> FormatId {
        match self {
            Variant::Fz => FormatId::Fz,
            Variant::Cae => FormatId::Cae,
        }
    }
    fn parity(self) -> &'static [u8; KEY_WORDS] {
        match self {
            Variant::Fz => &KEY_PARITY,
            Variant::Cae => &CAE_KEY_PARITY,
        }
    }
    fn needs_key(self) -> ParseError {
        match self {
            Variant::Fz => ParseError::NeedsFzKey,
            Variant::Cae => ParseError::NeedsCaeKey,
        }
    }
    fn invalid_key(self) -> ParseError {
        match self {
            Variant::Fz => ParseError::InvalidFzKey,
            Variant::Cae => ParseError::InvalidCaeKey,
        }
    }
}

const ROUNDS: usize = 20;
/// Largest inflated section accepted, against archive bombs.
const MAX_SECTION: u64 = 512 * 1024 * 1024;
const OUTLINE_MARGIN: f64 = 20.0;

pub fn key_is_plausible(key: &FzKey) -> bool {
    key_fits(key, Variant::Fz)
}

/// Whether a key has the parity pattern of `.fz` or of `.cae` keys.
pub fn key_fits(key: &FzKey, variant: Variant) -> bool {
    key.iter().zip(variant.parity()).all(|(w, &p)| u8::from(w.count_ones().is_multiple_of(2)) == p)
}

/// Keys in a text: every 44 words one key, so the `.fz` and the `.cae` key
/// can share one settings field. None when the word count is no multiple of 44.
pub fn parse_keys(text: &str) -> Option<Vec<FzKey>> {
    let words: Vec<u32> = text
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .filter(|t| !t.is_empty())
        .map(|t| u32::from_str_radix(t.trim_start_matches("0x").trim_start_matches("0X"), 16).ok())
        .collect::<Option<_>>()?;
    if words.is_empty() || !words.len().is_multiple_of(KEY_WORDS) {
        return None;
    }
    Some(words.chunks(KEY_WORDS).map(|c| c.try_into().expect("44 words")).collect())
}

/// Parses 44 hexadecimal words (with or without `0x`), separated by spaces,
/// commas or line breaks, as found in OpenBoardView's configuration.
pub fn parse_key(text: &str) -> Option<FzKey> {
    let words: Vec<u32> = text
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .filter(|t| !t.is_empty())
        .map(|t| u32::from_str_radix(t.trim_start_matches("0x").trim_start_matches("0X"), 16).ok())
        .collect::<Option<_>>()?;
    words.try_into().ok()
}

/// Which of the entered keys is for `.fz` and which for `.cae`, by their
/// parity. A key that fits neither (a typo) goes to both, so opening a file
/// says the key is wrong rather than missing.
pub fn assign_keys(keys: &[FzKey]) -> (Option<FzKey>, Option<FzKey>) {
    let pick = |v: Variant, other: Variant| {
        keys.iter().find(|k| key_fits(k, v)).or_else(|| keys.iter().find(|k| !key_fits(k, other))).copied()
    };
    (pick(Variant::Fz, Variant::Cae), pick(Variant::Cae, Variant::Fz))
}

/// True when the file carries no encryption (a zlib header at byte 4).
fn is_plain(buf: &[u8]) -> bool {
    matches!(buf.get(4..6), Some([0x78, 0x9c | 0xda]))
}

/// The RC6-based stream cipher; `encrypt` only changes which byte feeds the
/// window (always the ciphertext).
fn crypt(data: &mut [u8], key: &FzKey, encrypt: bool) {
    let (mut a, mut b, mut c, mut d) = (0u32, 0u32, 0u32, 0u32);
    let mut window = [0u8; 16];
    for byte in data.iter_mut() {
        b = b.wrapping_add(key[0]);
        d = d.wrapping_add(key[1]);
        for i in 1..=ROUNDS {
            let t = b.wrapping_mul(b.wrapping_mul(2).wrapping_add(1)).rotate_left(5);
            let u = d.wrapping_mul(d.wrapping_mul(2).wrapping_add(1)).rotate_left(5);
            a = (a ^ t).rotate_left(u & 31).wrapping_add(key[2 * i]);
            c = (c ^ u).rotate_left(t & 31).wrapping_add(key[2 * i + 1]);
            (a, b, c, d) = (b, c, d, a);
        }
        a = a.wrapping_add(key[2 * ROUNDS + 2]);
        let input = *byte;
        *byte ^= a as u8;
        let cipher_byte = if encrypt { *byte } else { input };
        window.copy_within(1.., 0);
        window[15] = cipher_byte;
        let word = |i: usize| u32::from_le_bytes([window[i], window[i + 1], window[i + 2], window[i + 3]]);
        (a, b, c, d) = (word(0), word(4), word(8), word(12));
    }
}

/// Encryption counterpart, for building test files.
pub fn encrypt(data: &[u8], key: &FzKey) -> Vec<u8> {
    let mut out = data.to_vec();
    crypt(&mut out, key, true);
    out
}

fn inflate(data: &[u8], what: &str) -> Result<Vec<u8>, ParseError> {
    let mut out = Vec::new();
    ZlibDecoder::new(data)
        .take(MAX_SECTION)
        .read_to_end(&mut out)
        .map_err(|e| ParseError::invalid(FormatId::Fz, format!("{what} is damaged ({e})")))?;
    Ok(out)
}

fn number(field: &str) -> Option<f64> {
    field.trim().replace(',', ".").parse().ok()
}

#[derive(Clone, Copy, PartialEq)]
enum Block {
    None,
    Parts,
    Pins,
    TestVias,
    Other,
}

pub fn parse(input: &[u8], key: Option<&FzKey>) -> Result<RawBoard, ParseError> {
    parse_variant(input, key, Variant::Fz)
}

pub fn parse_variant(input: &[u8], key: Option<&FzKey>, variant: Variant) -> Result<RawBoard, ParseError> {
    let format = variant.format();
    if input.len() < 12 {
        return Err(ParseError::invalid(format, "file is too short"));
    }
    let mut buf = input.to_vec();
    if !is_plain(&buf) {
        let key = key.ok_or(variant.needs_key())?;
        if !key_fits(key, variant) {
            return Err(variant.invalid_key());
        }
        crypt(&mut buf, key, false);
    }

    let n = buf.len();
    let len = u32::from_le_bytes([buf[n - 4], buf[n - 3], buf[n - 2], buf[n - 1]]) as usize;
    let descr_start = (n + 4).checked_sub(len).filter(|&s| s > 4 && s < n);
    // A wrong key yields noise here, so say so rather than "damaged".
    let Some(descr_start) = descr_start else {
        return Err(if is_plain(input) {
            ParseError::invalid(format, "no content")
        } else {
            variant.invalid_key()
        });
    };
    let content =
        inflate(&buf[4..], "content").map_err(|e| if is_plain(input) { e } else { variant.invalid_key() })?;
    let descr = inflate(&buf[descr_start..], "part list").unwrap_or_default();

    let mut board = RawBoard::new(format);
    let mut parts: Vec<RawPart> = Vec::new();
    let mut part_index: HashMap<String, usize> = HashMap::new();
    let mut scale = 1.0;
    let mut block = Block::None;
    let mut unknown_parts = 0usize;

    for line in decode(&content).lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.eq_ignore_ascii_case("UNIT:millimeters") {
            scale = 1000.0 / 25.4;
            continue;
        }
        if let Some(header) = line.strip_prefix("A!") {
            block = if header.starts_with("REFDES") {
                Block::Parts
            } else if header.starts_with("NET_NAME") {
                Block::Pins
            } else if header.starts_with("TESTVIA") {
                Block::TestVias
            } else {
                Block::Other
            };
            continue;
        }
        let Some(row) = line.strip_prefix("S!") else { continue };
        let f: Vec<&str> = row.split('!').map(str::trim).collect();
        let field = |i: usize| f.get(i).copied().unwrap_or("");
        match block {
            Block::Parts => {
                let name = field(0);
                if name.is_empty() {
                    continue;
                }
                let side = if field(3) == "YES" { Side::Bottom } else { Side::Top };
                part_index.insert(name.to_string(), parts.len());
                parts.push(RawPart::new(name, side, Mount::Smd));
            }
            Block::Pins => {
                let Some(&owner) = part_index.get(field(1)) else {
                    unknown_parts += 1;
                    continue;
                };
                let (Some(x), Some(y)) = (number(field(4)), number(field(5))) else { continue };
                // Some files leave the pin number empty or "0" and put the
                // ball name (AJ31) in the name column instead.
                let (snum, name) = (field(2), field(3));
                let by_name = snum.is_empty() || snum == "0";
                parts[owner].pins.push(RawPin {
                    pos: Point::new(x * scale, y * scale),
                    net: field(0).to_string(),
                    number: Some(if by_name { name } else { snum }.to_string()).filter(|s| !s.is_empty()),
                    name: (!by_name && !name.is_empty()).then(|| name.to_string()),
                    probe: field(6).parse().ok(),
                    ..Default::default()
                });
            }
            Block::TestVias => {
                // Rows start with an extra "Y!" field.
                let g = |i: usize| field(i + 1);
                let (Some(x), Some(y)) = (number(g(4)), number(g(5))) else { continue };
                board.test_points.push(RawTestPoint {
                    kind: TestPointKind::Nail,
                    pos: Point::new(x * scale, y * scale),
                    side: if g(6) == "T" { Side::Top } else { Side::Bottom },
                    net: g(0).to_string(),
                    probe: None,
                    radius: None,
                    name: None,
                });
            }
            Block::None | Block::Other => {}
        }
    }
    if unknown_parts > 0 {
        board.warn(format!("{unknown_parts} pins belong to parts that are not listed"));
    }

    // Part descriptions (values) from the second section; the first two
    // lines are the board description and column names.
    for line in decode(&descr).lines().skip(2) {
        let line = line.trim_start_matches(|c: char| c.is_whitespace() && c != '\t');
        if line.is_empty() || line.starts_with('s') {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        let description = cols.get(1).map(|s| s.trim()).unwrap_or("");
        if description.is_empty() {
            continue;
        }
        for location in cols.get(3).copied().unwrap_or("").split(|c: char| c.is_whitespace() || c == ',') {
            if let Some(&i) = part_index.get(location) {
                parts[i].device.get_or_insert_with(|| description.to_string());
            }
        }
    }

    // No outline in the file: a rectangle around the pins, as OpenBoardView does.
    let pins = parts.iter().flat_map(|p| p.pins.iter().map(|pin| pin.pos));
    let (mut min, mut max) = (Point::new(f64::MAX, f64::MAX), Point::new(f64::MIN, f64::MIN));
    for p in pins {
        min = Point::new(min.x.min(p.x), min.y.min(p.y));
        max = Point::new(max.x.max(p.x), max.y.max(p.y));
    }
    if min.x <= max.x {
        let (x0, y0, x1, y1) =
            (min.x - OUTLINE_MARGIN, min.y - OUTLINE_MARGIN, max.x + OUTLINE_MARGIN, max.y + OUTLINE_MARGIN);
        board.outline_path = vec![
            Point::new(x0, y0),
            Point::new(x1, y0),
            Point::new(x1, y1),
            Point::new(x0, y1),
            Point::new(x0, y0),
        ];
    }
    board.parts = parts;
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A key with the right parity, for tests only.
    pub(crate) fn test_key() -> FzKey {
        let mut key = [0u32; KEY_WORDS];
        for (i, w) in key.iter_mut().enumerate() {
            let mut v = (i as u32).wrapping_mul(0x9e37_79b9) ^ 0x5bd1_e995;
            if u8::from(v.count_ones().is_multiple_of(2)) != KEY_PARITY[i] {
                v ^= 1;
            }
            *w = v;
        }
        key
    }

    #[test]
    fn cipher_round_trips() {
        let key = test_key();
        assert!(key_is_plausible(&key));
        let plain = b"A!REFDES!COMP_INSERTION_CODE!SYM_NAME!SYM_MIRROR!SYM_ROTATE!\nS!U1!!!NO!0!\n".repeat(5);
        let cipher = encrypt(&plain, &key);
        assert_ne!(cipher, plain);
        let mut back = cipher.clone();
        crypt(&mut back, &key, false);
        assert_eq!(back, plain);
    }

    #[test]
    fn parses_keys() {
        let key = test_key();
        let text: String = key.iter().map(|w| format!("0x{w:08x} ")).collect();
        assert_eq!(parse_key(&text), Some(key));
        assert_eq!(parse_key("0x1 0x2"), None);
        assert_eq!(parse_key(&text.replace("0x", "zz")), None);
    }
}
