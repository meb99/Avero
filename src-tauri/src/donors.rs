//! Finding a part on other boards (donor boards): the same device, or the
//! same part number, with the pins compared by what their nets are
//! (ground, power, signal, free), so a look-alike with another pinout is
//! told apart from a real fit.

use avero_formats::{Board, NetKind};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DonorQuery {
    pub device: String,
    pub pin_count: usize,
    /// Pin number and net kind letter (G ground, P power, S signal, U free).
    pub pins: Vec<(String, char)>,
    /// The board being repaired, left out of the search.
    pub exclude: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DonorHit {
    pub path: String,
    pub part: String,
    pub device: String,
    pub pin_count: usize,
    /// 2 = same device text, 1 = same part number.
    pub score: u8,
    /// Share of pins whose net kind matches (0–1); None without pins to compare.
    pub pin_match: Option<f64>,
}

/// Upper case without separators: "RC0402_10K 1%" → "RC040210K1%".
fn normalize(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric() || *c == '%' || *c == '.').flat_map(char::to_uppercase).collect()
}

/// Part numbers in a device text: words of five or more characters with letters and digits.
pub fn part_numbers(device: &str) -> Vec<String> {
    device
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .map(|w| w.trim_matches('-').to_uppercase())
        .filter(|w| {
            w.len() >= 5
                && w.chars().any(|c| c.is_ascii_digit())
                && w.chars().filter(|c| c.is_ascii_alphabetic()).count() >= 2
        })
        // Footprints and packages are no part numbers.
        .filter(|w| {
            !w.starts_with("SOT")
                && !w.starts_with("QFN")
                && !w.starts_with("BGA")
                && !w.starts_with("SOIC")
                && !w.starts_with("DFN")
        })
        .collect()
}

/// The value of a resistor, capacitor or coil in a device text, as (kind, base
/// units): "RC0402 10K 1%" → ('R', 10000), "4U7_0603" → ('C', 4.7e-6),
/// "2.2UH" → ('L', 2.2e-6). None for anything that is no passive value.
pub fn passive_value(device: &str) -> Option<(char, f64)> {
    let upper = device.to_uppercase().replace(['Μ', 'µ'], "U");
    for token in upper.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.')) {
        let t = token.trim_end_matches("OHMS").trim_end_matches("OHM");
        let ohms_written = t.len() != token.len();
        let digits_end = t.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(t.len());
        if digits_end == 0 {
            continue;
        }
        if digits_end == t.len() {
            // "10OHM" is a value; a bare number ("0402") is a case code or a count.
            if ohms_written {
                if let Ok(v) = t.parse::<f64>() {
                    return Some(('R', v));
                }
            }
            continue;
        }
        let (number, rest) = t.split_at(digits_end);
        let mut chars = rest.chars();
        let unit = chars.next()?;
        let tail: String = chars.collect();
        // "4K7", "2R2", "4U7": the letter is the decimal point.
        let (value, tail) = match tail.find(|c: char| !c.is_ascii_digit()) {
            Some(0) | None if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) => {
                (format!("{number}.{tail}").parse::<f64>().ok()?, String::new())
            }
            _ => (number.parse::<f64>().ok()?, tail),
        };
        let scaled = |m: f64| value * m;
        let found = match (unit, tail.as_str()) {
            ('R' | 'E', "") => Some(('R', value)),
            ('K', "") => Some(('R', scaled(1e3))),
            ('M', "") => Some(('R', scaled(1e6))),
            ('P', "" | "F") => Some(('C', scaled(1e-12))),
            ('N', "F") => Some(('C', scaled(1e-9))),
            ('U', "" | "F") => Some(('C', scaled(1e-6))),
            ('N', "H") => Some(('L', scaled(1e-9))),
            ('U', "H") => Some(('L', scaled(1e-6))),
            ('M', "H") => Some(('L', scaled(1e-3))),
            _ => None,
        };
        if found.is_some() {
            return found;
        }
    }
    None
}

/// The imperial case code in a device text ("RC0402 10K" → "0402").
pub fn package_code(device: &str) -> Option<&'static str> {
    const CODES: [&str; 10] =
        ["01005", "0201", "0402", "0603", "0805", "1206", "1210", "1812", "2010", "2512"];
    let bytes = device.as_bytes();
    CODES.into_iter().find(|code| {
        device.match_indices(code).any(|(i, _)| {
            let before = i.checked_sub(1).map(|j| bytes[j]);
            let after = bytes.get(i + code.len()).copied();
            !before.is_some_and(|b| b.is_ascii_digit()) && !after.is_some_and(|b| b.is_ascii_digit())
        })
    })
}

fn same_value(a: f64, b: f64) -> bool {
    (a - b).abs() <= a.abs().max(b.abs()) * 1e-6
}

fn kind_letter(kind: NetKind) -> char {
    match kind {
        NetKind::Ground => 'G',
        NetKind::Power => 'P',
        NetKind::Unconnected => 'U',
        _ => 'S',
    }
}

