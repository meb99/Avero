//! Structured Teboview records, ported from Pavel Kovalenko's MIT
//! eagleview/TeboBoard reader. No scanning for coincidental strings/offsets.
//! Every read and collection count is bounded. Unknown record families fail
//! explicitly instead of silently assigning a nearby pad to the wrong pin.
use crate::{
    builder::{RawBoard, RawPart, RawPin, RawTestPoint, RawTrace},
    model::*,
    ParseError,
};
use std::collections::HashSet;
const F: FormatId = FormatId::Tvw;
fn err(s: impl Into<String>) -> ParseError {
    ParseError::invalid(F, s)
}
struct Reader<'a> {
    b: &'a [u8],
    at: usize,
    budget: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ParseError> {
        let end = self.at.checked_add(n).ok_or_else(|| err("size overflow"))?;
        let v = self.b.get(self.at..end).ok_or_else(|| err(format!("truncated TVW at {}", self.at)))?;
        self.at = end;
        Ok(v)
    }
    fn skip(&mut self, n: usize) -> Result<(), ParseError> {
        self.take(n)?;
        Ok(())
    }
    fn byte(&mut self) -> Result<u8, ParseError> {
        Ok(self.take(1)?[0])
    }
    fn flag(&mut self) -> Result<bool, ParseError> {
        match self.byte()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(err("invalid boolean flag")),
        }
    }
    fn u32(&mut self) -> Result<u32, ParseError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn num(&mut self) -> Result<f64, ParseError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64 / 100.)
    }
    fn point(&mut self) -> Result<Point, ParseError> {
        Ok(Point::new(self.num()?, self.num()?))
    }
    fn float(&mut self) -> Result<f64, ParseError> {
        let v = f32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64;
        if v.is_finite() {
            Ok(v)
        } else {
            Err(err("invalid angle"))
        }
    }
    fn text(&mut self) -> Result<String, ParseError> {
        let n = self.byte()? as usize;
        Ok(encoding_rs::WINDOWS_1252.decode(self.take(n)?).0.into_owned())
    }
    fn expect(&mut self, n: u32) -> Result<(), ParseError> {
        let v = self.u32()?;
        if v == n {
            Ok(())
        } else {
            Err(err(format!("unsupported TVW record at {} (expected {n}, found {v})", self.at - 4)))
        }
    }
    fn count(&mut self, min: usize) -> Result<usize, ParseError> {
        let n = self.u32()? as usize;
        if n > self.budget || n > self.b.len().saturating_sub(self.at) / min.max(1) {
            return Err(err("invalid collection count"));
        }
        self.budget -= n;
        Ok(n)
    }
}
fn decode_string(raw: &str) -> String {
    raw.bytes()
        .enumerate()
        .map(|(i, c)| {
            let mut x = c as i16;
            match c {
                b'a'..=b'j' => {
                    x -= (i % 3 + 4) as i16;
                    if x < b'a' as i16 {
                        x += 10;
                    }
                    x = 154 - x;
                }
                b'k'..=b'z' => {
                    x -= (i % 10 + 5) as i16;
                    if x < b'k' as i16 {
                        x += 16;
                    }
                }
                b'A'..=b'Z' => {
                    x += (i % 10 + 5) as i16;
                    if x > b'Z' as i16 {
                        x -= 26;
                    }
                }
                b'0'..=b'9' => {
                    x += (i % 3 + 4) as i16;
                    if x > b'9' as i16 {
                        x -= 10;
                    }
                    x += 49;
                }
                _ => {}
            }
            x as u8 as char
        })
        .collect()
}
pub fn detect(buf: &[u8]) -> bool {
    let mut r = Reader { b: buf, at: 0, budget: 100 };
    r.text()
        .ok()
        .map(|s| decode_string(&s).to_ascii_uppercase())
        .is_some_and(|s| s.contains("TEBO") || s.contains("TVW"))
}
#[derive(Clone)]
struct Shape {
    w: f64,
    h: f64,
    angle: f64,
    round: bool,
}
#[derive(Clone)]
struct Pad {
    pos: Point,
    net: i32,
    shape: Shape,
    hole: bool,
}
struct Layer {
    name: String,
    kind: u32,
    pads: Vec<Pad>,
    lines: Vec<(i32, Point, Point, f64)>,
    holes: Vec<(i32, Point, f64)>,
}
fn shapes(r: &mut Reader) -> Result<Vec<Shape>, ParseError> {
    let end = r.count(1)?;
    if end == 0 {
        return Ok(vec![]);
    }
    if end < 10 {
        return Err(err("invalid D-code table"));
    }
    let mut out = Vec::new();
    for _ in 0..end - 10 {
        r.expect(1)?;
        let size = r.point()?;
        let kind = r.u32()?;
        let mut angle = 0.;
        match kind {
            0 => r.skip(8)?,
            1 | 3 => {
                angle = r.float()?;
                r.skip(4)?;
            }
            5 => {
                r.skip(4)?;
                r.text()?;
                r.skip(16)?;
                for _ in 0..r.count(4)? {
                    match r.u32()? {
                        2 => {
                            r.skip(12)?;
                            let n = r.count(8)?;
                            r.skip(n * 8)?;
                        }
                        5 => r.skip(32)?,
                        _ => return Err(err("unknown polygon pad subobject")),
                    }
                }
            }
            _ => return Err(err(format!("unsupported pad shape {kind}"))),
        }
        out.push(Shape { w: size.x.abs(), h: size.y.abs(), angle, round: kind == 0 || kind == 3 });
    }
    Ok(out)
}
fn read_lines(r: &mut Reader, layer: &mut Layer, shapes: &[Shape]) -> Result<(), ParseError> {
    let n = r.count(24)?;
    if n > 0 {
        r.expect(0)?;
    }
    for _ in 0..n {
        let net = r.u32()? as i32;
        let d = r.u32()?;
        let shape = shapes
            .get(d.checked_sub(10).ok_or_else(|| err("bad D-code"))? as usize)
            .ok_or_else(|| err("unknown line D-code"))?;
        let a = r.point()?;
        let b = r.point()?;
        layer.lines.push((net, a, b, shape.w));
    }
    Ok(())
}
fn read_arcs(r: &mut Reader, layer: &mut Layer, shapes: &[Shape]) -> Result<(), ParseError> {
    let n = r.count(28)?;
    if n > 0 {
        r.expect(0)?;
    }
    for _ in 0..n {
        let net = r.u32()? as i32;
        let d = r.u32()?;
        let width = shapes
            .get(d.checked_sub(10).ok_or_else(|| err("bad arc D-code"))? as usize)
            .ok_or_else(|| err("unknown arc D-code"))?
            .w;
        let c = r.point()?;
        let radius = r.num()?;
        let start = r.float()?;
        let sweep = r.float()?;
        let steps = (sweep.abs() / 7.5).ceil().clamp(1., 96.) as usize;
        let mut previous = None;
        for i in 0..=steps {
            let a = (start + sweep * i as f64 / steps as f64).to_radians();
            let p = Point::new(c.x + radius * a.cos(), c.y + radius * a.sin());
            if let Some(prev) = previous {
                layer.lines.push((net, prev, p, width));
            }
            previous = Some(p);
        }
    }
    Ok(())
}
fn surfaces(r: &mut Reader) -> Result<usize, ParseError> {
    let n = r.count(16)?;
    if n > 0 {
        r.expect(2)?;
    }
    for _ in 0..n {
        r.skip(4)?;
        let verts = r.count(8)?;
        r.skip(verts * 8 + 4)?;
        let holes = r.count(8)?;
        for _ in 0..holes {
            r.skip(4)?;
            let verts = r.count(8)?;
            r.skip(verts * 8)?;
        }
        if holes > 0 {
            r.skip(4)?;
        }
    }
    Ok(n)
}
fn layer(r: &mut Reader, areas: &mut usize) -> Result<Layer, ParseError> {
    let mut object = 0;
    for _ in 0..4 {
        object = r.u32()?;
        if object != 0 {
            break;
        }
    }
    if object != 1 && object != 3 {
        return Err(err(format!("unknown layer object {object}")));
    }
    r.expect(2)?;
    r.expect(1)?;
    let name = r.text()?;
    r.text()?;
    r.text()?;
    let kind = r.u32()?;
    r.skip(8)?;
    let mut l = Layer { name, kind, pads: vec![], lines: vec![], holes: vec![] };
    if object == 1 {
        r.expect(0)?;
        r.expect(0)?;
        let n = r.count(29)?;
        if n == 0 {
            return Err(err("missing drill tools"));
        }
        let mut tools = Vec::new();
        for _ in 0..n - 1 {
            r.skip(2)?;
            let size = r.num()?;
            r.skip(23)?;
            tools.push(size);
        }
        r.skip(1)?;
        let n = r.count(17)?;
        r.skip(20)?;
        for _ in 0..n {
            let typ = r.byte()?;
            let net = r.u32()? as i32;
            let tool = r.u32()?;
            let size = *tools
                .get(tool.checked_sub(1).ok_or_else(|| err("invalid tool"))? as usize)
                .ok_or_else(|| err("missing drill tool"))?;
            let p = r.point()?;
            match typ {
                8 => l.holes.push((net, p, size)),
                10 | 11 => {
                    r.skip(12)?;
                }
                _ => return Err(err("unsupported drill object")),
            }
        }
        return Ok(l);
    }
    let s = shapes(r)?;
    if !s.is_empty() {
        let order = r.u32()?;
        if order != 1 && order != 2 {
            return Err(err("unsupported layer data order"));
        }
        r.expect(0)?;
        r.expect(1)?;
        let n = r.count(19)?;
        if n > 0 {
            r.expect(2)?;
        }
        for _ in 0..n {
            let net = r.u32()? as i32;
            let code = r.u32()?;
            let pos = r.point()?;
            let exposed = r.flag()?;
            let copper = r.flag()?;
            let tp = r.byte()?;
            let mut hole = false;
            let shape = s
                .get(code.checked_sub(10).ok_or_else(|| err("invalid pad D-code"))? as usize)
                .ok_or_else(|| err("missing pad shape"))?
                .clone();
            if copper {
                let something = r.flag()?;
                if tp == 1 {
                    r.skip(12)?;
                }
                if exposed || something {
                    r.skip(16)?;
                }
                hole = r.flag()?;
                r.skip(1)?;
                if hole {
                    r.skip(16)?;
                }
            }
            l.pads.push(Pad { pos, net, shape, hole });
        }
        read_lines(r, &mut l, &s)?;
        read_arcs(r, &mut l, &s)?;
        *areas += surfaces(r)?;
        if order == 2 {
            r.skip(16)?;
            read_lines(r, &mut l, &s)?;
            read_arcs(r, &mut l, &s)?;
            r.expect(0)?;
        }
    }
    let n = r.count(40)?;
    r.skip(4)?;
    for _ in 0..n {
        r.text()?;
        r.skip(39)?;
    }
    if n > 0 {
        r.expect(0)?;
    }
    r.expect(7)?;
    let n = r.count(42)?;
    r.skip(n * 42)?;
    r.expect(0)?;
    r.expect(4)?;
    for _ in 0..2 {
        let n = r.count(54)?;
        r.skip(4 + n * 54)?;
    }
    let n = r.count(9)?;
    let param = r.u32()?;
    r.skip(n * 9)?;
    if param == 1 {
        r.skip(12)?;
    }
    Ok(l)
}
fn fixture_data(r: &mut Reader) -> Result<(), ParseError> {
    r.skip(31)?;
    let n = r.count(1)?;
    for _ in 0..n {
        if r.flag()? {
            r.skip(28)?;
        }
    }
    let n = r.count(17)?;
    r.skip(20 + n * 17)?;
    Ok(())
}
fn probe_registry(r: &mut Reader) -> Result<(), ParseError> {
    r.expect(0)?;
    r.expect(0)?;
    r.expect(4)?;
    r.text()?;
    r.skip(4)?;
    let packs = r.count(4)?;
    for _ in 0..packs {
        let count = r.count(122)?;
        for _ in 0..count {
            r.skip(5)?;
            r.text()?;
            r.skip(60)?;
            if r.flag()? {
                fixture_data(r)?;
                r.skip(16)?;
                let n = r.count(44)?;
                r.skip(n * 44)?;
            }
            r.skip(60)?;
        }
    }
    Ok(())
}
fn fixtures(r: &mut Reader) -> Result<(), ParseError> {
    r.expect(0)?;
    r.expect(7874)?;
    for _ in 0..8 {
        r.text()?;
    }
    for _ in 0..2 {
        r.expect(3)?;
        r.text()?;
        r.expect(0)?;
        let n = r.count(2)?;
        for _ in 0..n {
            r.text()?;
            r.text()?;
            r.skip(2)?;
            fixture_data(r)?;
        }
        r.skip(8)?;
    }
    Ok(())
}
pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let mut r = Reader { b: buf, at: 0, budget: 8_000_000 };
    let title = decode_string(&r.text()?);
    if title.trim().is_empty() {
        return Err(err("empty TVW header"));
    }
    r.expect(1)?;
    r.text()?;
    r.skip(1)?;
    r.text()?;
    r.skip(15)?;
    let n = r.count(24)?;
    if n > 128 {
        return Err(err("too many layers"));
    }
    let mut layers = Vec::new();
    let mut areas = 0;
    for _ in 0..n {
        layers.push(layer(&mut r, &mut areas)?);
    }
    r.skip(16)?;
    let n = r.count(1)?;
    if r.u32()? as usize != n {
        return Err(err("net list count mismatch"));
    }
    let mut nets = Vec::new();
    for _ in 0..n {
        nets.push(r.text()?);
    }
    probe_registry(&mut r)?;
    fixtures(&mut r)?;
    r.skip(68)?;
    let mut board = RawBoard::new(F);
    let mut used = HashSet::new();
    let mut unmatched = 0;
    let net_name = |i: i32| -> Result<String, ParseError> {
        if i < 0 {
            return Ok(String::new());
        }
        nets.get(i as usize).cloned().ok_or_else(|| err(format!("invalid net ordinal {i}")))
    };
    let count = r.count(55)?;
    r.skip(4)?;
    for _ in 0..count {
        let name = r.text()?;
        let min = r.point()?;
        let max = r.point()?;
        r.point()?;
        r.skip(20)?;
        let extra = r.flag()?;
        let value = r.text()?;
        r.text()?;
        r.text()?;
        let desc = r.text()?;
        if extra {
            r.text()?;
            r.skip(4)?;
        }
        let count = r.count(17)?;
        let li = r.u32()? as usize;
        r.expect(0)?;
        let layer = layers.get(li).ok_or_else(|| err("component refers to a missing layer"))?;
        let side = match layer.kind {
            2 => Side::Bottom,
            _ => Side::Top,
        };
        let mut p = RawPart::new(name, side, Mount::Smd);
        p.outline = Some(vec![min, Point::new(max.x, min.y), max, Point::new(min.x, max.y), min]);
        p.device = (!value.is_empty() || !desc.is_empty()).then(|| format!("{value} {desc}").trim().into());
        for _ in 0..count {
            let handle = r.u32()?;
            r.expect(0)?;
            let id = r.u32()?;
            let name = r.text()?;
            r.expect(0)?;
            let pi = handle as usize / 8;
            let Some(pad) = layer.pads.get(pi).filter(|_| handle % 8 == 0) else {
                unmatched += 1;
                continue;
            };
            if !used.insert((li, pi)) {
                return Err(err("two component pins claim the same pad"));
            }
            if pad.hole {
                p.mount = Mount::ThroughHole;
            }
            let s = &pad.shape;
            p.pins.push(RawPin {
                pos: pad.pos,
                net: net_name(pad.net)?,
                number: Some(id.to_string()),
                name: (!name.is_empty()).then_some(name),
                radius: Some(s.w.max(s.h) / 2.),
                side: Some(if pad.hole { Side::Both } else { side }),
                pad: Some(PadShape { w: s.w, h: s.h, angle: s.angle, round: s.round }),
                ..Default::default()
            });
        }
        board.parts.push(p);
    }
    for (li, l) in layers.iter().enumerate() {
        let side = match l.kind {
            1 => Side::Top,
            2 => Side::Bottom,
            _ => Side::Both,
        };
        for (net, a, b, width) in &l.lines {
            if l.kind == 0 || l.kind == 12 {
                board.outline_segments.push((*a, *b));
            } else if [1, 2, 3, 4].contains(&l.kind) {
                board.traces.push(RawTrace {
                    from: *a,
                    to: *b,
                    width: *width,
                    side,
                    layer: l.name.clone(),
                    net: net_name(*net)?,
                });
            }
        }
        for (pi, pad) in l.pads.iter().enumerate() {
            if !used.contains(&(li, pi)) && [1, 2, 3, 4].contains(&l.kind) {
                board.test_points.push(RawTestPoint {
                    kind: if pad.hole { TestPointKind::Via } else { TestPointKind::Nail },
                    pos: pad.pos,
                    side,
                    net: net_name(pad.net)?,
                    probe: None,
                    radius: Some(pad.shape.w.max(pad.shape.h) / 2.),
                    name: None,
                });
            }
        }
        for (net, pos, size) in &l.holes {
            board.test_points.push(RawTestPoint {
                kind: TestPointKind::Via,
                pos: *pos,
                side: Side::Both,
                net: net_name(*net)?,
                probe: None,
                radius: Some(*size / 2.),
                name: None,
            });
        }
    }
    if unmatched > 0 {
        board.warn(format!("{unmatched} pin handles cannot be assigned to a pad in this TVW variant; no guessed assignments were made."));
    }
    if areas > 0 {
        board.warn(format!("{areas} filled copper areas are not drawn (tracks and pads are imported)."));
    }
    if r.at < buf.len() {
        board.warn("Footprint templates and trailing manufacturing metadata are not rendered; placed component bounds are used.");
    }
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(Vec<u8>);
    impl Fixture {
        fn n(&mut self, n: u32) {
            self.0.extend(n.to_le_bytes());
        }
        fn text(&mut self, s: &str) {
            self.0.push(s.len() as u8);
            self.0.extend(s.as_bytes());
        }
        fn zero(&mut self, n: usize) {
            self.0.resize(self.0.len() + n, 0);
        }
        fn point(&mut self, x: i32, y: i32) {
            self.n((x * 100) as u32);
            self.n((y * 100) as u32);
        }
        fn layer(&mut self, name: &str, kind: u32, x: i32) {
            for n in [3, 2, 1] {
                self.n(n);
            }
            self.text(name);
            self.text("");
            self.text("");
            self.n(kind);
            self.zero(8);
            // D-code 10: a rectangular 20 x 40 mil copper pad.
            self.n(11);
            self.n(1);
            self.point(20, 40);
            self.n(1);
            self.zero(8);
            for n in [1, 0, 1, 1, 2, 0, 10] {
                self.n(n);
            }
            self.point(x, 80);
            self.zero(3);
            self.n(1);
            self.n(0);
            self.n(0);
            self.n(10);
            self.point(x, 80);
            self.point(x + 50, 80);
            self.n(0);
            self.n(0); // arcs, copper surfaces
            self.n(0);
            self.n(0);
            self.n(7);
            self.n(0);
            self.n(0);
            self.n(4);
            for _ in 0..2 {
                self.n(0);
                self.n(0);
            }
            self.n(0);
            self.n(0);
        }
        fn part(&mut self, name: &str, layer: u32, x: i32) {
            self.text(name);
            self.point(x - 20, 50);
            self.point(x + 20, 110);
            self.point(x, 80);
            self.zero(21);
            self.text("IC");
            self.text("");
            self.text("");
            self.text("test");
            self.n(1);
            self.n(layer);
            self.n(0);
            for n in [0, 0, 1] {
                self.n(n);
            }
            self.text("VIN");
            self.n(0);
        }
    }
    #[test]
    fn structured_top_and_bottom_layers_keep_pad_handles_and_nets() {
        let mut f = Fixture(Vec::new());
        f.text("TEBO");
        f.n(1);
        f.text("");
        f.zero(1);
        f.text("");
        f.zero(15);
        f.n(2);
        f.layer("Top", 1, 100);
        f.layer("Bottom", 2, 500);
        f.zero(16);
        f.n(1);
        f.n(1);
        f.text("VCC");
        for n in [0, 0, 4] {
            f.n(n);
        }
        f.text("");
        f.n(0);
        f.n(0);
        f.n(0);
        f.n(7874);
        for _ in 0..8 {
            f.text("");
        }
        for _ in 0..2 {
            f.n(3);
            f.text("");
            f.n(0);
            f.n(0);
            f.zero(8);
        }
        f.zero(68);
        f.n(2);
        f.n(0);
        f.part("U1", 0, 100);
        f.part("U2", 1, 500);
        let b = crate::parse(&f.0, Some("layers.tvw")).unwrap();
        assert_eq!(b.pins.len(), 2);
        assert_eq!(b.traces.len(), 2);
        assert_eq!(b.layers.len(), 2);
        assert_eq!(b.parts[1].side, Side::Bottom);
        assert_eq!(b.pins[1].x, 500.);
        assert_eq!(b.pins[0].number, "1");
        assert_eq!(b.pins[0].pad.unwrap().h, 40.);
        assert_eq!(b.nets[b.pins[1].net as usize].name, "VCC");
        assert_eq!(b.pins[1].name.as_deref(), Some("VIN"));
    }
    #[test]
    fn every_truncation_fails_cleanly() {
        for n in 0..200 {
            assert!(parse(&vec![0; n]).is_err());
        }
    }
    #[test]
    fn forged_count_is_bounded() {
        let mut r = Reader { b: &u32::MAX.to_le_bytes(), at: 0, budget: 10 };
        assert!(r.count(1).is_err());
    }
}
