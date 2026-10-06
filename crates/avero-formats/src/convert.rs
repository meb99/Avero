//! Native XZZ → GenCAD conversion. No executable, shell or temporary input is needed.
//!
//! Uses the independently documented XZZ block layout and Avero's existing DES
//! implementation. Keeps copper routing and pad geometry outside the normalized
//! board model, which intentionally does not represent every source detail.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use crate::formats::xzz::{decode_text, des_decrypt, detect};
use crate::model::{FormatId, Point};
use crate::{ParseError, MAX_FILE_SIZE};

pub(crate) mod archive;
pub use archive::{conversion_report, original_xzz, ConversionReport};
use archive::{BoardText, ImageReference, MetadataSection, PartAlias, PinAlias, PreservedBlock};

/// Compatibility key used by the public XZZ-to-GenCAD converter. A configured
/// user key overrides it; keys are never included in exported files.
const DEFAULT_KEY: u64 = 0xDCFC_12AC_0000_0000;
const SCALE: f64 = 10_000.0;

#[derive(Debug)]
pub struct Converted {
    pub cad: Vec<u8>,
    pub parts: usize,
    pub pins: usize,
    pub traces: usize,
    pub vias: usize,
    pub report: ConversionReport,
}

fn invalid(message: impl Into<String>) -> ParseError {
    ParseError::invalid(FormatId::Xzz, message)
}

struct Data<'a>(&'a [u8]);
impl<'a> Data<'a> {
    fn bytes(&self, offset: usize, size: usize) -> Result<&'a [u8], ParseError> {
        let end = offset.checked_add(size).ok_or_else(|| invalid("section size overflow"))?;
        self.0.get(offset..end).ok_or_else(|| invalid(format!("truncated data at byte {offset}")))
    }
    fn u32(&self, offset: usize) -> Result<u32, ParseError> {
        let b = self.bytes(offset, 4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn coordinate(&self, offset: usize) -> Result<f64, ParseError> {
        Ok(f64::from(self.u32(offset)? as i32) / SCALE)
    }
    fn point(&self, offset: usize) -> Result<Point, ParseError> {
        Ok(Point::new(self.coordinate(offset)?, self.coordinate(offset + 4)?))
    }
    fn text(&self, offset: usize, size: usize) -> Result<String, ParseError> {
        let b = self.bytes(offset, size)?;
        Ok(decode_text(b.split(|b| *b == 0).next().unwrap_or_default()).into_owned())
    }
    fn section(&self, offset: usize) -> Result<Data<'a>, ParseError> {
        Ok(Data(self.bytes(offset + 4, self.u32(offset)? as usize)?))
    }
}

#[derive(Debug)]
struct Pad {
    pos: Point,
    name: String,
    layer: u32,
    width: f64,
    height: f64,
    rectangle: bool,
    net: Option<u32>,
    rotation: f64,
    drill: f64,
}
#[derive(Debug)]
struct Part {
    name: String,
    value: String,
    footprint: String,
    pos: Point,
    rotation: f64,
    layer: u32,
    pins: Vec<Pad>,
    lines: Vec<Line>,
    arcs: Vec<Arc>,
    labels: Vec<Label>,
    preserved: Vec<PreservedBlock>,
}
#[derive(Debug)]
struct Label {
    text: String,
    pos: Point,
    size: f64,
    rotation: f64,
    layer: u32,
}
#[derive(Debug)]
struct Line {
    layer: u32,
    start: Point,
    end: Point,
    width: f64,
    net: Option<u32>,
}
#[derive(Debug)]
struct Arc {
    layer: u32,
    center: Point,
    radius: f64,
    start: f64,
    end: f64,
    width: f64,
    net: Option<u32>,
}
#[derive(Debug)]
struct Via {
    pos: Point,
    radius: f64,
    from: u32,
    to: u32,
    net: Option<u32>,
    drill: f64,
}
#[derive(Default)]
struct Board {
    parts: Vec<Part>,
    lines: Vec<Line>,
    arcs: Vec<Arc>,
    vias: Vec<Via>,
    nets: BTreeMap<u32, String>,
    report: ConversionReport,
}

