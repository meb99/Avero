//! Readers for the boardview formats used in electronics repair.
//!
//! Every reader produces the same normalized [`Board`]: parts with their pins,
//! test points, nets and the board outline, with coordinates in mils.
//!
//! ```
//! let board = avero_formats::demo::board();
//! assert!(board.parts.len() > 50);
//! let json = serde_json::to_string(&board).unwrap();
//! assert!(json.contains("\"unit\":\"mil\""));
//! ```

mod builder;
pub mod convert;
pub mod copper;
pub mod demo;
pub mod fold;
pub mod formats;
mod infer;
pub mod model;
mod text;

pub use builder::{classify_net, UNCONNECTED};
pub use formats::xzz::{attach_readings as attach_xzz_readings, readings as xzz_readings, FileReadings};
pub use formats::{detect, Detected, FormatInfo};
pub use model::*;

use formats::asc::AscSections;

/// Files larger than this are refused before parsing. Real boardview files
/// are a few megabytes; this only guards against opening the wrong file.
pub const MAX_FILE_SIZE: usize = 512 * 1024 * 1024;

/// The companion files of an ASUS ASC board, in the order [`parse_asc`] takes them.
pub const ASC_FILES: [&str; 3] = ["format.asc", "pins.asc", "nails.asc"];

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ParseError {
    #[error("The file is empty.")]
    Empty,
    #[error("The file is too large to be a boardview file.")]
    TooLarge,
    #[error("This is not a boardview format Avero can read.")]
    Unrecognized,
    #[error("This is a PDF. Open it as a schematic.")]
    Pdf,
    #[error("{0} files are not supported yet.")]
    Unsupported(&'static str),
    #[error("ASC boards are split over format.asc, pins.asc and nails.asc. Open all of them together.")]
    NeedsAscFiles,
    #[error("The {format} file could not be read: {message}")]
    Invalid { format: &'static str, message: String },
    #[error("The file contains no parts or pins.")]
    NoContent,
    #[error("This XZZ file is encrypted. Enter the XZZ key in the settings.")]
    NeedsKey,
    #[error("The XZZ key is not valid.")]
    InvalidKey,
    #[error("This FZ file is encrypted. Enter the FZ key in the settings.")]
    NeedsFzKey,
    #[error("This CAE file is encrypted. Enter the CAE key in the settings.")]
    NeedsCaeKey,
    #[error("The FZ key is not valid for this file.")]
    InvalidFzKey,
    #[error("The CAE key is not valid for this file.")]
    InvalidCaeKey,
    #[error("All {0} parts of this XZZ file are encrypted and it has no test pads; it needs the XZZ key.")]
    XzzAllLocked(u32),
}

impl ParseError {
    pub(crate) fn invalid(format: FormatId, message: impl Into<String>) -> Self {
        ParseError::Invalid { format: format.display_name(), message: message.into() }
    }

    /// Stable identifier the UI uses to pick a translated message.
    pub fn code(&self) -> &'static str {
        match self {
            ParseError::Empty => "empty",
            ParseError::TooLarge => "too-large",
            ParseError::Unrecognized => "unrecognized",
            ParseError::Pdf => "pdf",
            ParseError::Unsupported(_) => "unsupported",
            ParseError::NeedsAscFiles => "needs-asc-files",
            ParseError::Invalid { .. } => "invalid",
            ParseError::NoContent => "no-content",
            ParseError::NeedsKey => "needs-key",
            ParseError::InvalidKey => "invalid-key",
            ParseError::NeedsFzKey => "needs-fz-key",
            ParseError::InvalidFzKey => "invalid-fz-key",
            ParseError::NeedsCaeKey => "needs-cae-key",
            ParseError::InvalidCaeKey => "invalid-cae-key",
            ParseError::XzzAllLocked(_) => "xzz-all-locked",
        }
    }

    /// The format involved, when there is one.
    pub fn format(&self) -> Option<&'static str> {
        match self {
            ParseError::Unsupported(f) | ParseError::Invalid { format: f, .. } => Some(f),
            _ => None,
        }
    }
}

/// Settings some formats need.
#[derive(Debug, Clone, Copy, Default)]
pub struct ParseOptions {
    /// DES key for the direct XinZhiZao reader. The separate converter has
    /// its own compatibility default.
    pub xzz_key: Option<u64>,
    /// RC6 key schedule for ASUS `.fz` files. Avero does not ship one.
    pub fz_key: Option<formats::FzKey>,
    pub cae_key: Option<formats::FzKey>,
}

/// Reads a boardview file. `file_name` is used to resolve formats that can
/// only be told apart by extension.
pub fn parse(buf: &[u8], file_name: Option<&str>) -> Result<Board, ParseError> {
    parse_with(buf, file_name, ParseOptions::default())
}

/// [`parse`] with format options such as the XZZ key.
pub fn parse_with(buf: &[u8], file_name: Option<&str>, options: ParseOptions) -> Result<Board, ParseError> {
    if buf.is_empty() {
        return Err(ParseError::Empty);
    }
    if buf.len() > MAX_FILE_SIZE {
        return Err(ParseError::TooLarge);
    }
    let raw = match detect(buf, file_name) {
        Detected::Supported(format) => match format {
            FormatId::Brd => formats::brd::parse(buf),
            FormatId::Brd2 => formats::brd2::parse(buf),
            FormatId::Bdv => formats::asc::parse_bdv(buf),
            FormatId::Bvr => formats::bvr::parse_v1(buf),
            FormatId::Bvr3 => formats::bvr::parse_v3(buf),
            FormatId::Cad => formats::cad::parse(buf),
            FormatId::GenCad => formats::gencad::parse(buf),
            FormatId::Cst => formats::cst::parse(buf),
            FormatId::Xzz => formats::xzz::parse(buf, options.xzz_key),
            FormatId::Fz => formats::fz::parse(buf, options.fz_key.as_ref()),
            FormatId::Cae => {
                formats::fz::parse_variant(buf, options.cae_key.as_ref(), formats::fz::Variant::Cae)
            }
            FormatId::KiCad => formats::kicad::parse(buf),
            FormatId::Eagle => formats::eagle::parse(buf),
            FormatId::Altium => formats::altium::parse(buf),
            FormatId::AllegroAscii => formats::allegro_ascii::parse(buf),
            FormatId::Asc | FormatId::Demo => Err(ParseError::Unrecognized),
        },
        Detected::AscBundle => Err(ParseError::NeedsAscFiles),
        Detected::Unsupported(name) => Err(ParseError::Unsupported(name)),
        Detected::Pdf => Err(ParseError::Pdf),
        Detected::Unknown => Err(ParseError::Unrecognized),
    }?;
    let mut board = finish(raw)?;
    if board.format == FormatId::GenCad {
        convert::archive::restore(&mut board, buf)?;
    }
    Ok(board)
}

/// Reads an ASUS ASC board from its separate files. Only `pins.asc` is
/// required; without `format.asc` the outline is derived from the pins.
pub fn parse_asc(format: Option<&[u8]>, pins: &[u8], nails: Option<&[u8]>) -> Result<Board, ParseError> {
    let raw = formats::asc::parse_sections(FormatId::Asc, AscSections { format, pins: Some(pins), nails })?;
    finish(raw)
}

fn finish(raw: builder::RawBoard) -> Result<Board, ParseError> {
    let board = raw.build();
    if board.parts.is_empty() && board.pins.is_empty() && board.test_points.is_empty() {
        return Err(ParseError::NoContent);
    }
    Ok(board)
}
