//! Helpers for the line-oriented text formats.
//!
//! Boardview files come from old Windows tools. They mix CRLF and LF line
//! endings, are often Latin-1 instead of UTF-8, and put numbers directly next
//! to punctuation (`1.25,`). These helpers read them the way the original C
//! tools did (`strtol`/`strtod` semantics) without panicking on bad input.

use std::borrow::Cow;

/// Splits a buffer into lines, accepting `\n`, `\r\n` and lone `\r`.
pub fn lines(buf: &[u8]) -> impl Iterator<Item = &[u8]> {
    line_spans(buf).map(move |(start, end, _)| &buf[start..end])
}

/// Like [`lines`], but yields `(start, end, next_line_start)` byte offsets.
pub fn line_spans(buf: &[u8]) -> impl Iterator<Item = (usize, usize, usize)> + '_ {
    let mut pos = 0;
    std::iter::from_fn(move || {
        if pos >= buf.len() {
            return None;
        }
        let start = pos;
        let end =
            buf[start..].iter().position(|&b| b == b'\n' || b == b'\r').map_or(buf.len(), |i| start + i);
        let next = match buf.get(end) {
            None => end,
            Some(b'\r') if buf.get(end + 1) == Some(&b'\n') => end + 2,
            Some(_) => end + 1,
        };
        pos = next;
        Some((start, end, next))
    })
}

/// Decodes bytes as UTF-8, falling back to Latin-1 for invalid sequences.
pub fn decode(bytes: &[u8]) -> Cow<'_, str> {
    match std::str::from_utf8(bytes) {
        Ok(s) => Cow::Borrowed(s),
        Err(_) => Cow::Owned(bytes.iter().map(|&b| b as char).collect()),
    }
}

pub fn trim(line: &[u8]) -> &[u8] {
    let start = line.iter().position(|b| !b.is_ascii_whitespace()).unwrap_or(line.len());
    let end = line.iter().rposition(|b| !b.is_ascii_whitespace()).map_or(start, |i| i + 1);
    &line[start..end]
}

pub fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    find(haystack, needle).is_some()
}

pub fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// A cursor over one line that reads whitespace-separated fields.
pub struct Fields<'a> {
    rest: &'a [u8],
}

impl<'a> Fields<'a> {
    pub fn new(line: &'a [u8]) -> Self {
        Self { rest: line }
    }

    fn skip_ws(&mut self) {
        let n = self.rest.iter().take_while(|b| b.is_ascii_whitespace()).count();
        self.rest = &self.rest[n..];
    }

    pub fn is_empty(&mut self) -> bool {
        self.skip_ws();
        self.rest.is_empty()
    }

    /// Skips `n` raw bytes (used by formats with a marker character).
    pub fn skip_bytes(&mut self, n: usize) {
        self.rest = &self.rest[n.min(self.rest.len())..];
    }

    /// Next whitespace-delimited field as raw bytes.
    pub fn raw(&mut self) -> Option<&'a [u8]> {
        self.skip_ws();
        if self.rest.is_empty() {
            return None;
        }
        let n = self.rest.iter().take_while(|b| !b.is_ascii_whitespace()).count();
        let (field, rest) = self.rest.split_at(n);
        self.rest = rest;
        Some(field)
    }

    /// Next field decoded to a string.
    pub fn string(&mut self) -> Option<String> {
        self.raw().map(|f| decode(f).into_owned())
    }

    /// Next field if it is a quoted string (`"a b"`), otherwise a plain field.
    pub fn quoted_or_plain(&mut self) -> Option<String> {
        self.skip_ws();
        if self.rest.first() == Some(&b'"') {
            let body = &self.rest[1..];
            let end = body.iter().position(|&b| b == b'"').unwrap_or(body.len());
            self.rest = body.get(end + 1..).unwrap_or(&[]);
            return Some(decode(&body[..end]).into_owned());
        }
        self.string()
    }

    /// Reads an integer with `strtol` semantics: leading whitespace, optional
    /// sign, digits. Returns `None` when no digits are present.
    pub fn int(&mut self) -> Option<i64> {
        self.skip_ws();
        let (value, used) = parse_int_prefix(self.rest)?;
        self.rest = &self.rest[used..];
        Some(value)
    }

    /// Reads a decimal number with `strtod` semantics.
    pub fn float(&mut self) -> Option<f64> {
        self.skip_ws();
        let (value, used) = parse_float_prefix(self.rest)?;
        self.rest = &self.rest[used..];
        Some(value)
    }

    /// Skips a single separator character such as `,` if it is next.
    pub fn eat(&mut self, c: u8) -> bool {
        self.skip_ws();
        if self.rest.first() == Some(&c) {
            self.rest = &self.rest[1..];
            true
        } else {
            false
        }
    }

    /// The rest of the line, trimmed and decoded.
    pub fn rest_string(&mut self) -> String {
        decode(trim(self.rest)).into_owned()
    }
}