fn net(id: u32, names: &BTreeMap<u32, String>) -> Option<u32> {
    (id != u32::MAX
        && (id != 0 || names.contains_key(&id))
        && !names.get(&id).is_some_and(|s| s.eq_ignore_ascii_case("NC")))
    .then_some(id)
}

fn label(body: Data<'_>) -> Result<Label, ParseError> {
    Ok(Label {
        text: body.text(30, body.u32(26)? as usize)?,
        pos: body.point(4)?,
        size: body.coordinate(12)?.abs(),
        rotation: body.coordinate(20)?,
        layer: body.u32(0)?,
    })
}

fn line(body: Data<'_>, names: &BTreeMap<u32, String>) -> Result<Line, ParseError> {
    Ok(Line {
        layer: body.u32(0)?,
        start: body.point(4)?,
        end: body.point(12)?,
        width: body.coordinate(20)?.abs(),
        net: net(body.u32(24)?, names),
    })
}

fn arc(body: Data<'_>, names: &BTreeMap<u32, String>) -> Result<Arc, ParseError> {
    Ok(Arc {
        layer: body.u32(0)?,
        center: body.point(4)?,
        radius: body.coordinate(12)?.abs(),
        start: body.coordinate(16)?,
        end: body.coordinate(20)?,
        width: body.coordinate(24)?.abs(),
        net: if body.0.len() >= 32 { net(body.u32(28)?, names) } else { None },
    })
}

fn pin(body: Data<'_>, names: &BTreeMap<u32, String>) -> Result<Pad, ParseError> {
    let length = body.0.len();
    body.bytes(0, 28)?;
    let name_size = body.u32(20)? as usize;
    let name = body.text(24, name_size)?;
    let mut offset = 24 + name_size;
    let mut width = 0.0;
    let mut height = 0.0;
    let mut rectangle = false;
    for _ in 0..4 {
        body.bytes(offset, 5)?;
        if body.0[offset..offset + 5] == [0; 5] {
            offset += 5;
            break;
        }
        let w = body.u32(offset)?;
        let h = body.u32(offset + 4)?;
        let kind = body.bytes(offset + 8, 1)?[0];
        if width == 0.0 && w > 0 && h > 0 && matches!(kind, 1 | 2) {
            width = f64::from(w) / SCALE;
            height = f64::from(h) / SCALE;
            rectangle = kind == 2;
        }
        offset += 9;
    }
    let remaining = length.checked_sub(offset).ok_or_else(|| invalid("invalid pin outlines"))?;
    let footer = match remaining {
        4 => 4,
        12.. => 12,
        _ => return Err(invalid("unsupported or truncated pin footer")),
    };
    Ok(Pad {
        pos: body.point(4)?,
        name,
        layer: body.u32(0)?,
        width,
        height,
        rectangle,
        net: net(body.u32(length - footer)?, names),
        // This field is documented as a pin-name field, not a pad angle.
        // Preserve it in the original rather than turning the pad by a guessed angle.
        rotation: 0.0,
        drill: 0.0,
    })
}

fn part(data: &[u8], names: &BTreeMap<u32, String>) -> Result<Part, ParseError> {
    let outer = Data(data);
    let body = outer.bytes(4, outer.u32(0)? as usize)?;
    let d = Data(outer.bytes(0, body.len() + 4)?);
    let footprint_size = d.u32(22)? as usize;
    let footprint = d.text(26, footprint_size)?;
    let mut offset = 26 + footprint_size;
    if d.bytes(offset, 1)?[0] != 6 {
        return Err(invalid("component label missing or wrong DES key"));
    }
    let mut labels = Vec::new();
    let mut pins = Vec::new();
    let mut lines = Vec::new();
    let mut arcs = Vec::new();
    let mut preserved = Vec::new();
    while offset < d.0.len() {
        let kind = d.bytes(offset, 1)?[0];
        offset += 1;
        if kind == 0 {
            continue;
        }
        let size = d.u32(offset)? as usize;
        offset += 4;
        let sub = Data(d.bytes(offset, size)?);
        match kind {
            6 => labels.push(label(sub)?),
            5 => lines.push(line(sub, names)?),
            1 if size >= 28 => arcs.push(arc(sub, names)?),
            9 => pins.push(pin(sub, names)?),
            _ => preserved.push(PreservedBlock {
                scope: "component".into(),
                kind,
                offset: offset - 5,
                bytes: size,
            }),
        }
        offset += size;
    }
    if labels.first().is_none_or(|l| l.text.is_empty()) {
        return Err(invalid("component has no reference"));
    }
    let layer = if pins.iter().any(|p| p.layer == 16) && !pins.iter().any(|p| p.layer == 1) { 16 } else { 1 };
    Ok(Part {
        name: labels[0].text.clone(),
        value: labels.get(1).map(|l| l.text.clone()).unwrap_or_default(),
        footprint,
        pos: d.point(8)?,
        rotation: d.coordinate(16)?,
        layer,
        pins,
        lines,
        arcs,
        labels,
        preserved,
    })
}

