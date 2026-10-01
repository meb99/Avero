//! Footprints for parts whose file gives only a position.
//!
//! Some converters (XinZhiZao to GenCAD) write placements with empty shapes:
//! no pads, no outline, no pins. The copper still says a lot: tracks end on
//! pads, and BGAs sit on a dense field of fan-out vias. From that this module
//! estimates, per part, the side, a body and its pads, and for two-terminal
//! parts the nets of the pads that a track or via lands on.
//!
//! Everything here is marked as estimated; nothing is invented where the
//! copper gives no evidence.

use std::collections::HashMap;

use crate::builder::{RawBoard, RawPin};
use crate::model::{Package, PadMark, Point, Side, TestPointKind};

/// A part known only by name, position and rotation.
pub(crate) struct Placement {
    /// Index into `RawBoard::parts`.
    pub part: usize,
    pub center: Point,
    /// Degrees, counter-clockwise.
    pub rotation: f64,
}

/// Package family from footprint names such as `C-0201`, `L-0915`,
/// `BGA-8*8`, `QFN-50`, `IC-6-1`, `J-50-3`.
pub(crate) fn package_of(footprint: &str) -> Option<Package> {
    let upper = footprint.to_ascii_uppercase();
    let prefix = upper.split(['-', '_']).next().unwrap_or("");
    Some(match prefix {
        "C" | "R" | "CAP" | "RES" => Package::Passive,
        "L" | "FB" | "IND" => Package::Inductor,
        "D" | "LED" => Package::Diode,
        "Y" | "X" | "XTAL" => Package::Crystal,
        "BGA" | "QFN" | "QFP" | "LGA" | "DFN" | "SON" | "SOP" | "SOIC" | "SOT" | "TSSOP" | "CSP" | "IC"
        | "U" => Package::Ic,
        "J" | "CN" | "CON" | "USB" => Package::Connector,
        _ => return None,
    })
}

/// Footprint name without the instance suffix: `C-0201_17` -> `C-0201`.
fn footprint_class(name: &str) -> &str {
    match name.rsplit_once('_') {
        Some((base, n)) if !base.is_empty() && n.chars().all(|c| c.is_ascii_digit()) => base,
        _ => name,
    }
}

/// A copper point where a pad may be: a track end or a via.
#[derive(Clone)]
struct Copper {
    pos: Point,
    net: String,
}

/// Coarse grid over copper points for radius queries.
struct Grid {
    cell: f64,
    cells: HashMap<(i64, i64), Vec<Copper>>,
}

impl Grid {
    fn new(points: impl IntoIterator<Item = Copper>) -> Self {
        let cell = 50.0;
        let mut cells: HashMap<(i64, i64), Vec<Copper>> = HashMap::new();
        for p in points {
            cells
                .entry(((p.pos.x / cell).floor() as i64, (p.pos.y / cell).floor() as i64))
                .or_default()
                .push(p);
        }
        Self { cell, cells }
    }

    fn near(&self, c: Point, r: f64) -> impl Iterator<Item = &Copper> {
        let (x0, x1) = (((c.x - r) / self.cell).floor() as i64, ((c.x + r) / self.cell).floor() as i64);
        let (y0, y1) = (((c.y - r) / self.cell).floor() as i64, ((c.y + r) / self.cell).floor() as i64);
        (x0..=x1)
            .flat_map(move |i| (y0..=y1).map(move |j| (i, j)))
            .filter_map(|k| self.cells.get(&k))
            .flatten()
            .filter(move |p| (p.pos.x - c.x).abs() <= r && (p.pos.y - c.y).abs() <= r)
    }
}

/// Local frame of a part: `u` along its rotation, `v` across.
fn local(p: Point, center: Point, rotation: f64) -> (f64, f64) {
    let (s, c) = rotation.to_radians().sin_cos();
    let (dx, dy) = (p.x - center.x, p.y - center.y);
    (dx * c + dy * s, -dx * s + dy * c)
}

fn world(u: f64, v: f64, center: Point, rotation: f64) -> Point {
    let (s, c) = rotation.to_radians().sin_cos();
    Point::new(center.x + u * c - v * s, center.y + u * s + v * c)
}

fn rect(center: Point, rotation: f64, half_u: f64, half_v: f64) -> Vec<Point> {
    [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]
        .iter()
        .map(|(a, b)| world(a * half_u, b * half_v, center, rotation))
        .collect()
}

/// Side and half pad pitch a footprint class shows in the copper.
struct Learned {
    side: Side,
    half: f64,
    /// Strong enough to place pads and read nets from.
    reliable: bool,
}

/// Mil pitch of 0.4 mm, the usual ball pitch of small BGAs.
const BGA_PITCH: f64 = 15.75;

