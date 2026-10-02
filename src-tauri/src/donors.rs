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
    if wanted.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for (index, part) in board.parts.iter().enumerate() {
        let Some(device) = part.device.as_deref() else { continue };
        let pins = board.part_pins(index);
        let score = if normalize(device) == wanted {
            2
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