fn read(input: &[u8], key: u64) -> Result<Board, ParseError> {
    if input.is_empty() {
        return Err(ParseError::Empty);
    }
    if input.len() > MAX_FILE_SIZE {
        return Err(ParseError::TooLarge);
    }
    if !detect(input) {
        return Err(ParseError::Unrecognized);
    }
    let mut bytes = input.to_vec();
    if let Some(&xor) = bytes.get(0x10).filter(|b| **b != 0) {
        let end = bytes.windows(11).position(|w| w == b"v6v6555v6v6").unwrap_or(bytes.len());
        for b in &mut bytes[..end] {
            *b ^= xor;
        }
    }
    if !bytes.starts_with(b"XZZPCB") {
        return Err(invalid("invalid XOR header"));
    }
    let d = Data(&bytes);
    let main_relative = d.u32(0x20)? as usize;
    let main_start = if main_relative == 0 { 0x40 } else { main_relative + 0x20 };
    let main = d.section(main_start)?;
    let net_relative = d.u32(0x28)? as usize;
    let mut board = Board::default();
    board.report.source_bytes = input.len();
    if net_relative != 0 {
        let nets = d.section(net_relative + 0x20)?;
        let mut offset = 0;
        while offset < nets.0.len() {
            let size = nets.u32(offset)? as usize;
            if size < 8 {
                return Err(invalid("invalid net record"));
            }
            let id = nets.u32(offset + 4)?;
            if board.nets.insert(id, nets.text(offset + 8, size - 8)?).is_some() {
                return Err(invalid(format!("duplicate net index {id}")));
            }
            offset += size;
        }
    }
    let mut offset = 0;
    while offset < main.0.len() {
        let kind = main.0[offset];
        offset += 1;
        if kind == 0 {
            continue;
        }
        let size = main.u32(offset)? as usize;
        offset += 4;
        let body = Data(main.bytes(offset, size)?);
        *board.report.blocks.entry(kind).or_default() += 1;
        match kind {
            1 => board.arcs.push(arc(body, &board.nets)?),
            2 => board.vias.push(Via {
                pos: body.point(0)?,
                radius: body.coordinate(8)?.abs(),
                from: body.u32(16)?,
                to: body.u32(20)?,
                net: net(body.u32(24)?, &board.nets),
                drill: body.coordinate(12)?.abs() * 2.0,
            }),
            5 => board.lines.push(line(body, &board.nets)?),
            6 => {
                let text = label(body)?;
                board.report.board_texts.push(BoardText {
                    text: text.text,
                    x: text.pos.x,
                    y: text.pos.y,
                    size: text.size,
                    rotation: text.rotation,
                    layer: text.layer,
                });
            }
            7 => {
                let decoded = des_decrypt(body.0, key);
                let p = part(&decoded, &board.nets).or_else(|_| part(body.0, &board.nets)).map_err(|e| {
                    invalid(format!("component {} could not be decoded: {e}", board.parts.len() + 1))
                })?;
                board.report.contours += p.lines.len() + p.arcs.len();
                board.report.texts += p.labels.len();
                board.report.preserved_blocks.extend(p.preserved.iter().cloned().map(|mut b| {
                    b.scope = format!("component {} (decrypted)", p.name);
                    b
                }));
                board.parts.push(p);
            }
            9 => {
                let name_size = body.u32(20)? as usize;
                let name = body.text(24, name_size)?;
                let shape = 24 + name_size;
                let width = body.coordinate(shape)?.abs();
                let height = body.coordinate(shape + 4)?.abs();
                board.parts.push(Part {
                    name: if name.is_empty() { format!("TP_{}", body.u32(0)?) } else { name },
                    value: String::new(),
                    footprint: "XZZ_TEST_POINT".into(),
                    pos: body.point(4)?,
                    rotation: 0.0,
                    layer: 1,
                    pins: vec![Pad {
                        name: "1".into(),
                        pos: body.point(4)?,
                        layer: 1,
                        width,
                        height,
                        rectangle: body.bytes(shape + 8, 1)?[0] == 2,
                        net: net(body.u32(56 + name_size)?, &board.nets),
                        rotation: 0.0,
                        drill: body.coordinate(12)?.abs(),
                    }],
                    lines: Vec::new(),
                    arcs: Vec::new(),
                    labels: Vec::new(),
                    preserved: Vec::new(),
                });
            }
            _ => board.report.preserved_blocks.push(PreservedBlock {
                scope: "main".into(),
                kind,
                offset: main_start + 4 + offset - 5,
                bytes: size,
            }),
        }
        offset += size;
    }
    if !board.parts.is_empty() && board.parts.iter().all(|p| p.pins.is_empty()) {
        return Err(invalid("no component pins were decoded; conversion aborted"));
    }
    if board.parts.is_empty() && board.vias.is_empty() && board.lines.is_empty() {
        return Err(ParseError::NoContent);
    }
    let image_relative = d.u32(0x24)? as usize;
    if image_relative != 0 {
        let images = d.section(image_relative + 0x20)?;
        let mut offset = 0;
        while offset < images.0.len() {
            let n = images.u32(offset + 11)? as usize;
            board.report.images.push(ImageReference {
                kind: images.bytes(offset, 1)?[0],
                index: images.bytes(offset + 1, 1)?[0],
                flags: images.bytes(offset + 2, 1)?[0],
                width: images.u32(offset + 3)?,
                height: images.u32(offset + 7)?,
                name: images.text(offset + 15, n)?,
            });
            offset += 15 + n;
        }
    }
    if let Some(marker) = crate::text::find(input, b"v6v6555v6v6") {
        let tail = &input[marker + 11..];
        let mut offset = 0;
        while let Some(sep) = crate::text::find(&tail[offset..], b"===") {
            let start = offset + sep + 3;
            let end = tail[start..]
                .iter()
                .position(|b| *b == b'\r' || *b == b'\n')
                .map_or(tail.len(), |n| start + n);
            let next = crate::text::find(&tail[end..], b"===").map_or(tail.len(), |n| end + n);
            board.report.sections.push(MetadataSection {
                name: decode_text(&tail[start..end]).into_owned(),
                text: decode_text(&tail[end..next]).into_owned(),
            });
            offset = next;
            if offset == tail.len() {
                break;
            }
        }
    }
    let readings = crate::formats::xzz::readings(input);
    board.report.readings = readings.readings.len();
    board.report.unreadable_readings = readings.unreadable;
    if !board.report.preserved_blocks.is_empty() {
        board.report.warnings.push(format!(
            "{} undocumented XZZ blocks retained in the embedded source; their meaning is not guessed.",
            board.report.preserved_blocks.len()
        ));
    }
    if !board.report.images.is_empty() {
        board.report.warnings.push(format!(
            "{} image references retained. The XZZ file supplies references, not the external image files.",
            board.report.images.len()
        ));
    }
    if !board.report.board_texts.is_empty() {
        board.report.warnings.push(format!("{} board annotations exported as GenCAD board text and retained as metadata with their position and layer.", board.report.board_texts.len()));
    }
    let unmapped: BTreeSet<_> =
        board.parts.iter().flat_map(|p| p.pins.iter()).map(|p| p.layer).filter(|l| *l > 16).collect();
    if !unmapped.is_empty() {
        board.report.warnings.push(format!("Pin layers {unmapped:?} are retained by number; their surface/through-hole meaning is undocumented."));
    }
    Ok(board)
}