fn parse_int_prefix(s: &[u8]) -> Option<(i64, usize)> {
    let mut i = 0;
    let negative = match s.first() {
        Some(b'-') => {
            i = 1;
            true
        }
        Some(b'+') => {
            i = 1;
            false
        }
        _ => false,
    };
    let digits_start = i;
    let mut value: i64 = 0;
    while let Some(&b) = s.get(i) {
        if !b.is_ascii_digit() {
            break;
        }
        value = value.saturating_mul(10).saturating_add(i64::from(b - b'0'));
        i += 1;
    }
    if i == digits_start {
        return None;
    }
    Some((if negative { -value } else { value }, i))
}

fn parse_float_prefix(s: &[u8]) -> Option<(f64, usize)> {
    let mut i = 0;
    if matches!(s.first(), Some(b'-' | b'+')) {
        i += 1;
    }
    let mut digits = 0;
    while s.get(i).is_some_and(u8::is_ascii_digit) {
        i += 1;
        digits += 1;
    }
    if s.get(i) == Some(&b'.') {
        i += 1;
        while s.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return None;
    }
    if matches!(s.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(s.get(j), Some(b'-' | b'+')) {
            j += 1;
        }
        let exp_start = j;
        while s.get(j).is_some_and(u8::is_ascii_digit) {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    let text = std::str::from_utf8(&s[..i]).ok()?;
    text.parse::<f64>().ok().map(|v| (v, i))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_mixed_line_endings() {
        let got: Vec<&[u8]> = lines(b"a\r\nb\nc\rd").collect();
        assert_eq!(got, vec![&b"a"[..], b"b", b"c", b"d"]);
    }

    #[test]
    fn keeps_empty_lines() {
        let got: Vec<&[u8]> = lines(b"a\n\nb\r\n\r\nc").collect();
        assert_eq!(got, vec![&b"a"[..], b"", b"b", b"", b"c"]);
    }

    #[test]
    fn reads_numbers_like_strtod() {
        let mut f = Fields::new(b"  12 -3.5e2, 7abc x");
        assert_eq!(f.int(), Some(12));
        assert_eq!(f.float(), Some(-350.0));
        assert!(f.eat(b','));
        assert_eq!(f.int(), Some(7));
        assert_eq!(f.string().as_deref(), Some("abc"));
        assert_eq!(f.int(), None);
        assert_eq!(f.string().as_deref(), Some("x"));
        assert_eq!(f.string(), None);
    }

    #[test]
    fn falls_back_to_latin1() {
        assert_eq!(decode(&[0x4d, 0xfc, 0x6c]), "Mül");
        assert_eq!(decode("Mül".as_bytes()), "Mül");
    }

    #[test]
    fn reads_quoted_fields() {
        let mut f = Fields::new(br#"VALUE "10 k" next"#);
        assert_eq!(f.string().as_deref(), Some("VALUE"));
        assert_eq!(f.quoted_or_plain().as_deref(), Some("10 k"));
        assert_eq!(f.quoted_or_plain().as_deref(), Some("next"));
    }
}
