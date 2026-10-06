//! The normalized board model every reader produces.
//!
//! All coordinates are in mils (thousandths of an inch), the unit most
//! boardview formats use natively. The Y axis points up, as in CAD tools.

use serde::Serialize;

/// Which side of the board something sits on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Top,
    Bottom,
    /// Through-hole parts and pins are reachable from both sides.
    Both,
}

impl Side {
    pub fn is_visible_from(self, view: Side) -> bool {
        self == Side::Both || view == Side::Both || self == view
    }
}

/// How a part is mounted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mount {
    Smd,
    #[serde(rename = "th")]
    ThroughHole,
}

/// Rough classification of a net, used for coloring and filtering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NetKind {
    Signal,
    Ground,
    Power,
    /// Pins that are explicitly not connected to anything.
    Unconnected,
}

/// Probe points that are not part pins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TestPointKind {
    /// Test pad or bed-of-nails probe location.
    Nail,
    Via,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn distance(self, other: Point) -> f64 {
        (self.x - other.x).hypot(self.y - other.y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Bounds {
    pub const EMPTY: Bounds = Bounds {
        min_x: f64::INFINITY,
        min_y: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        max_y: f64::NEG_INFINITY,
    };

    pub fn is_empty(&self) -> bool {
        self.min_x > self.max_x || self.min_y > self.max_y
    }

    pub fn include(&mut self, p: Point) {
        self.min_x = self.min_x.min(p.x);
        self.min_y = self.min_y.min(p.y);
        self.max_x = self.max_x.max(p.x);
        self.max_y = self.max_y.max(p.y);
    }

    pub fn expand(&mut self, margin: f64) {
        self.min_x -= margin;
        self.min_y -= margin;
        self.max_x += margin;
        self.max_y += margin;
    }

    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn height(&self) -> f64 {
        self.max_y - self.min_y
    }

    pub fn from_points<'a>(points: impl IntoIterator<Item = &'a Point>) -> Bounds {
        let mut b = Bounds::EMPTY;
        for p in points {
            b.include(*p);
        }
        b
    }
}

/// Package family of a part, when known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Package {
    /// Two-terminal chip: capacitor or resistor.
    Passive,
    Inductor,
    Diode,
    Crystal,
    Ic,
    Connector,
}

/// A pad drawn for the part's shape only; it has no pin and no net.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PadMark {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub name: String,
    pub side: Side,
    pub mount: Mount,
    /// Index of the first pin in [`Board::pins`]. A part's pins are contiguous.
    pub first_pin: u32,
    pub pin_count: u32,
    /// Closed polygon around the part body.
    pub outline: Vec<Point>,
    pub bounds: Bounds,
    /// Device, value or manufacturer code, when the file provides one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    /// Only the position is known (no pins, no body): drawn as a marker.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub marker: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<Package>,
    /// Body, side, pads and pins were estimated from the copper.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub estimated: bool,
    /// Pads without pin, for the part's shape.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pads: Vec<PadMark>,
}

/// A pad's shape where the file gives one: size in mils, rotation in
/// degrees counter-clockwise, `round` for pads with rounded ends (oblong).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadShape {
    pub w: f64,
    pub h: f64,
    pub angle: f64,
    pub round: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    /// Index into [`Board::parts`].
    pub part: u32,
    /// Pin designator such as `1`, `A12` or `GND`.
    pub number: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub side: Side,
    /// Index into [`Board::nets`].
    pub net: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<i32>,
    /// Shape of a pad that is no plain circle (rectangles, oblongs, polygons).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pad: Option<PadShape>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestPoint {
    pub kind: TestPointKind,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub side: Side,
    pub net: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A straight copper track segment, from formats that carry routing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub width: f64,
    /// Outer layer the track is on; `Both` marks an inner layer.
    pub side: Side,
    /// Index into [`Board::layers`].
    pub layer: u32,
    pub net: u32,
}

/// A copper layer that carries traces, ordered top to bottom.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub name: String,
    /// `Both` for inner layers.
    pub side: Side,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Net {
    pub name: String,
    pub kind: NetKind,
    pub pins: Vec<u32>,
    pub test_points: Vec<u32>,
    /// Indices into [`Board::traces`].
    pub traces: Vec<u32>,
    /// Ground by its vias across the whole board, not by its name.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub assumed_ground: bool,
}

/// Identifies the file format a board was read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FormatId {
    Brd,
    Brd2,
    Bdv,
    Asc,
    Bvr,
    Bvr3,
    Cad,
    GenCad,
    Cst,
    Xzz,
    Fz,
    Cae,
    KiCad,
    Eagle,
    Altium,
    AllegroAscii,
    Demo,
}

impl FormatId {
    pub fn display_name(self) -> &'static str {
        match self {
            FormatId::Brd => "Test_Link BRD",
            FormatId::Brd2 => "BRD2 (BRDOUT)",
            FormatId::Bdv => "Honhan BDV",
            FormatId::Asc => "ASUS ASC",
            FormatId::Bvr => "BoardViewer BVR",
            FormatId::Bvr3 => "BoardViewer BVR3",
            FormatId::Cad => "Panel CAD",
            FormatId::GenCad => "GenCAD",
            FormatId::Cst => "IBM CST",
            FormatId::Xzz => "XinZhiZao PCB",
            FormatId::Fz => "ASUS FZ",
            FormatId::Cae => "CAE",
            FormatId::KiCad => "KiCad",
            FormatId::Eagle => "EAGLE / Fusion 360",
            FormatId::Altium => "Altium PCB ASCII",
            FormatId::AllegroAscii => "Allegro ASCII / Fabmaster",
            FormatId::Demo => "Avero demo board",
        }
    }
}

/// Data Avero added or reconstructed rather than read as such from the
/// file, so it is never shown as part of the original data set.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Derived {
    /// What it is: `"outline"`, `"copper"`, `"bottom-side"`.
    pub what: &'static str,
    /// How it was made, e.g. "a box around the pins and copper".
    pub how: String,
    /// How many items (tracks, parts …) it concerns.
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub format: FormatId,
    pub format_name: String,
    /// Always `"mil"`. Kept in the data so consumers never have to guess.
    pub unit: &'static str,
    /// Board edge as one or more polylines.
    pub outline: Vec<Vec<Point>>,
    pub bounds: Bounds,
    pub parts: Vec<Part>,
    pub pins: Vec<Pin>,
    pub test_points: Vec<TestPoint>,
    /// Copper tracks; empty for most boardview formats.
    pub traces: Vec<Trace>,
    /// Layers the tracks are on, top first.
    pub layers: Vec<Layer>,
    pub nets: Vec<Net>,
    /// Problems that did not prevent loading, such as skipped lines.
    pub warnings: Vec<String>,
    /// Parts left out because they are encrypted and no key was given
    /// (XinZhiZao without key): the board shows outline and test points only.
    pub locked_parts: u32,
    /// What Avero added or reconstructed (see [`Derived`]).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub derived: Vec<Derived>,
}

impl Board {
    pub fn part_pins(&self, part: usize) -> &[Pin] {
        let p = &self.parts[part];
        let start = p.first_pin as usize;
        &self.pins[start..start + p.pin_count as usize]
    }

    pub fn find_part(&self, name: &str) -> Option<usize> {
        self.parts.iter().position(|p| p.name == name)
    }

    pub fn find_net(&self, name: &str) -> Option<usize> {
        self.nets.iter().position(|n| n.name == name)
    }
}