fn clean(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c == '"' {
                '\''
            } else if c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect()
}
fn quote(text: &str) -> String {
    format!("\"{}\"", clean(text))
}
fn unique(text: String, used: &mut BTreeSet<String>) -> String {
    let mut name = text.clone();
    let mut n = 2;
    while !used.insert(name.to_lowercase()) {
        name = format!("{text}_{n}");
        n += 1;
    }
    name
}
fn layer(id: u32) -> String {
    match id {
        1 => "TOP".into(),
        16 => "BOTTOM".into(),
        17 => "SILKSCREEN_TOP".into(),
        _ => format!("LAYER_{id}"),
    }
}
fn pin_layer(p: &Pad, part: &Part) -> u32 {
    if p.layer == 0 {
        part.layer
    } else {
        p.layer
    }
}
fn pad_name(c: usize, p: usize) -> String {
    format!("PINPAD_{}_{}", c + 1, p + 1)
}
fn number(value: f64) -> String {
    let text = format!("{value:.8}");
    let s = text.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}
fn xy(p: Point) -> String {
    format!("{} {}", number(p.x), number(p.y))
}
fn geometry(out: &mut String, arc: &Arc, origin: Point) {
    let center = Point::new(arc.center.x - origin.x, arc.center.y - origin.y);
    if (arc.end - arc.start).abs() >= 360.0 - 1e-8 {
        let _ = writeln!(out, "CIRCLE {} {}", xy(center), number(arc.radius));
        return;
    }
    let at = |deg: f64| {
        Point::new(
            center.x + arc.radius * deg.to_radians().cos(),
            center.y + arc.radius * deg.to_radians().sin(),
        )
    };
    // GenCAD arcs run counter-clockwise. Keep both the major arc and the
    // wrap over 0 degrees; sorting the angles used to replace them by their complement.
    let _ = writeln!(out, "ARC {} {} {}", xy(at(arc.start)), xy(at(arc.end)), xy(center));
}
fn pad_geometry(out: &mut String, p: &Pad) {
    let (w, h) = (p.width, p.height);
    if p.rectangle {
        let _ =
            writeln!(out, "RECTANGLE {} {} {} {}", number(-w / 2.0), number(-h / 2.0), number(w), number(h));
    } else if w > 0.0 && h > 0.0 && w != h {
        let r = w.min(h) / 2.0;
        let half = (w - h).abs() / 2.0;
        let rot = |x: f64, y: f64| if w > h { Point::new(x, y) } else { Point::new(-y, x) };
        let _ = writeln!(out, "LINE {} {}", xy(rot(-half, r)), xy(rot(half, r)));
        let _ = writeln!(out, "LINE {} {}", xy(rot(half, -r)), xy(rot(-half, -r)));
        let _ = writeln!(out, "ARC {} {} {}", xy(rot(half, -r)), xy(rot(half, r)), xy(rot(half, 0.0)));
        let _ = writeln!(out, "ARC {} {} {}", xy(rot(-half, r)), xy(rot(-half, -r)), xy(rot(-half, 0.0)));
    } else {
        let _ = writeln!(out, "CIRCLE 0 0 {}", number(w.max(h) / 2.0));
    }
}

