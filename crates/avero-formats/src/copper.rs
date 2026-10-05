//! Copper from a second reading of the same board: tracks, layers and vias
//! another reader found (XZZ's GenCAD conversion) added to a board that has
//! parts and pins but no routing. The two readings may use different
//! origins, scales or a mirrored axis, so the frame is fitted on pins both
//! have (same part, same pin number) and checked before anything is added.

use std::collections::HashMap;

use crate::model::{Board, TestPointKind};

/// Pins two readings share, at most this far off after fitting (mils), count as one frame.
const MAX_MEDIAN_ERROR: f64 = 2.0;

/// x' = a·x + b, fitted by least squares.
#[derive(Clone, Copy, Debug)]
struct Axis {
    a: f64,
    b: f64,
}

impl Axis {
    fn fit(pairs: &[(f64, f64)]) -> Option<Axis> {
        let n = pairs.len() as f64;
        let (sx, sy) = pairs.iter().fold((0.0, 0.0), |(sx, sy), (x, y)| (sx + x, sy + y));
        let (mx, my) = (sx / n, sy / n);
        let (mut sxx, mut sxy) = (0.0, 0.0);
        for (x, y) in pairs {
            sxx += (x - mx) * (x - mx);
            sxy += (x - mx) * (y - my);
        }
        if sxx <= f64::EPSILON {
            return None;
        }
        let a = sxy / sxx;
        Some(Axis { a, b: my - a * mx })
    }
    fn at(self, x: f64) -> f64 {
        self.a * x + self.b
    }
}

/// Adds `source`'s tracks, layers and vias to `target` in `target`'s frame.
/// Returns how many tracks and vias were added; an error when the two
/// readings do not line up (then nothing is changed).
pub fn add_copper_from(target: &mut Board, source: &Board) -> Result<(usize, usize), String> {
    if source.traces.is_empty() && source.test_points.is_empty() {
        return Ok((0, 0));
    }
    // Pins of the same part and number in both readings.
    let parts: HashMap<&str, usize> =
        source.parts.iter().enumerate().map(|(i, p)| (p.name.as_str(), i)).collect();
    let (mut xs, mut ys) = (Vec::new(), Vec::new());
    for (i, part) in target.parts.iter().enumerate() {
        let Some(&j) = parts.get(part.name.as_str()) else { continue };
        let theirs: HashMap<&str, (f64, f64)> =
            source.part_pins(j).iter().map(|p| (p.number.as_str(), (p.x, p.y))).collect();
        for pin in target.part_pins(i) {
            if let Some(&(x, y)) = theirs.get(pin.number.as_str()) {
                xs.push((x, pin.x));
                ys.push((y, pin.y));
            }
        }
    }
    if xs.len() < 3 {
        return Err("too few pins in common to line up the two readings".into());
    }
    let (fx, fy) = (Axis::fit(&xs), Axis::fit(&ys));
    let (Some(fx), Some(fy)) = (fx, fy) else { return Err("the shared pins do not span the board".into()) };
    let scale_ok = |a: f64| (0.5..=2.0).contains(&a.abs());
    if !scale_ok(fx.a) || !scale_ok(fy.a) {
        return Err(format!("the readings differ in scale ({:.3}, {:.3})", fx.a, fy.a));
    }
    let mut errors: Vec<f64> =
        xs.iter().zip(&ys).map(|((sx, tx), (sy, ty))| (fx.at(*sx) - tx).hypot(fy.at(*sy) - ty)).collect();
    errors.sort_by(f64::total_cmp);
    let median = errors[errors.len() / 2];
    if median > MAX_MEDIAN_ERROR {
        return Err(format!("the readings do not line up (pins {median:.1} mil apart)"));
    }

    let nets: HashMap<String, u32> =
        target.nets.iter().enumerate().map(|(i, n)| (n.name.to_uppercase(), i as u32)).collect();
    let net_of = |i: u32| source.nets.get(i as usize).and_then(|n| nets.get(&n.name.to_uppercase())).copied();

    let mut traces = 0;
    if target.traces.is_empty() {
        if target.layers.is_empty() {
            target.layers = source.layers.clone();
        }
        for t in &source.traces {
            let Some(net) = net_of(t.net) else { continue };
            let mut copy = t.clone();
            copy.x1 = fx.at(t.x1);
            copy.x2 = fx.at(t.x2);
            copy.y1 = fy.at(t.y1);
            copy.y2 = fy.at(t.y2);
            copy.width = t.width * fx.a.abs();
            copy.net = net;
            target.nets[net as usize].traces.push(target.traces.len() as u32);
            target.traces.push(copy);
            traces += 1;
        }
    }
    // Vias the target does not have yet (same net, within 2 mil).
    let cell = |v: f64| (v / 2.0).round() as i64;
    let mut known: std::collections::HashSet<(i64, i64, u32)> =
        target.test_points.iter().map(|t| (cell(t.x), cell(t.y), t.net)).collect();
    let mut vias = 0;
    for tp in source.test_points.iter().filter(|t| t.kind == TestPointKind::Via) {
        let Some(net) = net_of(tp.net) else { continue };
        let (x, y) = (fx.at(tp.x), fy.at(tp.y));
        if !known.insert((cell(x), cell(y), net)) {
            continue;
        }
        let mut copy = tp.clone();
        copy.x = x;
        copy.y = y;
        copy.radius = tp.radius * fx.a.abs();
        copy.net = net;
        target.nets[net as usize].test_points.push(target.test_points.len() as u32);
        target.test_points.push(copy);
        vias += 1;
    }
    Ok((traces, vias))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_tracks_and_vias_in_the_targets_frame() {
        let mut target_original = crate::demo::board();
        // A track from each of the first pins to the next, on its net.
        let pins = target_original.pins.clone();
        for w in pins.windows(2).take(20) {
            target_original.traces.push(crate::model::Trace {
                x1: w[0].x,
                y1: w[0].y,
                x2: w[1].x,
                y2: w[1].y,
                width: 8.0,
                side: crate::model::Side::Top,
                layer: 0,
                net: w[0].net,
            });
        }
        let mut target = target_original.clone();
        target.traces.clear();
        target.layers.clear();
        for n in &mut target.nets {
            n.traces.clear();
        }
        // The same board read another way: shifted and mirrored in x.
        let mut source = target_original.clone();
        let move_x = |x: f64| 5000.0 - x;
        for p in &mut source.pins {
            p.x = move_x(p.x);
            p.y += 300.0;
        }
        for t in &mut source.traces {
            t.x1 = move_x(t.x1);
            t.x2 = move_x(t.x2);
            t.y1 += 300.0;
            t.y2 += 300.0;
        }
        for t in &mut source.test_points {
            t.x = move_x(t.x);
            t.y += 300.0;
        }
        let (traces, _) = add_copper_from(&mut target, &source).unwrap();
        assert_eq!(traces, 20);
        assert_eq!(target.traces.len(), 20);
        for (a, b) in target_original.traces.iter().zip(&target.traces) {
            assert!((a.x1 - b.x1).abs() < 1e-6 && (a.y2 - b.y2).abs() < 1e-6);
        }
    }

    #[test]
    fn refuses_readings_that_do_not_line_up() {
        let mut target = crate::demo::board();
        target.traces.clear();
        let mut source = crate::demo::board();
        for (i, p) in source.pins.iter_mut().enumerate() {
            p.x += (i % 7) as f64 * 40.0;
        }
        assert!(add_copper_from(&mut target, &source).is_err());
        assert!(target.traces.is_empty());
    }
}
