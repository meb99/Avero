//! Native XZZ → GenCAD conversion. No executable, shell or temporary input is needed.
//!
//! Uses the independently documented XZZ block layout and Avero's existing DES
//! implementation. Keeps copper routing and pad geometry outside the normalized
//! board model, which intentionally does not represent every source detail.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use crate::formats::xzz::{des_decrypt, detect};
use crate::model::{FormatId, Point};
use crate::text::decode;
use crate::{ParseError, MAX_FILE_SIZE};

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
        Ok(decode(b.split(|b| *b == 0).next().unwrap_or_default()).into_owned())
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
}
#[derive(Debug)]
struct Via {
    pos: Point,
    radius: f64,
    from: u32,
    to: u32,
    net: Option<u32>,
}
#[derive(Default)]
struct Board {
    parts: Vec<Part>,
    lines: Vec<Line>,
    arcs: Vec<Arc>,
    vias: Vec<Via>,
    nets: BTreeMap<u32, String>,
}

fn net(id: u32, names: &BTreeMap<u32, String>) -> Option<u32> {
    (id != u32::MAX && !names.get(&id).is_some_and(|s| s.eq_ignore_ascii_case("NC"))).then_some(id)
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
            6 => labels.push(sub.text(30, sub.u32(26)? as usize)?),
            9 => pins.push(pin(sub, names)?),
            _ => {}
        }
        offset += size;
    }
    if labels.first().is_none_or(String::is_empty) {
        return Err(invalid("component has no reference"));
    }
    let layer = if pins.iter().any(|p| p.layer == 16) && !pins.iter().any(|p| p.layer == 1) { 16 } else { 1 };
    Ok(Part {
        name: labels.remove(0),
        value: labels.into_iter().next().unwrap_or_default(),
        footprint,
        pos: d.point(8)?,
        rotation: d.coordinate(16)?,
        layer,
        pins,
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
    let main = d.section(if main_relative == 0 { 0x40 } else { main_relative + 0x20 })?;
    let net_relative = d.u32(0x28)? as usize;
    let mut board = Board::default();
    if net_relative != 0 {
        let nets = d.section(net_relative + 0x20)?;
        let mut offset = 0;
        while offset < nets.0.len() {
            let size = nets.u32(offset)? as usize;
            if size < 8 {
                return Err(invalid("invalid net record"));
            }
            board.nets.insert(nets.u32(offset + 4)?, nets.text(offset + 8, size - 8)?);
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
        match kind {
            1 => board.arcs.push(Arc {
                layer: body.u32(0)?,
                center: body.point(4)?,
                radius: body.coordinate(12)?.abs(),
                start: body.coordinate(16)?,
                end: body.coordinate(20)?,
                width: body.coordinate(24)?.abs(),
            }),
            2 => board.vias.push(Via {
                pos: body.point(0)?,
                radius: body.coordinate(8)?.abs(),
                from: body.u32(16)?,
                to: body.u32(20)?,
                net: net(body.u32(24)?, &board.nets),
            }),
            5 => board.lines.push(Line {
                layer: body.u32(0)?,
                start: body.point(4)?,
                end: body.point(12)?,
                width: body.coordinate(20)?.abs(),
                net: net(body.u32(24)?, &board.nets),
            }),
            7 => {
                let decoded = des_decrypt(body.0, key);
                let p = part(&decoded, &board.nets).or_else(|_| part(body.0, &board.nets)).map_err(|e| {
                    invalid(format!("component {} could not be decoded: {e}", board.parts.len() + 1))
                })?;
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
                    }],
                });
            }
            _ => {}
        }
        offset += size;
    }
    if !board.parts.is_empty() && board.parts.iter().all(|p| p.pins.is_empty()) {
        return Err(invalid("no component pins were decoded; conversion aborted"));
    }
    if board.parts.is_empty() && board.vias.is_empty() && board.lines.is_empty() {
        return Err(ParseError::NoContent);
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
    while !used.insert(name.clone()) {
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
    let (mut start, mut end) = (arc.start.min(arc.end), arc.start.max(arc.end));
    if end - start > 180.0 {
        start += 360.0;
        std::mem::swap(&mut start, &mut end);
    }
    let at = |deg: f64| {
        Point::new(
            center.x + arc.radius * deg.to_radians().cos(),
            center.y + arc.radius * deg.to_radians().sin(),
        )
    };
    let _ = writeln!(out, "ARC {} {} {}", xy(at(start)), xy(at(end)), xy(center));
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

fn write(board: &Board, drawing: &str) -> Vec<u8> {
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
        ids.insert(None);
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
    let mut out = format!("$HEADER\nGENCAD 1.4\nUSER \"Avero XZZ converter\"\nDRAWING {}\nREVISION \"1\"\nUNITS THOU\nORIGIN 0 0\nINTERTRACK 0\n$ENDHEADER\n\n$BOARD\n", quote(drawing));
    for l in board.lines.iter().filter(|l| l.layer == 28) {
        let _ = writeln!(out, "LINE {} {}", xy(shift(l.start)), xy(shift(l.end)));
    }
    for a in board.arcs.iter().filter(|a| a.layer == 28) {
        geometry(&mut out, a, origin);
    }
    out.push_str("$ENDBOARD\n\n$PADS\n");
    for (c, part) in board.parts.iter().enumerate() {
        for (p, pin) in part.pins.iter().enumerate() {
            let _ = writeln!(
                out,
                "PAD {} {} 0",
                pad_name(c, p),
                if pin.rectangle { "RECTANGULAR" } else { "ROUND" }
            );
            pad_geometry(&mut out, pin);
        }
    }
    for (v, via) in board.vias.iter().enumerate() {
        let _ = writeln!(out, "PAD VIAPAD_{} ROUND 0\nCIRCLE 0 0 {}", v + 1, number(via.radius));
    }
    out.push_str("$ENDPADS\n\n$PADSTACKS\n");
    for (c, part) in board.parts.iter().enumerate() {
        for (p, pin) in part.pins.iter().enumerate() {
            let _ =
                writeln!(out, "PADSTACK {0} 0\nPAD {0} {1} 0 0", pad_name(c, p), layer(pin_layer(pin, part)));
        }
    }
    for (v, via) in board.vias.iter().enumerate() {
        let _ = writeln!(out, "PADSTACK VIASTACK_{0} 0\nPAD VIAPAD_{0} {1} 0 0", v + 1, layer(via.from));
        if via.from != via.to {
            let _ = writeln!(out, "PAD VIAPAD_{} {} 0 0", v + 1, layer(via.to));
        }
    }
    out.push_str("$ENDPADSTACKS\n\n$SHAPES\n");
    for (c, part) in board.parts.iter().enumerate() {
        let _ = writeln!(out, "SHAPE SHAPE_{}", c + 1);
        let angle = part.rotation.to_radians();
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
                number(-part.rotation)
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
    }
    out.push_str("$ENDCOMPONENTS\n\n$SIGNALS\n");
    for id in nets.keys() {
        let _ = writeln!(out, "SIGNAL {}", signal(*id));
        for (c, p) in nodes.get(id).into_iter().flatten() {
            let _ = writeln!(out, "NODE {} {}", quote(&names[*c]), quote(&pin_names[*c][*p]));
        }
    }
    out.push_str("$ENDSIGNALS\n\n$LAYERS\n");
    for id in layers {
        let _ = writeln!(out, "DEFINE {} \"XZZ layer {}\"", layer(id), id);
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
        let _ = writeln!(out, "ROUTE {}\nTRACK ARC_{}\nLAYER {}", signal(None), a + 1, layer(arc.layer));
        geometry(&mut out, arc, origin);
    }
    for (v, via) in board.vias.iter().enumerate() {
        let _ = writeln!(
            out,
            "ROUTE {}\nVIA VIASTACK_{} {} ALL 0 VIA_{}",
            signal(via.net),
            v + 1,
            xy(shift(via.pos)),
            v + 1
        );
    }
    out.push_str("$ENDROUTES\n");
    out.into_bytes()
}

/// Converts all readable XZZ components and their connectivity to GenCAD 1.4.
/// A malformed part aborts conversion rather than exporting an incomplete board.
pub fn xzz_to_gencad(input: &[u8], drawing: &str, key: Option<u64>) -> Result<Converted, ParseError> {
    let board = read(input, key.unwrap_or(DEFAULT_KEY))?;
    Ok(Converted {
        cad: write(&board, drawing),
        parts: board.parts.len(),
        pins: board.parts.iter().map(|p| p.pins.len()).sum(),
        traces: board.lines.iter().filter(|l| l.layer != 28).count(),
        vias: board.vias.len(),
    })
}