fn write(board: &mut Board, drawing: &str) -> Vec<u8> {
    let origin = board
        .lines
        .iter()
        .filter(|l| l.layer == 28)
        .flat_map(|l| [l.start, l.end])
        .chain(
            board
                .arcs
                .iter()
                .filter(|a| a.layer == 28)
                .map(|a| Point::new(a.center.x - a.radius, a.center.y - a.radius)),
        )
        .reduce(|m, p| Point::new(m.x.min(p.x), m.y.min(p.y)))
        .unwrap_or_default();
    let shift = |p: Point| Point::new(p.x - origin.x, p.y - origin.y);
    let mut used = BTreeSet::new();
    let names: Vec<_> = board
        .parts
        .iter()
        .enumerate()
        .map(|(c, p)| {
            unique(if p.name.is_empty() { format!("COMP_{}", c + 1) } else { clean(&p.name) }, &mut used)
        })
        .collect();
    let pin_names: Vec<Vec<String>> = board
        .parts
        .iter()
        .map(|part| {
            let mut used = BTreeSet::new();
            part.pins
                .iter()
                .enumerate()
                .map(|(p, pin)| {
                    unique(
                        if pin.name.is_empty() { (p + 1).to_string() } else { clean(&pin.name) },
                        &mut used,
                    )
                })
                .collect()
        })
        .collect();
    let mut ids: BTreeSet<_> = board.nets.keys().copied().map(Some).collect();
    let mut layers = BTreeSet::new();
    let mut nodes: BTreeMap<Option<u32>, Vec<(usize, usize)>> = BTreeMap::new();
    for (c, part) in board.parts.iter().enumerate() {
        layers.insert(part.layer);
        layers.extend(part.lines.iter().map(|l| l.layer));
        layers.extend(part.arcs.iter().map(|a| a.layer));
        layers.extend(part.labels.iter().map(|l| l.layer));
        for (p, pin) in part.pins.iter().enumerate() {
            layers.insert(pin_layer(pin, part));
            if pin.net.is_some() {
                ids.insert(pin.net);
                nodes.entry(pin.net).or_default().push((c, p));
            }
        }
    }
    for l in board.lines.iter().filter(|l| l.layer != 28) {
        layers.insert(l.layer);
        ids.insert(l.net);
    }
    for a in board.arcs.iter().filter(|a| a.layer != 28) {
        layers.insert(a.layer);
        ids.insert(a.net);
    }
    for v in &board.vias {
        layers.extend([v.from, v.to]);
        ids.insert(v.net);
    }
    used.clear();
    let nets: BTreeMap<_, _> = ids
        .into_iter()
        .map(|id| {
            let name = id
                .and_then(|i| board.nets.get(&i))
                .filter(|s| !s.is_empty())
                .map(|s| clean(s))
                .unwrap_or_else(|| id.map_or_else(|| "UNCONNECTED".into(), |i| format!("NET_{i}")));
            (id, unique(name, &mut used))
        })
        .collect();
    let signal = |id: Option<u32>| quote(&nets[&id]);
    layers.extend(board.report.board_texts.iter().map(|t| t.layer));
    layers.extend(board.lines.iter().map(|l| l.layer));
    layers.extend(board.arcs.iter().map(|a| a.layer));
    board.report.aliases = board
        .parts
        .iter()
        .enumerate()
        .map(|(c, part)| PartAlias {
            source: part.name.clone(),
            target: names[c].clone(),
            pins: part
                .pins
                .iter()
                .enumerate()
                .map(|(p, pin)| PinAlias { source: pin.name.clone(), target: pin_names[c][p].clone() })
                .collect(),
        })
        .collect();
    board.report.layers = layers.iter().copied().collect();
    let mut out = format!("$HEADER\nGENCAD 1.4\nUSER \"Avero XZZ converter\"\nDRAWING {}\nREVISION \"1\"\nUNITS THOU\nORIGIN 0 0\nINTERTRACK 0\n$ENDHEADER\n\n$BOARD\n", quote(drawing));
    for l in board.lines.iter().filter(|l| l.layer == 28) {
        let _ = writeln!(out, "LINE {} {}", xy(shift(l.start)), xy(shift(l.end)));
    }
    for a in board.arcs.iter().filter(|a| a.layer == 28) {
        geometry(&mut out, a, origin);
    }
    for text in &board.report.board_texts {
        let _ = writeln!(
            out,
            "TEXT {} {} {} 0 {} {} 0 0 0 0",
            xy(shift(Point::new(text.x, text.y))),
            number(text.size),
            number(text.rotation),
            layer(text.layer),
            quote(&text.text)
        );
    }
    out.push_str("$ENDBOARD\n\n$ARTWORKS\n$ENDARTWORKS\n\n$PADS\n");
    for (c, part) in board.parts.iter().enumerate() {
        for (p, pin) in part.pins.iter().enumerate() {
            let _ = writeln!(
                out,
                "PAD {} {} {}",
                pad_name(c, p),
                if pin.rectangle { "RECTANGULAR" } else { "ROUND" },
                number(pin.drill)
            );
            pad_geometry(&mut out, pin);
        }
    }
    for (v, via) in board.vias.iter().enumerate() {
        let _ = writeln!(
            out,
            "PAD VIAPAD_{} ROUND {}\nCIRCLE 0 0 {}",
            v + 1,
            number(via.drill),
            number(via.radius)
        );
    }
    out.push_str("$ENDPADS\n\n$PADSTACKS\n");
    for (c, part) in board.parts.iter().enumerate() {
        for (p, pin) in part.pins.iter().enumerate() {
            let _ = writeln!(
                out,
                "PADSTACK {0} {2}\nPAD {0} {1} 0 0",
                pad_name(c, p),
                layer(pin_layer(pin, part)),
                number(pin.drill)
            );
        }
    }
    for (v, via) in board.vias.iter().enumerate() {
        let _ = writeln!(out, "PADSTACK VIASTACK_{} {}", v + 1, number(via.drill));
        for id in layers.range(via.from.min(via.to)..=via.from.max(via.to)) {
            let _ = writeln!(out, "PAD VIAPAD_{} {} 0 0", v + 1, layer(*id));
        }
    }
    out.push_str("$ENDPADSTACKS\n\n$SHAPES\n");
    for (c, part) in board.parts.iter().enumerate() {
        let _ = writeln!(out, "SHAPE SHAPE_{}", c + 1);
        let angle = part.rotation.to_radians();
        let local = |pos: Point| {
            let (x, y) = (pos.x - part.pos.x, pos.y - part.pos.y);
            Point::new(x * angle.cos() + y * angle.sin(), -x * angle.sin() + y * angle.cos())
        };
        for line in &part.lines {
            let _ = writeln!(out, "LINE {} {}", xy(local(line.start)), xy(local(line.end)));
        }
        for a in &part.arcs {
            geometry(
                &mut out,
                &Arc {
                    center: local(a.center),
                    start: a.start - part.rotation,
                    end: a.end - part.rotation,
                    ..*a
                },
                Point::default(),
            );
        }
        for (p, pin) in part.pins.iter().enumerate() {
            let (x, y) = (pin.pos.x - part.pos.x, pin.pos.y - part.pos.y);
            let local = Point::new(x * angle.cos() + y * angle.sin(), -x * angle.sin() + y * angle.cos());
            let _ = writeln!(
                out,
                "PIN {} {} {} {} {} 0",
                quote(&pin_names[c][p]),
                pad_name(c, p),
                xy(local),
                layer(pin_layer(pin, part)),
                number(pin.rotation - part.rotation)
            );
        }
    }
    out.push_str("$ENDSHAPES\n\n$DEVICES\n");
    for (c, part) in board.parts.iter().enumerate() {
        let _ = writeln!(
            out,
            "DEVICE DEV_{}\nPART {}\nVALUE {}",
            c + 1,
            quote(&part.footprint),
            quote(&part.value)
        );
    }
    out.push_str("$ENDDEVICES\n\n$COMPONENTS\n");
    for (c, part) in board.parts.iter().enumerate() {
        let _ = writeln!(
            out,
            "COMPONENT {}\nDEVICE DEV_{}\nPLACE {}\nLAYER {}\nROTATION {}\nSHAPE SHAPE_{} 0 0\nVALUE {}",
            quote(&names[c]),
            c + 1,
            xy(shift(part.pos)),
            layer(part.layer),
            number(part.rotation),
            c + 1,
            quote(&part.value)
        );
        let angle = part.rotation.to_radians();
        for label in &part.labels {
            let (x, y) = (label.pos.x - part.pos.x, label.pos.y - part.pos.y);
            let pos = Point::new(x * angle.cos() + y * angle.sin(), -x * angle.sin() + y * angle.cos());
            let _ = writeln!(
                out,
                "TEXT {} {} {} 0 {} {} 0 0 0 0",
                xy(pos),
                number(label.size),
                number(label.rotation - part.rotation),
                layer(label.layer),
                quote(&label.text)
            );
        }
    }
    out.push_str("$ENDCOMPONENTS\n\n$SIGNALS\n");
    for id in nets.keys() {
        let _ = writeln!(out, "SIGNAL {}", signal(*id));
        for (c, p) in nodes.get(id).into_iter().flatten() {
            let _ = writeln!(out, "NODE {} {}", quote(&names[*c]), quote(&pin_names[*c][*p]));
        }
    }
    out.push_str("$ENDSIGNALS\n\n$LAYERS\n");
    for id in &layers {
        let _ = writeln!(out, "DEFINE {} \"XZZ layer {}\"", layer(*id), id);
    }
    out.push_str("$ENDLAYERS\n\n$TRACKS\n");
    for (t, l) in board.lines.iter().enumerate().filter(|(_, l)| l.layer != 28) {
        let _ = writeln!(out, "TRACK TRACE_{} {}", t + 1, number(l.width));
    }
    for (a, arc) in board.arcs.iter().enumerate().filter(|(_, a)| a.layer != 28) {
        let _ = writeln!(out, "TRACK ARC_{} {}", a + 1, number(arc.width));
    }
    out.push_str("$ENDTRACKS\n\n$ROUTES\n");
    for (t, l) in board.lines.iter().enumerate().filter(|(_, l)| l.layer != 28) {
        let _ = writeln!(
            out,
            "ROUTE {}\nTRACK TRACE_{}\nLAYER {}\nLINE {} {}",
            signal(l.net),
            t + 1,
            layer(l.layer),
            xy(shift(l.start)),
            xy(shift(l.end))
        );
    }
    for (a, arc) in board.arcs.iter().enumerate().filter(|(_, a)| a.layer != 28) {
        let _ = writeln!(out, "ROUTE {}\nTRACK ARC_{}\nLAYER {}", signal(arc.net), a + 1, layer(arc.layer));
        geometry(&mut out, arc, origin);
    }
    for (v, via) in board.vias.iter().enumerate() {
        let _ = writeln!(
            out,
            "ROUTE {}\nVIA VIASTACK_{} {} ALL {} VIA_{}",
            signal(via.net),
            v + 1,
            xy(shift(via.pos)),
            number(via.drill),
            v + 1
        );
    }
    out.push_str("$ENDROUTES\n");
    out.into_bytes()
}