/// For each placement, histogram where copper lies along the part axis;
/// two-terminal parts show a sharp peak at half their pad pitch.
fn learn_two_terminal(members: &[&Placement], grids: &[(Side, &Grid)]) -> Option<Learned> {
    let mut found: Vec<(Side, usize, f64)> = Vec::new();
    for &(side, grid) in grids {
        let mut hist = [0usize; 72];
        for m in members {
            for p in grid.near(m.center, 70.0) {
                let (u, v) = local(p.pos, m.center, m.rotation);
                let u = u.abs();
                if v.abs() < 4.0 && (3.0..=70.0).contains(&u) {
                    hist[u.round() as usize] += 1;
                }
            }
        }
        let smooth = |k: usize| hist[k.saturating_sub(2)..=(k + 2).min(71)].iter().sum::<usize>();
        let (k, score) = (3..=70).map(|k| (k, smooth(k))).max_by_key(|&(_, s)| s)?;
        found.push((side, score, k as f64));
    }
    found.sort_by_key(|&(_, score, _)| std::cmp::Reverse(score));
    let (side, score, half) = *found.first()?;
    let other = found.get(1).map_or(0, |f| f.1);
    let n = members.len();
    let reliable = n >= 3 && score as f64 >= 0.35 * n as f64 && score >= 2 * other.max(1);
    let clear = score >= 3 && score >= 2 * other;
    (reliable || clear).then_some(Learned { side, half, reliable })
}

/// Half pad pitch from a size code such as `0201` (imperial, length in
/// 10-mil steps): the pads sit at about 45 % of the length from the center.
fn half_from_code(class: &str) -> Option<f64> {
    let code = class.split('-').nth(1)?;
    if code.len() != 4 || !code.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // Standard chip sizes run from 01005 to 2512; other codes mean something else.
    let length = code[..2].parse::<f64>().ok()? * 10.0;
    (length > 0.0 && length <= 250.0).then(|| (length * 0.45).clamp(6.0, 60.0))
}

/// Ball grid from names such as `BGA-8*8` or `BGA-9*10-1`.
fn ball_grid(class: &str) -> Option<(f64, f64)> {
    let spec = class.split('-').nth(1)?;
    let (a, b) = spec.split_once('*')?;
    let b = b.split('*').next()?;
    Some((a.parse().ok()?, b.parse().ok()?))
}

/// Half size of the dense copper field around a chip: square rings of
/// 20 mil are dense up to the package edge and sparse beyond it.
fn field_half_size(all: &Grid, center: Point) -> Option<f64> {
    const RING: f64 = 20.0;
    const RINGS: usize = 26;
    let mut density = [0.0; RINGS];
    for p in all.near(center, RING * (RINGS as f64 + 0.5)) {
        let m = (p.pos.x - center.x).abs().max((p.pos.y - center.y).abs());
        let k = ((m - RING / 2.0) / RING).floor();
        if (0.0..RINGS as f64).contains(&k) {
            density[k as usize] += 1.0;
        }
    }
    for (k, d) in density.iter_mut().enumerate() {
        let inner = RING / 2.0 + RING * k as f64;
        let outer = inner + RING;
        *d /= (2.0 * outer).powi(2) - (2.0 * inner).powi(2);
    }
    let peak = density[1..].iter().copied().fold(0.0, f64::max);
    if peak <= 0.0 {
        return None;
    }
    // The edge: the last dense ring before three sparse ones in a row.
    let dense = |k: usize| density[k] >= 0.5 * peak;
    let edge = (1..RINGS - 3).find(|&k| dense(k) && !dense(k + 1) && !dense(k + 2) && !dense(k + 3))?;
    let half = RING / 2.0 + RING * (edge as f64 + 1.0);
    (30.0..=450.0).contains(&half).then_some(half)
}

