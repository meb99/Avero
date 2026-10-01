//! Turns what a reader found in a file into a normalized [`Board`].
//!
//! Readers only collect raw parts, pins and test points. Everything that is
//! the same for all formats happens here: net indexing and classification,
//! pin size estimation, part outlines, board outline and bounds.

use std::collections::HashMap;

use crate::model::{
    Board, Bounds, FormatId, Layer, Mount, Net, NetKind, Package, PadMark, Part, Pin, Point, Side, TestPoint,
    TestPointKind, Trace,
};

#[derive(Debug, Clone, Default)]
pub(crate) struct RawPin {
    pub pos: Point,
    /// `None` means "same side as the part".
    pub side: Option<Side>,
    pub net: String,
    pub number: Option<String>,
    pub name: Option<String>,
    pub radius: Option<f64>,
    pub probe: Option<i32>,
}

#[derive(Debug, Clone)]
pub(crate) struct RawPart {
    pub name: String,
    pub side: Side,
    pub mount: Mount,
    pub device: Option<String>,
    pub pins: Vec<RawPin>,
    /// Explicit body outline from the file, if any.
    pub outline: Option<Vec<Point>>,
    /// Only the position is known; `outline` is a small square around it.
    pub marker: bool,
    pub package: Option<Package>,
    /// Body, side, pads and pins estimated from the copper.
    pub estimated: bool,
    /// Pads drawn for the shape only.
    pub pads: Vec<PadMark>,
}