/// Parts of `board` that fit the query.
pub fn find_in(board: &Board, path: &str, q: &DonorQuery) -> Vec<DonorHit> {
    let wanted = normalize(&q.device);
    let numbers = part_numbers(&q.device);
    // Resistors, capacitors and coils: the value (and the case, when both say it)
    // decides, never a shared series code like "RC0402".
    let value = passive_value(&q.device);
    let package = package_code(&q.device);
    if wanted.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for (index, part) in board.parts.iter().enumerate() {
        let Some(device) = part.device.as_deref() else { continue };
        let pins = board.part_pins(index);
        let score = if normalize(device) == wanted {
            2
        } else if let Some((kind, v)) = value {
            let fits = passive_value(device).is_some_and(|(k, w)| k == kind && same_value(v, w));
            let case_fits = match (package, package_code(device)) {
                (Some(a), Some(b)) => a == b,
                _ => true,
            };
            if fits && case_fits {
                1
            } else {
                continue;
            }
        } else if !numbers.is_empty() && part_numbers(device).iter().any(|n| numbers.contains(n)) {
            1
        } else {
            continue;
        };
        // A chip with another number of pins is another package.
        if q.pin_count > 3 && pins.len() != q.pin_count {
            continue;
        }
        let mut compared = 0usize;
        let mut same = 0usize;
        for (number, kind) in &q.pins {
            if let Some(pin) = pins.iter().find(|p| &p.number == number) {
                compared += 1;
                if kind_letter(board.nets[pin.net as usize].kind) == *kind {
                    same += 1;
                }
            }
        }
        hits.push(DonorHit {
            path: path.to_string(),
            part: part.name.clone(),
            device: device.to_string(),
            pin_count: pins.len(),
            score,
            pin_match: (compared > 0).then(|| same as f64 / compared as f64),
        });
    }
    hits
}

/// Best first: same device text, then how well the pins fit.
pub fn rank(hits: &mut [DonorHit]) {
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(b.pin_match.unwrap_or(0.0).total_cmp(&a.pin_match.unwrap_or(0.0)))
            .then(a.path.cmp(&b.path))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_passive_values() {
        assert_eq!(passive_value("RC0402 10K 1%"), Some(('R', 10_000.0)));
        assert_eq!(passive_value("RC0402 100K 1%"), Some(('R', 100_000.0)));
        assert_eq!(passive_value("4K7_0402"), Some(('R', 4700.0)));
        assert_eq!(passive_value("R0402_0R"), Some(('R', 0.0)));
        let (k, v) = passive_value("100NF_0402_16V").unwrap();
        assert!(k == 'C' && (v - 1e-7).abs() < 1e-15);
        let (k, v) = passive_value("4U7_0603").unwrap();
        assert!(k == 'C' && (v - 4.7e-6).abs() < 1e-12);
        assert_eq!(passive_value("ISL88739AHRZ-T_QFN32"), None);
        assert_eq!(package_code("RC0402 10K"), Some("0402"));
        assert_eq!(package_code("C_10402"), None);
    }

    #[test]
    fn passives_need_the_same_value() {
        let mut board = avero_formats::demo::board();
        let (index, _) = board.parts.iter().enumerate().find(|(_, p)| p.pin_count == 2).unwrap();
        let q =
            |device: &str| DonorQuery { device: device.into(), pin_count: 2, pins: vec![], exclude: None };
        board.parts[index].device = Some("RC0402 100K 1%".into());
        let name = board.parts[index].name.clone();
        assert!(!find_in(&board, "/x", &q("RC0402 10K 1%")).iter().any(|h| h.part == name));
        board.parts[index].device = Some("RES 10K 0402".into());
        assert!(find_in(&board, "/x", &q("RC0402 10K 1%")).iter().any(|h| h.part == name && h.score == 1));
        board.parts[index].device = Some("RES 10K 0603".into());
        assert!(!find_in(&board, "/x", &q("RC0402 10K 1%")).iter().any(|h| h.part == name));
    }

    #[test]
    fn finds_part_numbers_not_packages() {
        assert_eq!(part_numbers("ISL88739AHRZ-T_QFN32_4X4"), vec!["ISL88739AHRZ-T".to_string()]);
        assert!(part_numbers("C_0402").is_empty());
        assert_eq!(part_numbers("AON6414AL DFN8"), vec!["AON6414AL".to_string()]);
    }

    #[test]
    fn finds_donors_with_matching_pins() {
        let board = avero_formats::demo::board();
        let (index, part) = board.parts.iter().enumerate().find(|(_, p)| p.name == "U3200").unwrap();
        let pins: Vec<(String, char)> = board
            .part_pins(index)
            .iter()
            .map(|p| (p.number.clone(), kind_letter(board.nets[p.net as usize].kind)))
            .collect();
        let q =
            DonorQuery { device: part.device.clone().unwrap(), pin_count: pins.len(), pins, exclude: None };
        let hits = find_in(&board, "/demo.brd", &q);
        let own = hits.iter().find(|h| h.part == "U3200").unwrap();
        assert_eq!(own.score, 2);
        assert_eq!(own.pin_match, Some(1.0));
    }
}