/// Converts all readable XZZ components and their connectivity to GenCAD 1.4.
/// A malformed part aborts conversion rather than exporting an incomplete board.
pub fn xzz_to_gencad(input: &[u8], drawing: &str, key: Option<u64>) -> Result<Converted, ParseError> {
    let mut board = read(input, key.unwrap_or(DEFAULT_KEY))?;
    board.report.parts = board.parts.len();
    board.report.pins = board.parts.iter().map(|p| p.pins.len()).sum();
    board.report.traces = board.lines.iter().filter(|l| l.layer != 28).count();
    board.report.arcs = board.arcs.iter().filter(|a| a.layer != 28).count();
    board.report.vias = board.vias.len();
    board.report.outline_lines = board.lines.iter().filter(|l| l.layer == 28).count();
    board.report.outline_arcs = board.arcs.iter().filter(|a| a.layer == 28).count();
    let mut cad = write(&mut board, drawing);
    // Validate the regular GenCAD before retaining the source. Also account
    // for measurements that cannot be assigned, instead of calling them imported.
    let mut reopened = crate::parse(&cad, Some("converted.cad"))?;
    if reopened.parts.len() != board.report.parts
        || reopened.pins.len() != board.report.pins
        || reopened.test_points.len() != board.report.vias
    {
        return Err(invalid("component, pin or via count changed on GenCAD round trip"));
    }
    archive::attach_source(&mut reopened, input, &board.report);
    board.report.assigned_readings = reopened.readings.len();
    board.report.warnings.extend(reopened.warnings);
    archive::append(&mut cad, input, &board.report)?;
    Ok(Converted {
        cad,
        parts: board.parts.len(),
        pins: board.parts.iter().map(|p| p.pins.len()).sum(),
        traces: board.lines.iter().filter(|l| l.layer != 28).count(),
        vias: board.vias.len(),
        report: board.report,
    })
}
