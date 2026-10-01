//! GenCAD 1.4, the open CAD-to-test exchange format.
//!
//! Only what a boardview needs is read: units, board outline, pads and
//! padstacks (for pad size and side), shapes (pin positions and body outline),
//! components (placement), devices (value / part number), signals (nets) and
//! routes (tracks and vias).

use std::collections::{HashMap, HashSet};
use std::f64::consts::{PI, TAU};

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint, RawTrace};
use crate::infer::{self, Placement};
use crate::model::{FormatId, Mount, Point, Side, TestPointKind};
use crate::text::{contains, lines, trim, Fields};
use crate::ParseError;

pub fn detect(buf: &[u8]) -> bool {
    contains(buf, b"GENCAD") && contains(buf, b"$HEADER")
}

#[derive(Clone, Copy, PartialEq)]
enum Section {
    None,
    Header,
    Board,
    Pads,
    Padstacks,
    Shapes,
    Components,
    Devices,
    Signals,
    Tracks,
    Routes,
    Other,
}

#[derive(Default)]
struct Pad {
    radius: Option<f64>,
    drilled: bool,
}

#[derive(Default)]
struct Padstack {
    radius: Option<f64>,
    drilled: bool,
    top: bool,
    bottom: bool,
}

impl Padstack {
    fn side(&self) -> Option<Side> {
        match (self.top, self.bottom) {
            (true, true) => Some(Side::Both),
            (true, false) => Some(Side::Top),
            (false, true) => Some(Side::Bottom),
            (false, false) => None,
        }
    }
}

struct ShapePin {
    name: String,
    pad: String,
    pos: Point,
}

#[derive(Default)]
struct Shape {
    pins: Vec<ShapePin>,
    insert: Option<String>,
    outline: Vec<(Point, Point)>,
}

struct Component {
    name: String,
    place: Point,
    side: Side,
    rotation: f64,
    shape: Option<ShapeRef>,
    device: Option<String>,
}

struct ShapeRef {
    name: String,
    mirror_x: bool,
    mirror_y: bool,
    flip: bool,
}

#[derive(Default)]
struct Device {
    part: Option<String>,
    value: Option<String>,
}

/// A route segment before its layer is known to be top, inner or bottom.
struct Track {
    from: Point,
    to: Point,
    width: f64,
    layer: String,
    net: String,
}

struct Parser {
    scale: f64,
    /// Units given as INCH; some converters write mils anyway.
    inch: bool,
    /// Ignore UNITS and read mils.
    force_mils: bool,
    section: Section,
    outline: Vec<(Point, Point)>,
    pads: HashMap<String, Pad>,
    padstacks: HashMap<String, Padstack>,
    shapes: HashMap<String, Shape>,
    components: Vec<Component>,
    devices: HashMap<String, Device>,
    signals: HashMap<(String, String), String>,
    vias: Vec<(String, Point)>,
    track_widths: HashMap<String, f64>,
    tracks: Vec<Track>,
    /// Width and layer of the route being read.
    width: f64,
    layer: String,
    current: Option<String>,
}

/// Boards larger than this (100 inch) only come from misread units.
const MAX_EXTENT_MILS: f64 = 100_000.0;

pub fn parse(buf: &[u8]) -> Result<RawBoard, ParseError> {
    let p = read(buf, false);
    if p.components.is_empty() {
        return Err(ParseError::invalid(FormatId::GenCad, "no $COMPONENTS found"));
    }
    if p.inch && p.extent() > MAX_EXTENT_MILS {
        let mut board = read(buf, true).finish();
        board.warn("UNITS says INCH but the coordinates are mils; read as mils");
        return Ok(board);
    }
    Ok(p.finish())
}

fn read(buf: &[u8], force_mils: bool) -> Parser {
    let mut p = Parser {
        scale: 1.0,
        inch: false,
        force_mils,
        section: Section::None,
        outline: Vec::new(),
        pads: HashMap::new(),
        padstacks: HashMap::new(),
        shapes: HashMap::new(),
        components: Vec::new(),
        devices: HashMap::new(),
        signals: HashMap::new(),
        vias: Vec::new(),
        track_widths: HashMap::new(),
        tracks: Vec::new(),
        width: 0.0,
        layer: String::new(),
        current: None,
    };
    for line in lines(buf) {
        p.line(trim(line));
    }
    p
}