impl RawPart {
    pub fn new(name: impl Into<String>, side: Side, mount: Mount) -> Self {
        Self {
            name: name.into(),
            side,
            mount,
            device: None,
            pins: Vec::new(),
            outline: None,
            marker: false,
            package: None,
            estimated: false,
            pads: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RawTestPoint {
    pub kind: TestPointKind,
    pub pos: Point,
    pub side: Side,
    pub net: String,
    pub probe: Option<i32>,
    pub radius: Option<f64>,
    /// Label such as `TP1203`, when the format has one.
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct RawTrace {
    pub from: Point,
    pub to: Point,
    pub width: f64,
    pub side: Side,
    pub layer: String,
    pub net: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RawBoard {
    pub format: FormatId,
    /// Outline given as a single point path (most text formats).
    pub outline_path: Vec<Point>,
    /// Outline given as loose segments (GenCAD, BVR3). Chained on build.
    pub outline_segments: Vec<(Point, Point)>,
    pub parts: Vec<RawPart>,
    pub test_points: Vec<RawTestPoint>,
    pub traces: Vec<RawTrace>,
    pub warnings: Vec<String>,
    pub locked_parts: u32,
}

impl RawBoard {
    pub fn new(format: FormatId) -> Self {
        Self {
            format,
            outline_path: Vec::new(),
            outline_segments: Vec::new(),
            parts: Vec::new(),
            test_points: Vec::new(),
            traces: Vec::new(),
            warnings: Vec::new(),
            locked_parts: 0,
        }
    }

    pub fn warn(&mut self, message: impl Into<String>) {
        const MAX_WARNINGS: usize = 50;
        if self.warnings.len() < MAX_WARNINGS {
            self.warnings.push(message.into());
        }
    }

    pub fn pin_count(&self) -> usize {
        self.parts.iter().map(|p| p.pins.len()).sum()
    }

    pub fn build(self) -> Board {
        let mut nets = NetTable::default();
        let mut parts = Vec::with_capacity(self.parts.len());
        let mut pins = Vec::with_capacity(self.pin_count());

        for (part_index, raw) in self.parts.into_iter().enumerate() {
            let part_index = part_index as u32;
            let first_pin = pins.len() as u32;
            let radii = estimate_radii(&raw.pins);
            let mut pin_sides_all_both = !raw.pins.is_empty();

            for (i, (rp, radius)) in raw.pins.iter().zip(&radii).enumerate() {
                let side = rp.side.unwrap_or(raw.side);
                pin_sides_all_both &= side == Side::Both;
                let pin_index = pins.len() as u32;
                let net = nets.add_pin(&rp.net, pin_index);
                pins.push(Pin {
                    part: part_index,
                    number: rp.number.clone().unwrap_or_else(|| (i + 1).to_string()),
                    name: rp.name.clone().filter(|n| !n.is_empty()),
                    x: rp.pos.x,
                    y: rp.pos.y,
                    radius: *radius,
                    side,
                    net,
                    probe: rp.probe,
                });
            }

            let (side, mount) =
                if pin_sides_all_both { (Side::Both, Mount::ThroughHole) } else { (raw.side, raw.mount) };

            let body = &pins[first_pin as usize..];
            let outline = match raw.outline {
                Some(o) if o.len() >= 3 => o,
                _ => part_outline(body),
            };
            let bounds = Bounds::from_points(&outline);

            parts.push(Part {
                name: raw.name,
                side,
                mount,
                first_pin,
                pin_count: raw.pins.len() as u32,
                outline,
                bounds,
                device: raw.device.filter(|d| !d.is_empty()),
                marker: raw.marker,
                package: raw.package,
                estimated: raw.estimated,
                pads: raw.pads,
            });
        }

        let mut test_points = Vec::with_capacity(self.test_points.len());
        for tp in self.test_points {
            let index = test_points.len() as u32;
            let net = nets.add_test_point(&tp.net, index);
            test_points.push(TestPoint {
                kind: tp.kind,
                x: tp.pos.x,
                y: tp.pos.y,
                radius: tp.radius.filter(|r| *r > 0.0).unwrap_or(match tp.kind {
                    TestPointKind::Nail => 15.0,
                    TestPointKind::Via => 6.0,
                }),
                side: tp.side,
                net,
                probe: tp.probe,
                name: tp.name,
            });
        }

        let layers = order_layers(&self.traces);
        let layer_index: HashMap<&str, u32> =
            layers.iter().enumerate().map(|(i, l)| (l.name.as_str(), i as u32)).collect();
        let mut traces = Vec::with_capacity(self.traces.len());
        for t in &self.traces {
            let net = nets.add_trace(&t.net, traces.len() as u32);
            traces.push(Trace {
                x1: t.from.x,
                y1: t.from.y,
                x2: t.to.x,
                y2: t.to.y,
                width: t.width.max(0.0),
                side: t.side,
                layer: layer_index[t.layer.as_str()],
                net,
            });
        }

        let mut outline = Vec::new();
        if self.outline_path.len() >= 2 {
            outline.push(self.outline_path);
        }
        outline.extend(chain_segments(self.outline_segments));

        let mut content = Bounds::EMPTY;
        for p in &pins {
            content.include(Point::new(p.x, p.y));
        }
        for t in &test_points {
            content.include(Point::new(t.x, t.y));
        }
        for t in &traces {
            content.include(Point::new(t.x1, t.y1));
            content.include(Point::new(t.x2, t.y2));
        }

        if outline.is_empty() && !content.is_empty() {
            let mut b = content;
            b.expand(50.0);
            outline.push(vec![
                Point::new(b.min_x, b.min_y),
                Point::new(b.max_x, b.min_y),
                Point::new(b.max_x, b.max_y),
                Point::new(b.min_x, b.max_y),
                Point::new(b.min_x, b.min_y),
            ]);
        }

        let mut bounds = content;
        for path in &outline {
            for p in path {
                bounds.include(*p);
            }
        }
        for part in &parts {
            if !part.bounds.is_empty() {
                bounds.include(Point::new(part.bounds.min_x, part.bounds.min_y));
                bounds.include(Point::new(part.bounds.max_x, part.bounds.max_y));
            }
        }
        if bounds.is_empty() {
            bounds = Bounds { min_x: 0.0, min_y: 0.0, max_x: 1000.0, max_y: 1000.0 };
        }

        Board {
            format: self.format,
            format_name: self.format.display_name().to_string(),
            unit: "mil",
            outline,
            bounds,
            parts,
            pins,
            test_points,
            traces,
            layers,
            nets: nets.finish(),
            warnings: self.warnings,
            locked_parts: self.locked_parts,
        }
    }
}

/// Distinct trace layers: top, inner layers by number, bottom.
fn order_layers(traces: &[RawTrace]) -> Vec<Layer> {
    let mut seen: HashMap<&str, Side> = HashMap::new();
    for t in traces {
        seen.entry(t.layer.as_str()).or_insert(t.side);
    }
    let number = |name: &str| -> u32 {
        let digits: String = name.chars().rev().take_while(char::is_ascii_digit).collect();
        digits.chars().rev().collect::<String>().parse().unwrap_or(u32::MAX)
    };
    let rank = |s: Side| match s {
        Side::Top => 0,
        Side::Both => 1,
        Side::Bottom => 2,
    };
    let mut layers: Vec<Layer> =
        seen.into_iter().map(|(name, side)| Layer { name: name.to_string(), side }).collect();
    layers.sort_by(|a, b| {
        (rank(a.side), number(&a.name), &a.name).cmp(&(rank(b.side), number(&b.name), &b.name))
    });
    layers
}

#[derive(Default)]
struct NetTable {
    index: HashMap<String, u32>,
    nets: Vec<Net>,
}

impl NetTable {
    fn resolve(&mut self, raw_name: &str) -> u32 {
        let name = normalize_net_name(raw_name);
        if let Some(&i) = self.index.get(name) {
            return i;
        }
        let i = self.nets.len() as u32;
        self.nets.push(Net {
            name: name.to_string(),
            kind: classify_net(name),
            pins: Vec::new(),
            test_points: Vec::new(),
            traces: Vec::new(),
        });
        self.index.insert(name.to_string(), i);
        i
    }

    fn add_pin(&mut self, name: &str, pin: u32) -> u32 {
        let i = self.resolve(name);
        self.nets[i as usize].pins.push(pin);
        i
    }

    fn add_test_point(&mut self, name: &str, tp: u32) -> u32 {
        let i = self.resolve(name);
        self.nets[i as usize].test_points.push(tp);
        i
    }

    fn add_trace(&mut self, name: &str, trace: u32) -> u32 {
        let i = self.resolve(name);
        self.nets[i as usize].traces.push(trace);
        i
    }

    fn finish(self) -> Vec<Net> {
        self.nets
    }
}

pub const UNCONNECTED: &str = "UNCONNECTED";

/// Maps the many spellings of "not connected" onto one net.
fn normalize_net_name(name: &str) -> &str {
    let name = name.trim();
    let upper = name.to_ascii_uppercase();
    if name.is_empty()
        || upper == UNCONNECTED
        || upper == "NC"
        || upper == "N/C"
        || upper == "NO_NET"
        || upper.starts_with("NC@")
    {
        UNCONNECTED
    } else {
        name
    }
}

/// Classifies a net by its name. This is a heuristic based on the naming
/// conventions of common board vendors (Apple `PP3V3_S5`, Lenovo `+3VALW`,
/// generic `VCC_1V8`, `GND`, `PGND`, ...). It only affects presentation.
pub fn classify_net(name: &str) -> NetKind {
    let upper = name.to_ascii_uppercase();
    if upper == UNCONNECTED {
        return NetKind::Unconnected;
    }
    if is_ground_name(&upper) {
        return NetKind::Ground;
    }
    if is_power_name(&upper) {
        return NetKind::Power;
    }
    NetKind::Signal
}

fn is_ground_name(n: &str) -> bool {
    if matches!(n, "GROUND" | "VSS" | "VSSA" | "VSSD" | "0V" | "EARTH" | "CHASSIS" | "SHIELD") {
        return true;
    }
    // Optional prefix, then GND, then an optional numeric or domain suffix:
    // GND, AGND, PGND, GND1, GND_2, GNDA, GND_EP, CHASSIS_GND, SYS_GND.
    let Some(pos) = n.find("GND") else {
        return false;
    };
    let prefix = &n[..pos];
    let suffix = &n[pos + 3..];
    let prefix_ok = prefix.is_empty()
        || (prefix.len() == 1 && "ADPSCEMV".contains(prefix))
        || matches!(
            prefix,
            "CHASSIS_" | "SYS_" | "SYS" | "PP" | "PP_" | "SIG_" | "BAT_" | "BATT_" | "USB_" | "HS_"
        );
    let suffix = suffix.strip_prefix('_').unwrap_or(suffix);
    let suffix_ok = suffix.is_empty()
        || suffix.chars().all(|c| c.is_ascii_digit())
        || matches!(suffix, "A" | "D" | "P" | "S" | "EP" | "PAD" | "CHASSIS" | "SHIELD" | "AUDIO" | "RF");
    prefix_ok && suffix_ok
}

fn is_power_name(n: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "PP", "+", "VCC", "VDD", "VBUS", "VBAT", "VSYS", "VIN", "VOUT", "VREG", "VCORE", "VPH", "VPP",
        "VBATT", "PWR_", "PVDD", "AVDD", "DVDD", "IOVDD", "BATT", "V_", "VCCIO", "VCCST",
    ];
    if PREFIXES.iter().any(|p| n.starts_with(p)) {
        // `PP` alone matches too much (PPS, PPD_...). Apple rails continue with
        // a digit, `V` or a bus name.
        if let Some(rest) = n.strip_prefix("PP") {
            if n.starts_with("PPS") && !n.starts_with("PPSYS") {
                return false;
            }
            return rest.chars().next().is_some_and(|c| {
                c.is_ascii_digit() || c == 'V' || c == '_' || c == 'B' || c == 'C' || c == 'D' || c == 'S'
            });
        }
        return true;
    }
    // 3V3, 1V8, 5V, 12V_MAIN, P1V05, P3V3_AUX
    let bytes = n.as_bytes();
    bytes.windows(3).any(|w| w[0].is_ascii_digit() && w[1] == b'V' && (w[2].is_ascii_digit() || w[2] == b'_'))
        || (bytes.len() >= 2 && bytes.ends_with(b"V") && bytes[bytes.len() - 2].is_ascii_digit())
}

/// Estimates a drawing radius for each pin. Formats rarely store pad sizes,
/// so the radius is derived from the distance to the nearest neighbour within
/// the same part, which tracks pad pitch well for everything from 01005
/// passives to 2.54 mm headers.
fn estimate_radii(pins: &[RawPin]) -> Vec<f64> {
    const MIN_R: f64 = 2.0;
    const MAX_R: f64 = 40.0;
    const LONE_R: f64 = 12.0;

    let explicit = |p: &RawPin| p.radius.filter(|r| r.is_finite() && *r > 0.0);
    if pins.iter().all(|p| explicit(p).is_some()) {
        return pins.iter().map(|p| explicit(p).unwrap_or(LONE_R)).collect();
    }

    let nearest = nearest_neighbour_distances(pins);
    pins.iter()
        .zip(nearest)
        .map(|(p, d)| {
            explicit(p).unwrap_or_else(|| match d {
                Some(d) if d > 0.0 => (d * 0.4).clamp(MIN_R, MAX_R),
                _ => LONE_R,
            })
        })
        .collect()
}

fn nearest_neighbour_distances(pins: &[RawPin]) -> Vec<Option<f64>> {
    let n = pins.len();
    if n < 2 {
        return vec![None; n];
    }
    // Grid buckets keep large BGAs (thousands of balls) fast.
    let bounds = Bounds::from_points(pins.iter().map(|p| &p.pos));
    let area = (bounds.width() * bounds.height()).max(1.0);
    let cell = (area / n as f64).sqrt().max(1.0);
    let key = |p: Point| (((p.x - bounds.min_x) / cell) as i64, ((p.y - bounds.min_y) / cell) as i64);

    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (i, p) in pins.iter().enumerate() {
        grid.entry(key(p.pos)).or_default().push(i);
    }

    pins.iter()
        .enumerate()
        .map(|(i, p)| {
            let (cx, cy) = key(p.pos);
            let mut best = f64::INFINITY;
            let mut ring = 0i64;
            loop {
                for dx in -ring..=ring {
                    for dy in -ring..=ring {
                        if dx.abs() != ring && dy.abs() != ring {
                            continue;
                        }
                        if let Some(bucket) = grid.get(&(cx + dx, cy + dy)) {
                            for &j in bucket {
                                if j != i {
                                    let d = p.pos.distance(pins[j].pos);
                                    if d > 0.0 && d < best {
                                        best = d;
                                    }
                                }
                            }
                        }
                    }
                }
                // Anything outside `ring` cells is at least `ring * cell` away.
                if best <= ring as f64 * cell || ring > 64 {
                    break;
                }
                ring += 1;
            }
            best.is_finite().then_some(best)
        })
        .collect()
}

/// Builds a body outline around a part's pins: an oriented box for two-pin
/// parts, otherwise the tightest of a few candidate rotations.
fn part_outline(pins: &[Pin]) -> Vec<Point> {
    match pins {
        [] => Vec::new(),
        [p] => {
            let r = p.radius * 1.6;
            rect(Point::new(p.x, p.y), r, r, 0.0)
        }
        [a, b] => {
            let (pa, pb) = (Point::new(a.x, a.y), Point::new(b.x, b.y));
            let r = a.radius.max(b.radius);
            let len = pa.distance(pb);
            let angle = (pb.y - pa.y).atan2(pb.x - pa.x);
            let center = Point::new((pa.x + pb.x) / 2.0, (pa.y + pb.y) / 2.0);
            let half_w = (r * 1.5).max(len * 0.25);
            rect(center, len / 2.0 + r * 1.4, half_w, angle)
        }
        _ => {
            let r = pins.iter().map(|p| p.radius).fold(0.0, f64::max);
            let mut candidates = vec![0.0];
            // Rotated ICs: the first pin pair usually runs along a body edge.
            let (a, b) = (&pins[0], &pins[1]);
            let edge = (b.y - a.y).atan2(b.x - a.x).rem_euclid(std::f64::consts::FRAC_PI_2);
            if edge > 0.01 && edge < std::f64::consts::FRAC_PI_2 - 0.01 {
                candidates.push(edge);
            }
            let mut best: Option<(f64, Vec<Point>)> = None;
            for angle in candidates {
                let (sin, cos) = angle.sin_cos();
                let mut b = Bounds::EMPTY;
                for p in pins {
                    // Rotate into the candidate frame.
                    b.include(Point::new(p.x * cos + p.y * sin, -p.x * sin + p.y * cos));
                }
                b.expand(r * 1.4);
                let area = b.width() * b.height();
                // Prefer axis-aligned unless the rotated box is clearly tighter.
                let area = if angle == 0.0 { area * 0.85 } else { area };
                if best.as_ref().is_none_or(|(a, _)| area < *a) {
                    let c = Point::new((b.min_x + b.max_x) / 2.0, (b.min_y + b.max_y) / 2.0);
                    let center = Point::new(c.x * cos - c.y * sin, c.x * sin + c.y * cos);
                    best = Some((area, rect(center, b.width() / 2.0, b.height() / 2.0, angle)));
                }
            }
            best.map(|(_, o)| o).unwrap_or_default()
        }
    }
}

fn rect(center: Point, half_w: f64, half_h: f64, angle: f64) -> Vec<Point> {
    let (sin, cos) = angle.sin_cos();
    [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]
        .iter()
        .map(|&(x, y)| Point::new(center.x + x * cos - y * sin, center.y + x * sin + y * cos))
        .collect()
}

/// Joins loose outline segments into polylines by matching endpoints.
fn chain_segments(segments: Vec<(Point, Point)>) -> Vec<Vec<Point>> {
    if segments.is_empty() {
        return Vec::new();
    }
    let key = |p: Point| ((p.x * 2.0).round() as i64, (p.y * 2.0).round() as i64);
    let mut by_point: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (i, (a, b)) in segments.iter().enumerate() {
        by_point.entry(key(*a)).or_default().push(i);
        by_point.entry(key(*b)).or_default().push(i);
    }
    let mut used = vec![false; segments.len()];
    let mut paths = Vec::new();

    let take_next = |at: Point, used: &mut Vec<bool>| -> Option<Point> {
        let candidates = by_point.get(&key(at))?;
        let &i = candidates.iter().find(|&&i| !used[i])?;
        used[i] = true;
        let (a, b) = segments[i];
        Some(if key(a) == key(at) { b } else { a })
    };

    for start in 0..segments.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let (a, b) = segments[start];
        let mut path = vec![a, b];
        while let Some(next) = take_next(*path.last().unwrap_or(&b), &mut used) {
            path.push(next);
        }
        let mut head = Vec::new();
        while let Some(prev) = take_next(head.last().copied().unwrap_or(a), &mut used) {
            head.push(prev);
        }
        if !head.is_empty() {
            head.reverse();
            head.extend(path);
            path = head;
        }
        paths.push(path);
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_common_net_names() {
        for n in ["GND", "PGND", "AGND", "GND_2", "GND1", "CHASSIS_GND", "VSS", "GNDA"] {
            assert_eq!(classify_net(n), NetKind::Ground, "{n}");
        }
        for n in ["PP3V3_S5", "PPBUS_G3H", "+3VALW", "VCC_CORE", "VDD_1V8", "P1V05_PCH", "12V_MAIN", "VBUS"] {
            assert_eq!(classify_net(n), NetKind::Power, "{n}");
        }
        for n in ["I2C_SDA", "USB_DP", "GND_DET", "PPS_SYNC", "SPI_CLK", "N12345"] {
            assert_eq!(classify_net(n), NetKind::Signal, "{n}");
        }
        assert_eq!(classify_net(UNCONNECTED), NetKind::Unconnected);
    }

    #[test]
    fn merges_not_connected_spellings() {
        assert_eq!(normalize_net_name(""), UNCONNECTED);
        assert_eq!(normalize_net_name("nc"), UNCONNECTED);
        assert_eq!(normalize_net_name("NC@12"), UNCONNECTED);
        assert_eq!(normalize_net_name(" USB_DP "), "USB_DP");
    }

    #[test]
    fn chains_out_of_order_segments() {
        let p = |x, y| Point::new(x, y);
        let segs =
            vec![(p(10.0, 0.0), p(10.0, 10.0)), (p(0.0, 0.0), p(10.0, 0.0)), (p(0.0, 10.0), p(10.0, 10.0))];
        let paths = chain_segments(segs);
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].len(), 4);
    }

    #[test]
    fn estimates_radius_from_pitch() {
        let pins: Vec<RawPin> = (0..4)
            .map(|i| RawPin { pos: Point::new(f64::from(i) * 20.0, 0.0), ..Default::default() })
            .collect();
        let r = estimate_radii(&pins);
        assert!(r.iter().all(|&r| (r - 8.0).abs() < 1e-9), "{r:?}");
    }
}