/// Gives each placement a package, side, body, pads and, where the copper
/// shows them, pins with nets. Returns how many parts got pins.
pub(crate) fn footprints(board: &mut RawBoard, placements: &[Placement]) -> usize {
    let mut top = Vec::new();
    let mut bottom = Vec::new();
    for t in &board.traces {
        let list = match t.side {
            Side::Top => &mut top,
            Side::Bottom => &mut bottom,
            Side::Both => continue,
        };
        for pos in [t.from, t.to] {
            list.push(Copper { pos, net: t.net.clone() });
        }
    }
    let vias: Vec<Copper> = board
        .test_points
        .iter()
        .filter(|t| t.kind == TestPointKind::Via)
        .map(|t| Copper { pos: t.pos, net: t.net.clone() })
        .collect();
    let all = Grid::new(top.iter().chain(&bottom).chain(&vias).cloned());
    let top = Grid::new(top.into_iter().chain(vias.iter().cloned()));
    let bottom = Grid::new(bottom.into_iter().chain(vias));
    let grids = [(Side::Top, &top), (Side::Bottom, &bottom)];

    let mut classes: HashMap<&str, Vec<&Placement>> = HashMap::new();
    for p in placements {
        classes.entry(footprint_class(&board.parts[p.part].name)).or_default().push(p);
    }

    // Chips and connectors do not overlap each other: each gets at most
    // half the distance to its nearest neighbour.
    let big: Vec<Point> = placements
        .iter()
        .filter(|p| {
            matches!(
                package_of(footprint_class(&board.parts[p.part].name)),
                Some(Package::Ic | Package::Connector | Package::Crystal)
            )
        })
        .map(|p| p.center)
        .collect();
    let room = |c: Point| -> f64 {
        big.iter()
            .map(|o| (o.x - c.x).abs().max((o.y - c.y).abs()))
            .filter(|&d| d > 1.0)
            .fold(f64::INFINITY, f64::min)
            * 0.55
    };

    let mut with_pins = 0;
    let mut updates = Vec::new();
    for (class, members) in &classes {
        let Some(package) = package_of(class) else { continue };
        // A trailing `-2` marks bottom-side variants in XZZ libraries.
        let hinted = if class.ends_with("-2") { Side::Bottom } else { Side::Top };
        match package {
            Package::Passive | Package::Inductor | Package::Diode => {
                let learned = learn_two_terminal(members, &grids);
                let half = learned
                    .as_ref()
                    .filter(|l| l.reliable)
                    .map(|l| l.half)
                    .or_else(|| half_from_code(class))
                    .unwrap_or(if package == Package::Inductor { 30.0 } else { 14.0 });
                let side = learned.as_ref().map_or(hinted, |l| l.side);
                let reliable = learned.as_ref().is_some_and(|l| l.reliable);
                let pad = (half * 0.45).max(3.0);
                let body_v = if package == Package::Inductor { half * 0.9 } else { pad * 1.2 };
                let grid = if side == Side::Bottom { &bottom } else { &top };
                for m in members {
                    let pads = [-half, half].map(|u| world(u, 0.0, m.center, m.rotation));
                    let mut pins = Vec::new();
                    if reliable {
                        for (i, &at) in pads.iter().enumerate() {
                            let tolerance = (pad * 0.8).max(2.5);
                            let hit = grid
                                .near(at, tolerance)
                                .min_by(|a, b| a.pos.distance(at).total_cmp(&b.pos.distance(at)));
                            if let Some(hit) = hit.filter(|h| !h.net.is_empty()) {
                                pins.push(RawPin {
                                    pos: at,
                                    side: Some(side),
                                    net: hit.net.clone(),
                                    number: Some((i + 1).to_string()),
                                    radius: Some(pad),
                                    ..Default::default()
                                });
                            }
                        }
                    }
                    let outline = rect(m.center, m.rotation, half + pad, body_v);
                    let marks = pads.iter().map(|p| PadMark { x: p.x, y: p.y, radius: pad }).collect();
                    updates.push((m.part, package, side, outline, marks, pins));
                }
            }
            Package::Ic | Package::Connector | Package::Crystal => {
                for m in members {
                    let (hu, hv) = match (package, ball_grid(class)) {
                        (Package::Ic, Some((a, b))) => (a * BGA_PITCH / 2.0 + 4.0, b * BGA_PITCH / 2.0 + 4.0),
                        (Package::Ic, None) => {
                            let h = field_half_size(&all, m.center).unwrap_or(60.0);
                            (h, h)
                        }
                        (Package::Connector, _) => {
                            let pins: f64 =
                                class.split('-').nth(1).and_then(|n| n.parse().ok()).unwrap_or(10.0);
                            ((pins * 8.0).clamp(40.0, 250.0), 25.0)
                        }
                        _ => (30.0, 22.0),
                    };
                    let limit = room(m.center).max(15.0);
                    let (hu, hv) = (hu.min(limit), hv.min(limit));
                    // The side with more track ends under the body.
                    let count = |g: &Grid| g.near(m.center, hu.max(hv)).count();
                    let side = match (count(&top), count(&bottom)) {
                        (t, b) if b > t + t / 2 => Side::Bottom,
                        (t, b) if t > b + b / 2 => Side::Top,
                        _ => hinted,
                    };
                    let outline = rect(m.center, m.rotation, hu, hv);
                    updates.push((m.part, package, side, outline, Vec::new(), Vec::new()));
                }
            }
        }
    }

    for (part, package, side, outline, pads, pins) in updates {
        let p = &mut board.parts[part];
        with_pins += usize::from(!pins.is_empty());
        p.package = Some(package);
        p.estimated = true;
        p.marker = false;
        p.side = side;
        p.outline = Some(outline);
        p.pads = pads;
        p.pins = pins;
    }
    with_pins
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_footprint_names() {
        assert_eq!(package_of("C-0201"), Some(Package::Passive));
        assert_eq!(package_of("BGA-CPU-29"), Some(Package::Ic));
        assert_eq!(package_of("J-50-3"), Some(Package::Connector));
        assert_eq!(package_of("COMPONENT_9"), None);
        assert_eq!(footprint_class("C-0201_17"), "C-0201");
        assert_eq!(footprint_class("C-0202-2"), "C-0202-2");
        assert_eq!(ball_grid("BGA-9*10-1"), Some((9.0, 10.0)));
        assert_eq!(half_from_code("C-0402"), Some(18.0));
    }

    #[test]
    fn local_and_world_are_inverse() {
        let c = Point::new(100.0, 50.0);
        let p = world(10.0, 3.0, c, 90.0);
        let (u, v) = local(p, c, 90.0);
        assert!((u - 10.0).abs() < 1e-9 && (v - 3.0).abs() < 1e-9);
    }
}
