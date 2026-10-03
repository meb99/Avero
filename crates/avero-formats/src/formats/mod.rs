//! One module per file format, plus detection.

pub(crate) mod asc;
pub(crate) mod brd;
pub(crate) mod brd2;
pub(crate) mod bvr;
pub(crate) mod cad;
pub(crate) mod cst;
pub(crate) mod eagle;
pub(crate) mod fz;
pub(crate) mod gencad;
pub(crate) mod kicad;
pub(crate) mod xzz;

/// Obfuscation used by `.bdv` files; exposed for tests and tooling.
pub use asc::{decode_bdv, encode_bdv};
/// Obfuscation used by some `.brd` files; exposed for tests and tooling.
pub use brd::{decode as decode_brd, encode as encode_brd};
/// FZ key handling; `fz_encrypt` builds test files.
pub use fz::{
    assign_keys as assign_fz_keys, encrypt as fz_encrypt, key_fits as fz_key_fits,
    key_is_plausible as fz_key_is_plausible, parse_key as parse_fz_key, parse_keys as parse_fz_keys, FzKey,
    Variant as FzVariant,
};
/// XZZ key handling; `des_encrypt` builds test files.
pub use xzz::{
    des_encrypt as xzz_encrypt, key_is_plausible as xzz_key_is_plausible, parse_key as parse_xzz_key,
};

use serde::Serialize;

use crate::model::FormatId;

/// Result of looking at a file before parsing it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detected {
    Supported(FormatId),
    /// ASUS ASC boards are split over `format.asc`, `pins.asc` and
    /// `nails.asc`; the caller has to supply all of them.
    AscBundle,
    /// A known format Avero cannot read (yet).
    Unsupported(&'static str),
    /// A PDF, most likely a schematic.
    Pdf,
    Unknown,
}

fn extension(file_name: Option<&str>) -> String {
    file_name.and_then(|n| n.rsplit_once('.')).map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default()
}

/// Identifies a file by content first and extension second, in the same
/// order as OpenBoardView so that ambiguous files resolve the same way.
pub fn detect(buf: &[u8], file_name: Option<&str>) -> Detected {
    let ext = extension(file_name);

    if buf.starts_with(b"%PDF") {
        return Detected::Pdf;
    }
    match ext.as_str() {
        "fz" => return Detected::Supported(FormatId::Fz),
        "cae" => return Detected::Supported(FormatId::Cae),
        "tvw" => return Detected::Unsupported("Teboview TVW"),
        // Altium's binary design files (an OLE compound document).
        "pcbdoc" if buf.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) => {
            return Detected::Unsupported("Altium PcbDoc")
        }
        "asc" | "bom" => return Detected::AscBundle,
        _ => {}
    }
    if kicad::detect(buf) {
        return Detected::Supported(FormatId::KiCad);
    }
    if eagle::detect(buf) {
        return Detected::Supported(FormatId::Eagle);
    }
    if gencad::detect(buf) {
        return Detected::Supported(FormatId::GenCad);
    }
    if cad::detect(buf) {
        return Detected::Supported(FormatId::Cad);
    }
    if ext == "cst" {
        return Detected::Supported(FormatId::Cst);
    }
    if brd::detect(buf) {
        return Detected::Supported(FormatId::Brd);
    }
    if brd2::detect(buf) {
        return Detected::Supported(FormatId::Brd2);
    }
    if asc::detect_bdv(buf) {
        return Detected::Supported(FormatId::Bdv);
    }
    if bvr::detect_v1(buf) {
        return Detected::Supported(FormatId::Bvr);
    }
    if bvr::detect_v3(buf) {
        return Detected::Supported(FormatId::Bvr3);
    }
    if is_allegro(buf) {
        return Detected::Unsupported("Cadence Allegro");
    }
    if xzz::detect(buf) {
        return Detected::Supported(FormatId::Xzz);
    }
    Detected::Unknown
}

/// Allegro databases carry "all" or "vie" plus a version at offset 0xF8.
fn is_allegro(buf: &[u8]) -> bool {
    buf.get(0xf8..0xfb).is_some_and(|tag| tag == b"all" || tag == b"vie")
}

/// Description of a readable format for the UI's "supported formats" list.
#[derive(Debug, Clone, Serialize)]
pub struct FormatInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub extensions: &'static [&'static str],
}

pub const SUPPORTED: &[FormatInfo] = &[
    FormatInfo { id: "brd", name: "Test_Link BRD", extensions: &["brd"] },
    FormatInfo { id: "brd2", name: "BRD2 (BRDOUT)", extensions: &["brd", "gr"] },
    FormatInfo { id: "bdv", name: "Honhan BDV", extensions: &["bdv"] },
    FormatInfo { id: "asc", name: "ASUS ASC", extensions: &["asc"] },
    FormatInfo { id: "bvr", name: "BoardViewer BVR", extensions: &["bvr"] },
    FormatInfo { id: "bvr3", name: "BoardViewer BVR3", extensions: &["bvr", "bvr3"] },
    FormatInfo { id: "cad", name: "Panel CAD", extensions: &["cad"] },
    FormatInfo { id: "gencad", name: "GenCAD 1.4", extensions: &["cad", "gcd", "gencad"] },
    FormatInfo { id: "cst", name: "IBM CST", extensions: &["cst"] },
    FormatInfo { id: "xzz", name: "XinZhiZao PCB", extensions: &["pcb"] },
    FormatInfo { id: "fz", name: "ASUS FZ", extensions: &["fz"] },
    FormatInfo { id: "cae", name: "CAE", extensions: &["cae"] },
    FormatInfo { id: "kicad", name: "KiCad", extensions: &["kicad_pcb"] },
    FormatInfo { id: "eagle", name: "EAGLE / Fusion 360", extensions: &["brd"] },
];

/// Every extension the open dialog should offer.
pub fn extensions() -> Vec<&'static str> {
    let mut all: Vec<&'static str> = SUPPORTED.iter().flat_map(|f| f.extensions.iter().copied()).collect();
    all.sort_unstable();
    all.dedup();
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_xzz_with_xor_header() {
        let mut buf = vec![0u8; 0x20];
        buf[0x10] = 0x5a;
        for (i, b) in b"XZZPCB".iter().enumerate() {
            buf[i] = b ^ 0x5a;
        }
        assert_eq!(detect(&buf, Some("board.pcb")), Detected::Supported(FormatId::Xzz));
    }

    #[test]
    fn extension_decides_asc_and_pdf() {
        assert_eq!(detect(b"anything", Some("PINS.ASC")), Detected::AscBundle);
        assert_eq!(detect(b"%PDF-1.7", Some("schematic.pdf")), Detected::Pdf);
        assert_eq!(detect(b"hello", Some("notes.txt")), Detected::Unknown);
    }
}