/// Net names are often quoted after SIGNAL and ROUTE.
fn unquote(s: String) -> String {
    match s.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
        Some(inner) => inner.to_string(),
        None => s,
    }
}

impl Parser {
    /// Largest side of what was read, in mils.
    fn extent(&self) -> f64 {
        let mut b = crate::model::Bounds::EMPTY;
        for (a, c) in &self.outline {
            b.include(*a);
            b.include(*c);
        }
        for c in &self.components {
            b.include(c.place);
        }
        if b.is_empty() {
            return 0.0;
        }
        (b.max_x - b.min_x).max(b.max_y - b.min_y)
    }

    fn line(&mut self, line: &[u8]) {
        if line.is_empty() {
            return;
        }
        if line[0] == b'$' {
            self.current = None;
            self.section = match line {
                b"$HEADER" => Section::Header,
                b"$BOARD" => Section::Board,
                b"$PADS" => Section::Pads,
                b"$PADSTACKS" => Section::Padstacks,
                b"$SHAPES" => Section::Shapes,
                b"$COMPONENTS" => Section::Components,
                b"$DEVICES" => Section::Devices,
                b"$SIGNALS" => Section::Signals,
                b"$TRACKS" => Section::Tracks,
                b"$ROUTES" => Section::Routes,
                _ if line.starts_with(b"$END") => Section::None,
                _ => Section::Other,
            };
            return;
        }

        let mut f = Fields::new(line);
        let Some(keyword) = f.raw() else { return };
        match self.section {
            Section::Header if keyword == b"UNITS" => self.units(&mut f),
            Section::Board => {
                if let Some(segments) = self.geometry(keyword, &mut f) {
                    self.outline.extend(segments);
                }
            }
            Section::Pads => self.pad_line(keyword, &mut f),
            Section::Padstacks => self.padstack_line(keyword, &mut f),
            Section::Shapes => self.shape_line(keyword, &mut f),
            Section::Components => self.component_line(keyword, &mut f),
            Section::Devices => self.device_line(keyword, &mut f),
            Section::Signals => match keyword {
                b"SIGNAL" => self.current = Some(unquote(f.rest_string())),
                b"NODE" => {
                    if let (Some(net), Some(comp), Some(pin)) =
                        (self.current.clone(), f.quoted_or_plain(), f.quoted_or_plain())
                    {
                        self.signals.insert((comp, pin), net);
                    }
                }
                _ => {}
            },
            Section::Tracks => {
                if keyword == b"TRACK" {
                    if let (Some(name), Some(w)) = (f.quoted_or_plain(), self.num(&mut f)) {
                        self.track_widths.insert(name, w);
                    }
                }
            }
            Section::Routes => match keyword {
                b"ROUTE" => {
                    self.current = Some(unquote(f.rest_string()));
                    self.width = 0.0;
                }
                b"TRACK" => {
                    let name = f.quoted_or_plain().unwrap_or_default();
                    self.width = self.track_widths.get(&name).copied().unwrap_or(0.0);
                }
                b"LAYER" => self.layer = f.string().unwrap_or_default().to_ascii_uppercase(),
                b"LINE" | b"ARC" => {
                    if let (Some(net), Some(segments)) =
                        (self.current.clone(), self.geometry(keyword, &mut f))
                    {
                        for (from, to) in segments {
                            self.tracks.push(Track {
                                from,
                                to,
                                width: self.width,
                                layer: self.layer.clone(),
                                net: net.clone(),
                            });
                        }
                    }
                }
                b"VIA" => {
                    let _padstack = f.quoted_or_plain();
                    if let (Some(net), Some(pos)) = (self.current.clone(), self.xy(&mut f)) {
                        self.vias.push((net, pos));
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }

    fn units(&mut self, f: &mut Fields<'_>) {
        let unit = f.string().unwrap_or_default().to_ascii_uppercase();
        self.inch = unit == "INCH";
        if self.force_mils {
            self.scale = 1.0;
            return;
        }
        let per = f.float().filter(|v| *v > 0.0);
        self.scale = match (unit.as_str(), per) {
            ("INCH", _) => 1000.0,
            ("THOU" | "MIL", _) => 1.0,
            ("MM", _) => 1000.0 / 25.4,
            ("MM100", _) => 1000.0 / 2540.0,
            ("USER", Some(n)) => 1000.0 / n,
            ("USERCM", Some(n)) => 10000.0 / 25.4 / n,
            ("USERMM", Some(n)) => 1000.0 / 25.4 / n,
            _ => 1.0,
        };
    }

    fn num(&self, f: &mut Fields<'_>) -> Option<f64> {
        f.float().map(|v| v * self.scale)
    }

    fn xy(&self, f: &mut Fields<'_>) -> Option<Point> {
        Some(Point::new(self.num(f)?, self.num(f)?))
    }

    /// Reads LINE / ARC / CIRCLE / RECTANGLE as outline segments.
    fn geometry(&self, keyword: &[u8], f: &mut Fields<'_>) -> Option<Vec<(Point, Point)>> {
        match keyword {
            b"LINE" => Some(vec![(self.xy(f)?, self.xy(f)?)]),
            b"ARC" => {
                let (start, end, center) = (self.xy(f)?, self.xy(f)?, self.xy(f)?);
                Some(arc(start, end, center))
            }
            b"CIRCLE" => {
                let (c, r) = (self.xy(f)?, self.num(f)?);
                let start = Point::new(c.x + r, c.y);
                Some(arc(start, start, c))
            }
            b"RECTANGLE" => {
                let (o, w, h) = (self.xy(f)?, self.num(f)?, self.num(f)?);
                let p = [o, Point::new(o.x + w, o.y), Point::new(o.x + w, o.y + h), Point::new(o.x, o.y + h)];
                Some((0..4).map(|i| (p[i], p[(i + 1) % 4])).collect())
            }
            _ => None,
        }
    }

    fn pad_line(&mut self, keyword: &[u8], f: &mut Fields<'_>) {
        if keyword == b"PAD" {
            let name = f.quoted_or_plain().unwrap_or_default();
            let _shape = f.string();
            let drilled = f.float().is_some_and(|d| d > 0.0);
            self.pads.insert(name.clone(), Pad { radius: None, drilled });
            self.current = Some(name);
            return;
        }
        let Some(name) = self.current.clone() else {
            return;
        };
        let size = match keyword {
            b"CIRCLE" => {
                let _center = self.xy(f);
                self.num(f)
            }
            b"RECTANGLE" => {
                let _origin = self.xy(f);
                match (self.num(f), self.num(f)) {
                    (Some(w), Some(h)) => Some(w.abs().min(h.abs()) / 2.0),
                    _ => None,
                }
            }
            _ => None,
        };
        if let (Some(r), Some(pad)) = (size, self.pads.get_mut(&name)) {
            pad.radius = Some(pad.radius.map_or(r, |old| old.max(r)));
        }
    }

    fn padstack_line(&mut self, keyword: &[u8], f: &mut Fields<'_>) {
        if keyword == b"PADSTACK" {
            let name = f.quoted_or_plain().unwrap_or_default();
            let drilled = f.float().is_some_and(|d| d > 0.0);
            self.padstacks.insert(name.clone(), Padstack { drilled, ..Default::default() });
            self.current = Some(name);
            return;
        }
        if keyword != b"PAD" {
            return;
        }
        let Some(name) = self.current.clone() else {
            return;
        };
        let pad_name = f.quoted_or_plain().unwrap_or_default();
        let layer = f.string().unwrap_or_default().to_ascii_uppercase();
        let (pad_radius, pad_drilled) =
            self.pads.get(&pad_name).map_or((None, false), |p| (p.radius, p.drilled));
        if let Some(stack) = self.padstacks.get_mut(&name) {
            stack.top |= layer.contains("TOP") || layer == "ALL";
            stack.bottom |= layer.contains("BOTTOM") || layer == "ALL";
            stack.drilled |= pad_drilled;
            if let Some(r) = pad_radius {
                stack.radius = Some(stack.radius.map_or(r, |old| old.max(r)));
            }
        }
    }

    fn shape_line(&mut self, keyword: &[u8], f: &mut Fields<'_>) {
        if keyword == b"SHAPE" {
            let name = f.quoted_or_plain().unwrap_or_default();
            self.shapes.insert(name.clone(), Shape::default());
            self.current = Some(name);
            return;
        }
        let Some(name) = self.current.clone() else {
            return;
        };
        let geometry = self.geometry(keyword, f);
        let pin = if keyword == b"PIN" {
            match (f.quoted_or_plain(), f.quoted_or_plain(), self.xy(f)) {
                (Some(pin), Some(pad), Some(pos)) => Some(ShapePin { name: pin, pad, pos }),
                _ => None,
            }
        } else {
            None
        };
        let insert = (keyword == b"INSERT").then(|| f.string()).flatten();
        let Some(shape) = self.shapes.get_mut(&name) else {
            return;
        };
        if let Some(g) = geometry {
            shape.outline.extend(g);
        }
        if let Some(pin) = pin {
            shape.pins.push(pin);
        }
        if let Some(insert) = insert {
            shape.insert = Some(insert.to_ascii_uppercase());
        }
    }

    fn component_line(&mut self, keyword: &[u8], f: &mut Fields<'_>) {
        if keyword == b"COMPONENT" {
            self.components.push(Component {
                name: f.quoted_or_plain().unwrap_or_default(),
                place: Point::default(),
                side: Side::Top,
                rotation: 0.0,
                shape: None,
                device: None,
            });
            return;
        }
        let scale = self.scale;
        let Some(c) = self.components.last_mut() else {
            return;
        };
        match keyword {
            b"PLACE" => {
                if let (Some(x), Some(y)) = (f.float(), f.float()) {
                    c.place = Point::new(x * scale, y * scale);
                }
            }
            b"LAYER" => {
                c.side = if f.string().is_some_and(|l| l.to_ascii_uppercase().contains("BOTTOM")) {
                    Side::Bottom
                } else {
                    Side::Top
                };
            }
            b"ROTATION" => c.rotation = f.float().unwrap_or(0.0),
            b"SHAPE" => {
                let name = f.quoted_or_plain().unwrap_or_default();
                let mirror = f.string().unwrap_or_default().to_ascii_uppercase();
                let flip = f.string().unwrap_or_default().to_ascii_uppercase();
                c.shape = Some(ShapeRef {
                    name,
                    mirror_x: mirror == "MIRRORX",
                    mirror_y: mirror == "MIRRORY",
                    flip: flip == "FLIP",
                });
            }
            // Some exporters put spaces in device names; they are matched
            // against the $DEVICES section with underscores.
            b"DEVICE" => c.device = Some(f.rest_string().replace(' ', "_")),
            _ => {}
        }
    }

    fn device_line(&mut self, keyword: &[u8], f: &mut Fields<'_>) {
        if keyword == b"DEVICE" {
            let name = f.rest_string().replace(' ', "_");
            self.devices.insert(name.clone(), Device::default());
            self.current = Some(name);
            return;
        }
        let Some(name) = self.current.clone() else {
            return;
        };
        let Some(device) = self.devices.get_mut(&name) else {
            return;
        };
        let value = f.quoted_or_plain().filter(|v| !v.is_empty());
        match keyword {
            b"PART" => device.part = value,
            b"VALUE" => device.value = value,
            _ => {}
        }
    }

    fn finish(self) -> RawBoard {
        let mut board = RawBoard::new(FormatId::GenCad);
        board.outline_segments = self.outline;
        let mut placed: HashSet<(String, i64, i64, bool)> = HashSet::new();
        let mut missing_shapes = 0usize;
        let mut placements = Vec::new();

        for c in &self.components {
            let mut part = RawPart::new(c.name.clone(), c.side, Mount::Smd);
            part.device = c.device.as_ref().map(|d| describe_device(d, self.devices.get(d)));

            let Some(sref) = &c.shape else {
                board.parts.push(part);
                continue;
            };
            // Panelised exports repeat components; keep the first placement.
            let key = (
                sref.name.clone(),
                c.place.x.round() as i64,
                c.place.y.round() as i64,
                c.side == Side::Bottom,
            );
            if !placed.insert(key) {
                continue;
            }
            let Some(shape) = self.shapes.get(&sref.name) else {
                missing_shapes += 1;
                board.parts.push(part);
                continue;
            };
            if shape.pins.is_empty() && shape.outline.is_empty() {
                // Nothing but a placement: a small marker keeps it findable.
                let (x, y, r) = (c.place.x, c.place.y, PLACE_MARKER);
                part.outline = Some(vec![
                    Point::new(x - r, y - r),
                    Point::new(x + r, y - r),
                    Point::new(x + r, y + r),
                    Point::new(x - r, y + r),
                ]);
                part.marker = true;
                placements.push(Placement { part: board.parts.len(), center: c.place, rotation: c.rotation });
                board.parts.push(part);
                continue;
            }

            let transform = Transform::new(c.place, c.rotation, sref.mirror_x, sref.mirror_y);
            let mut through_hole = matches!(shape.insert.as_deref(), Some("TH" | "PTH" | "THRU" | "THROUGH"));

            for sp in &shape.pins {
                let stack = self.padstacks.get(&sp.pad);
                let pad = self.pads.get(&sp.pad);
                through_hole |= stack.is_some_and(|s| s.drilled) || pad.is_some_and(|p| p.drilled);
                let mut side = stack.and_then(Padstack::side);
                if sref.flip {
                    side = side.map(|s| match s {
                        Side::Top => Side::Bottom,
                        Side::Bottom => Side::Top,
                        Side::Both => Side::Both,
                    });
                }
                part.pins.push(RawPin {
                    pos: transform.apply(sp.pos),
                    side,
                    net: self.signals.get(&(c.name.clone(), sp.name.clone())).cloned().unwrap_or_default(),
                    number: Some(sp.name.clone()),
                    radius: stack.and_then(|s| s.radius).or(pad.and_then(|p| p.radius)),
                    ..Default::default()
                });
            }

            if through_hole {
                part.mount = Mount::ThroughHole;
                part.side = Side::Both;
            }
            part.outline =
                closed_outline(&shape.outline).map(|o| o.into_iter().map(|p| transform.apply(p)).collect());
            board.parts.push(part);
        }

        let sides = layer_sides(self.tracks.iter().map(|t| t.layer.as_str()));
        for t in self.tracks {
            board.traces.push(RawTrace {
                from: t.from,
                to: t.to,
                width: t.width,
                side: sides.get(&t.layer).copied().unwrap_or(Side::Top),
                layer: t.layer,
                net: t.net,
            });
        }
        for (net, pos) in self.vias {
            board.test_points.push(RawTestPoint {
                kind: TestPointKind::Via,
                pos,
                side: Side::Both,
                net,
                probe: None,
                radius: None,
                name: None,
            });
        }
        if missing_shapes > 0 {
            board.warn(format!("{missing_shapes} components reference shapes that are not defined"));
        }
        // Placements without shapes: estimate the parts from the copper.
        if !placements.is_empty() && !board.traces.is_empty() {
            let with_pins = infer::footprints(&mut board, &placements);
            board.warn(format!(
                "{} parts have no shape in the file; body, side and pads are estimated from the copper, \
                 pins and nets for {with_pins} of them",
                placements.len()
            ));
        }
        board
    }
}

/// Half size of the marker drawn for parts whose shape is empty.
const PLACE_MARKER: f64 = 10.0;

/// Which side each route layer is on. Named layers say so; numbered ones
/// (LAYER_1 … LAYER_16) run from top to bottom, everything between is inner.
fn layer_sides<'a>(layers: impl Iterator<Item = &'a str>) -> HashMap<String, Side> {
    let names: HashSet<&str> = layers.collect();
    let number = |n: &str| -> Option<u32> {
        let digits: String = n.chars().rev().take_while(char::is_ascii_digit).collect();
        digits.chars().rev().collect::<String>().parse().ok()
    };
    let numbers: Vec<u32> = names.iter().filter_map(|n| number(n)).collect();
    let top = numbers.iter().copied().min();
    // 16 is the bottom copper layer in 16-layer numbering; above it are
    // non-copper layers.
    let bottom = if numbers.contains(&16) { Some(16) } else { numbers.iter().copied().max() };
    names
        .into_iter()
        .map(|n| {
            let side = if n.contains("TOP") {
                Side::Top
            } else if n.contains("BOT") {
                Side::Bottom
            } else {
                match number(n) {
                    Some(k) if Some(k) == top => Side::Top,
                    Some(k) if Some(k) == bottom && top != bottom => Side::Bottom,
                    _ => Side::Both,
                }
            };
            (n.to_string(), side)
        })
        .collect()
}

fn describe_device(name: &str, device: Option<&Device>) -> String {
    let Some(d) = device else {
        return name.to_string();
    };
    match (&d.value, &d.part) {
        (Some(v), Some(p)) if v != p => format!("{v} · {p}"),
        (Some(v), _) => v.clone(),
        (None, Some(p)) => p.clone(),
        (None, None) => name.to_string(),
    }
}

/// Placement of a shape on the board, matching OpenBoardView's handling of
/// rotation combined with a single mirror axis.
struct Transform {
    origin: Point,
    cos: f64,
    sin: f64,
    mx: f64,
    my: f64,
}

impl Transform {
    fn new(origin: Point, rotation_deg: f64, mirror_x: bool, mirror_y: bool) -> Self {
        let mx = if mirror_x { -1.0 } else { 1.0 };
        let my = if mirror_y { -1.0 } else { 1.0 };
        let mut rad = rotation_deg.to_radians();
        if mx * my < 0.0 {
            rad = PI - rad;
        }
        Self { origin, cos: rad.cos(), sin: rad.sin(), mx, my }
    }

    fn apply(&self, p: Point) -> Point {
        Point::new(
            self.origin.x + self.mx * (p.x * self.cos - p.y * self.sin),
            self.origin.y + self.my * (p.x * self.sin + p.y * self.cos),
        )
    }
}

/// Counter-clockwise arc from `start` to `end` around `center`, as segments.
/// Equal start and end points describe a full circle.
fn arc(start: Point, end: Point, center: Point) -> Vec<(Point, Point)> {
    let r = start.distance(center);
    if r <= 0.0 {
        return vec![(start, end)];
    }
    let a0 = (start.y - center.y).atan2(start.x - center.x);
    let mut a1 = (end.y - center.y).atan2(end.x - center.x);
    if a1 <= a0 + 1e-9 {
        a1 += TAU;
    }
    let steps = (((a1 - a0) / 0.1).ceil() as usize).clamp(2, 128);
    let mut out = Vec::with_capacity(steps);
    let mut prev = start;
    for i in 1..=steps {
        let p = if i == steps {
            end
        } else {
            let a = a0 + (a1 - a0) * i as f64 / steps as f64;
            Point::new(center.x + r * a.cos(), center.y + r * a.sin())
        };
        out.push((prev, p));
        prev = p;
    }
    out
}

/// Picks the largest closed loop from a shape's drawing as its body outline.
fn closed_outline(segments: &[(Point, Point)]) -> Option<Vec<Point>> {
    if segments.len() < 3 {
        return None;
    }
    let mut best: Option<(f64, Vec<Point>)> = None;
    let mut remaining: Vec<(Point, Point)> = segments.to_vec();
    while let Some((a, b)) = remaining.pop() {
        let mut path = vec![a, b];
        loop {
            let tail = *path.last()?;
            let near = |p: Point| p.distance(tail) < 0.5;
            let Some(i) = remaining.iter().position(|(p, q)| near(*p) || near(*q)) else {
                break;
            };
            let (p, q) = remaining.swap_remove(i);
            path.push(if near(p) { q } else { p });
        }
        let closed = path.len() >= 4 && path[0].distance(*path.last()?) < 0.5;
        if closed {
            path.pop();
            let area = polygon_area(&path).abs();
            if best.as_ref().is_none_or(|(a, _)| area > *a) {
                best = Some((area, path));
            }
        }
    }
    best.map(|(_, p)| p)
}

fn polygon_area(points: &[Point]) -> f64 {
    let n = points.len();
    (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            a.x * b.y - b.x * a.y
        })
        .sum::<f64>()
        / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarter_arc_ends_exactly() {
        let segs = arc(Point::new(10.0, 0.0), Point::new(0.0, 10.0), Point::default());
        assert_eq!(segs.last().unwrap().1, Point::new(0.0, 10.0));
        for (a, _) in &segs {
            assert!((a.distance(Point::default()) - 10.0).abs() < 1e-9);
        }
    }

    #[test]
    fn rotation_places_pins() {
        let t = Transform::new(Point::new(100.0, 100.0), 90.0, false, false);
        let p = t.apply(Point::new(10.0, 0.0));
        assert!((p.x - 100.0).abs() < 1e-9 && (p.y - 110.0).abs() < 1e-9);
    }

    #[test]
    fn finds_rectangle_outline() {
        let p = |x, y| Point::new(x, y);
        let segs = vec![
            (p(0.0, 0.0), p(4.0, 0.0)),
            (p(4.0, 2.0), p(0.0, 2.0)),
            (p(4.0, 0.0), p(4.0, 2.0)),
            (p(0.0, 2.0), p(0.0, 0.0)),
        ];
        let o = closed_outline(&segs).unwrap();
        assert_eq!(o.len(), 4);
        assert!((polygon_area(&o).abs() - 8.0).abs() < 1e-9);
    }
}
