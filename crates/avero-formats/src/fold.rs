//! Boards drawn as two views side by side: the top on the left and the
//! bottom, seen from below, on the right (XinZhiZao files, and GenCAD made
//! from them). Avero keeps one board with two sides, so the right view is
//! folded back onto the left one: everything there moves into the board's
//! frame (mirrored or shifted, whichever makes the outlines meet) and its
//! parts become bottom parts.

use crate::model::{Board, Bounds, Point, Side};

struct Frame {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

impl Frame {
    fn of(points: &[Point]) -> Option<Frame> {
        let first = points.first()?;
        let mut f = Frame { min_x: first.x, max_x: first.x, min_y: first.y, max_y: first.y };
        for p in points {
            f.min_x = f.min_x.min(p.x);
            f.max_x = f.max_x.max(p.x);
            f.min_y = f.min_y.min(p.y);
            f.max_y = f.max_y.max(p.y);
        }
        Some(f)
    }
    fn width(&self) -> f64 {
        self.max_x - self.min_x
    }
    fn height(&self) -> f64 {
        self.max_y - self.min_y
    }
}

/// How a point of the right view lands on the board.
#[derive(Clone, Copy)]
enum Fold {
    /// Seen from below: mirrored left to right.
    Mirror {
        a_min: f64,
        b_max: f64,
    },
    Shift {
        dx: f64,
    },
}

impl Fold {
    fn x(self, x: f64) -> f64 {
        match self {
            Fold::Mirror { a_min, b_max } => a_min + (b_max - x),
            Fold::Shift { dx } => x - dx,
        }
    }
    fn point(self, p: Point) -> Point {
        Point { x: self.x(p.x), y: p.y }
    }
    fn mirrors(self) -> bool {
        matches!(self, Fold::Mirror { .. })
    }
}

/// Mean distance from each point of `from` (moved) to the nearest point of `to`.
fn mismatch(from: &[Point], to: &[Point], fold: Fold) -> f64 {
    let step = (from.len() / 200).max(1);
    let mut sum = 0.0;
    let mut n = 0.0;
    for p in from.iter().step_by(step) {
        let q = fold.point(*p);
        let best = to.iter().map(|t| (t.x - q.x).hypot(t.y - q.y)).fold(f64::INFINITY, f64::min);
        sum += best;
        n += 1.0;
    }
    if n == 0.0 {
        f64::INFINITY
    } else {
        sum / n
    }
}

fn bounds_of(points: &[Point]) -> Bounds {
    let f = Frame::of(points).unwrap_or(Frame { min_x: 0.0, max_x: 0.0, min_y: 0.0, max_y: 0.0 });
    Bounds { min_x: f.min_x, min_y: f.min_y, max_x: f.max_x, max_y: f.max_y }
}

/// Folds a two-view board onto one; true when it was one. Boards with a
/// single outline, or two outlines that are not the same board twice, stay
/// as they are.
pub fn fold_side_by_side(board: &mut Board) -> bool {
    // The two largest outlines.
    let mut frames: Vec<(usize, Frame)> =
        board.outline.iter().enumerate().filter_map(|(i, p)| Frame::of(p).map(|f| (i, f))).collect();
    if frames.len() < 2 {
        return false;
    }
    frames.sort_by(|a, b| (b.1.width() * b.1.height()).total_cmp(&(a.1.width() * a.1.height())));
    let (ia, a) = &frames[0];
    let (ib, b) = &frames[1];
    let (ia, ib, a, b) = if a.min_x <= b.min_x { (*ia, *ib, a, b) } else { (*ib, *ia, b, a) };
    let same = |x: f64, y: f64| (x - y).abs() <= 0.03 * x.max(y);
    if !same(a.width(), b.width()) || !same(a.height(), b.height()) || a.width() <= 0.0 {
        return false;
    }
    // Next to each other, not overlapping, with at most half a board between.
    let gap = b.min_x - a.max_x;
    let overlap_y = a.max_y.min(b.max_y) - a.min_y.max(b.min_y);
    if gap < 0.0 || gap > 0.5 * a.width() || overlap_y < 0.8 * a.height() {
        return false;
    }
    let split = (a.max_x + b.min_x) / 2.0;
    let center = |bb: &Bounds| (bb.min_x + bb.max_x) / 2.0;
    let right = board.parts.iter().filter(|p| center(&p.bounds) > split).count();
    if right == 0 || right == board.parts.len() {
        return false;
    }
    let (pa, pb) = (&board.outline[ia], &board.outline[ib]);
    let mirror = Fold::Mirror { a_min: a.min_x, b_max: b.max_x };
    let shift = Fold::Shift { dx: b.min_x - a.min_x };
    let fold = if mismatch(pb, pa, shift) < mismatch(pb, pa, mirror) * 0.5 { shift } else { mirror };

    // Parts of the right view are bottom parts, moved with their pins and pads.
    for i in 0..board.parts.len() {
        if center(&board.parts[i].bounds) <= split {
            continue;
        }
        let part = &mut board.parts[i];
        if part.side != Side::Both {
            part.side = Side::Bottom;
        }
        part.outline = part.outline.iter().map(|p| fold.point(*p)).collect();
        for pad in &mut part.pads {
            pad.x = fold.x(pad.x);
        }
        let (first, count) = (part.first_pin as usize, part.pin_count as usize);
        let side = part.side;
        let mut points: Vec<Point> = part.outline.clone();
        for pin in &mut board.pins[first..first + count] {
            pin.x = fold.x(pin.x);
            if pin.side != Side::Both {
                pin.side = side;
            }
            if let (Some(pad), true) = (pin.pad.as_mut(), fold.mirrors()) {
                pad.angle = (180.0 - pad.angle).rem_euclid(360.0);
            }
            points.push(Point { x: pin.x - pin.radius, y: pin.y - pin.radius });
            points.push(Point { x: pin.x + pin.radius, y: pin.y + pin.radius });
        }
        let part = &mut board.parts[i];
        part.bounds = bounds_of(&points);
    }

    // Copper of the right view: tracks and vias into the board's frame; a via
    // both views show is kept once.
    for t in &mut board.traces {
        if (t.x1 + t.x2) / 2.0 > split {
            t.x1 = fold.x(t.x1);
            t.x2 = fold.x(t.x2);
        }
    }
    let mut keep = vec![true; board.test_points.len()];
    let mut left: std::collections::HashMap<(i64, i64, u32), usize> = std::collections::HashMap::new();
    let cell = |v: f64| (v / 2.0).round() as i64;
    for (i, tp) in board.test_points.iter().enumerate() {
        if tp.x <= split {
            left.insert((cell(tp.x), cell(tp.y), tp.net), i);
        }
    }
    for (i, tp) in board.test_points.iter_mut().enumerate() {
        if tp.x <= split {
            continue;
        }
        tp.x = fold.x(tp.x);
        if tp.side == Side::Top {
            tp.side = Side::Bottom;
        }
        if left.contains_key(&(cell(tp.x), cell(tp.y), tp.net)) {
            keep[i] = false;
        }
    }
    if keep.iter().any(|k| !k) {
        let mut index = vec![u32::MAX; keep.len()];
        let mut next = 0u32;
        for (i, k) in keep.iter().enumerate() {
            if *k {
                index[i] = next;
                next += 1;
            }
        }
        let mut i = 0;
        board.test_points.retain(|_| {
            let k = keep[i];
            i += 1;
            k
        });
        for net in &mut board.nets {
            net.test_points = net
                .test_points
                .iter()
                .filter_map(|&t| index.get(t as usize).copied().filter(|&n| n != u32::MAX))
                .collect();
        }
    }

    // One outline: the left view, with holes and cut-outs of the right one moved over.
    let mut outline = Vec::new();
    for (i, poly) in board.outline.iter().enumerate() {
        if i == ib {
            continue;
        }
        let in_right = Frame::of(poly).is_some_and(|f| (f.min_x + f.max_x) / 2.0 > split);
        if in_right {
            let moved: Vec<Point> = poly.iter().map(|p| fold.point(*p)).collect();
            // Features drawn in both views would now lie twice on top of each other.
            if !board
                .outline
                .iter()
                .any(|q| q.len() == moved.len() && mismatch(&moved, q, Fold::Shift { dx: 0.0 }) < 1.0)
            {
                outline.push(moved);
            }
        } else {
            outline.push(poly.clone());
        }
    }
    board.outline = outline;
    board.bounds = bounds_of(&board.outline.iter().flatten().copied().collect::<Vec<_>>());
    board.warnings.push(format!(
        "Two views side by side: the right one was folded onto the board as the bottom side ({}).",
        if fold.mirrors() { "mirrored" } else { "shifted" }
    ));
    let bottom = board.parts.iter().filter(|p| p.side == Side::Bottom).count();
    board.derived.push(crate::model::Derived {
        what: "bottom-side",
        how: format!(
            "the second view of the drawing, {}",
            if fold.mirrors() { "mirrored" } else { "shifted" }
        ),
        count: bottom,
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The demo board drawn the XZZ way: its bottom parts (and a via) mirrored
    /// into a second view to the right of the board.
    fn two_views() -> (Board, Board) {
        let original = crate::demo::board();
        let mut board = original.clone();
        let f = Frame::of(&board.outline[0]).unwrap();
        let gap = 100.0;
        let to_view = |x: f64| f.max_x + gap + (f.max_x - x);
        let mirrored: Vec<Point> =
            board.outline[0].iter().map(|p| Point { x: to_view(p.x), y: p.y }).collect();
        board.outline.push(mirrored);
        for i in 0..board.parts.len() {
            if board.parts[i].side != Side::Bottom {
                continue;
            }
            let part = &mut board.parts[i];
            part.side = Side::Top;
            part.outline = part.outline.iter().map(|p| Point { x: to_view(p.x), y: p.y }).collect();
            let (min_x, max_x) = (to_view(part.bounds.max_x), to_view(part.bounds.min_x));
            part.bounds.min_x = min_x;
            part.bounds.max_x = max_x;
            let (first, count) = (part.first_pin as usize, part.pin_count as usize);
            for pin in &mut board.pins[first..first + count] {
                pin.x = to_view(pin.x);
                pin.side = Side::Top;
            }
        }
        (original, board)
    }

    #[test]
    fn folds_the_bottom_view_back_onto_the_board() {
        let (original, mut board) = two_views();
        assert!(fold_side_by_side(&mut board));
        assert_eq!(board.outline.len(), original.outline.len());
        for (a, b) in original.parts.iter().zip(&board.parts) {
            assert_eq!(a.side, b.side, "{}", a.name);
        }
        for (a, b) in original.pins.iter().zip(&board.pins) {
            assert!((a.x - b.x).abs() < 1e-6 && (a.y - b.y).abs() < 1e-6);
        }
        assert!((board.bounds.max_x - original.bounds.max_x).abs() < 1.0);
        assert!(board.derived.iter().any(|d| d.what == "bottom-side"));
        // Once folded, nothing more to do.
        assert!(!fold_side_by_side(&mut board));
    }

    #[test]
    fn leaves_ordinary_boards_alone() {
        let mut board = crate::demo::board();
        assert!(!fold_side_by_side(&mut board));
    }
}
