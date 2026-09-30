//! A synthetic phone-style mainboard for trying Avero without real files.
//!
//! Everything here is made up: the parts, the net names and the layout only
//! resemble a real device so that search, net highlighting and side flipping
//! have something meaningful to show. It contains no vendor data.

use crate::builder::{RawBoard, RawPart, RawPin, RawTestPoint};
use crate::model::{Board, FormatId, Mount, Point, Side, TestPointKind};

/// Board size in mils (about 61 × 112 mm).
const W: f64 = 2400.0;
const H: f64 = 4400.0;

pub fn board() -> Board {
    raw().build()
}

const BGA_ROWS: &str = "ABCDEFGHJKLMNPRTUVWY";

struct Demo {
    b: RawBoard,
}

fn rotate(p: Point, deg: f64) -> Point {
    let (s, c) = deg.to_radians().sin_cos();
    Point::new(p.x * c - p.y * s, p.x * s + p.y * c)
}

fn offset(center: Point, local: Point, deg: f64) -> Point {
    let r = rotate(local, deg);
    Point::new(center.x + r.x, center.y + r.y)
}

// Layout helpers take a full placement each; grouping them would only hide it.
#[allow(clippy::too_many_arguments)]
impl Demo {
    fn part(&mut self, name: &str, side: Side, device: &str, pins: Vec<(String, Point, String)>) {
        let mut part = RawPart::new(name, side, Mount::Smd);
        part.device = Some(device.to_string());
        part.pins = pins
            .into_iter()
            .map(|(number, pos, net)| RawPin { pos, net, number: Some(number), ..Default::default() })
            .collect();
        self.b.parts.push(part);
    }

    fn two_pin(
        &mut self,
        name: &str,
        side: Side,
        device: &str,
        center: Point,
        pitch: f64,
        deg: f64,
        nets: [&str; 2],
    ) {
        let pins = vec![
            ("1".to_string(), offset(center, Point::new(-pitch / 2.0, 0.0), deg), nets[0].to_string()),
            ("2".to_string(), offset(center, Point::new(pitch / 2.0, 0.0), deg), nets[1].to_string()),
        ];
        self.part(name, side, device, pins);
    }

    /// Quad flat no-lead package: pins counter-clockwise from the top of the
    /// left edge, plus an exposed ground pad in the middle.
    fn qfn(
        &mut self,
        name: &str,
        side: Side,
        device: &str,
        center: Point,
        pitch: f64,
        deg: f64,
        nets: &[&str],
    ) {
        let per_side = nets.len() / 4;
        let span = (per_side as f64 - 1.0) * pitch;
        let edge = span / 2.0 + pitch * 1.6;
        let mut pins = Vec::with_capacity(nets.len() + 1);
        for (i, net) in nets.iter().enumerate() {
            let (s, k) = (i / per_side, (i % per_side) as f64);
            let t = -span / 2.0 + k * pitch;
            let local = match s {
                0 => Point::new(-edge, -t),
                1 => Point::new(t, -edge),
                2 => Point::new(edge, t),
                _ => Point::new(-t, edge),
            };
            pins.push(((i + 1).to_string(), offset(center, local, deg), (*net).to_string()));
        }
        pins.push(("EP".to_string(), center, "GND".to_string()));
        self.part(name, side, device, pins);
    }

    fn bga(
        &mut self,
        name: &str,
        side: Side,
        device: &str,
        center: Point,
        (rows, cols): (usize, usize),
        pitch: f64,
        net: impl Fn(usize, usize) -> String,
    ) {
        let letters: Vec<char> = BGA_ROWS.chars().collect();
        let mut pins = Vec::with_capacity(rows * cols);
        for (r, letter) in letters.iter().enumerate().take(rows) {
            for c in 0..cols {
                let local = Point::new(
                    (c as f64 - (cols as f64 - 1.0) / 2.0) * pitch,
                    ((rows as f64 - 1.0) / 2.0 - r as f64) * pitch,
                );
                pins.push((format!("{letter}{}", c + 1), offset(center, local, 0.0), net(r, c)));
            }
        }
        self.part(name, side, device, pins);
    }

    fn row(
        &mut self,
        name: &str,
        side: Side,
        device: &str,
        center: Point,
        pitch: f64,
        deg: f64,
        nets: &[&str],
    ) {
        let span = (nets.len() as f64 - 1.0) * pitch;
        let pins = nets
            .iter()
            .enumerate()
            .map(|(i, net)| {
                let local = Point::new(-span / 2.0 + i as f64 * pitch, 0.0);
                ((i + 1).to_string(), offset(center, local, deg), (*net).to_string())
            })
            .collect();
        self.part(name, side, device, pins);
    }

    /// Decoupling capacitors spread along a rectangle around a chip.
    fn caps_around(
        &mut self,
        first: usize,
        side: Side,
        center: Point,
        (half_w, half_h): (f64, f64),
        count: usize,
        rails: &[&str],
        device: &str,
        pitch: f64,
    ) {
        for i in 0..count {
            let t = i as f64 / count as f64;
            let perimeter = 4.0 * t;
            let (local, deg) = match perimeter as usize {
                0 => (Point::new(-half_w + 2.0 * half_w * perimeter.fract(), half_h), 90.0),
                1 => (Point::new(half_w, half_h - 2.0 * half_h * perimeter.fract()), 0.0),
                2 => (Point::new(half_w - 2.0 * half_w * perimeter.fract(), -half_h), 90.0),
                _ => (Point::new(-half_w, -half_h + 2.0 * half_h * perimeter.fract()), 0.0),
            };
            let rail = rails[i % rails.len()];
            let name = format!("C{}", first + i);
            self.two_pin(&name, side, device, offset(center, local, 0.0), pitch, deg, [rail, "GND"]);
        }
    }

    fn test_point(&mut self, probe: i32, pos: Point, side: Side, net: &str) {
        self.b.test_points.push(RawTestPoint {
            kind: TestPointKind::Nail,
            pos,
            side,
            net: net.to_string(),
            probe: Some(probe),
            radius: Some(18.0),
        });
    }
}

fn outline() -> Vec<Point> {
    let r = 180.0;
    let corners = [(W - r, r, -90.0), (W - r, H - r, 0.0), (r, H - r, 90.0), (r, r, 180.0)];
    let mut path = Vec::new();
    for (cx, cy, start) in corners {
        for step in 0..=8 {
            let a = (start + step as f64 * 90.0 / 8.0_f64).to_radians();
            path.push(Point::new(cx + r * a.cos(), cy + r * a.sin()));
        }
    }
    path.push(path[0]);
    path
}

fn circle(center: Point, r: f64) -> Vec<(Point, Point)> {
    let n = 24;
    (0..n)
        .map(|i| {
            let a = |k: usize| std::f64::consts::TAU * k as f64 / n as f64;
            (
                Point::new(center.x + r * a(i).cos(), center.y + r * a(i).sin()),
                Point::new(center.x + r * a(i + 1).cos(), center.y + r * a(i + 1).sin()),
            )
        })
        .collect()
}

fn soc_net(r: usize, c: usize, signals: &[&str]) -> String {
    let n = 14;
    let ring = r.min(c).min(n - 1 - r).min(n - 1 - c);
    match ring {
        0 | 1 => {
            // Walk the two outer rings in a fixed order and hand out signals.
            let idx = ring_index(r, c, n, ring);
            let offset = if ring == 0 { 0 } else { 52 };
            let k = idx + offset;
            if k % 6 == 5 {
                "GND".into()
            } else {
                let s = k - k / 6;
                signals.get(s).map_or_else(|| format!("SOC_GPIO{}", s - signals.len()), |s| (*s).to_string())
            }
        }
        2 | 3 => match (r + c) % 4 {
            0 | 2 => "GND".into(),
            1 => "PP1V8".into(),
            _ => "PP0V9_SOC".into(),
        },
        _ => if (r + c).is_multiple_of(2) { "PP_VCORE" } else { "GND" }.into(),
    }
}

/// Position of a ball along the perimeter of ring `ring` in an n×n grid.
fn ring_index(r: usize, c: usize, n: usize, ring: usize) -> usize {
    let lo = ring;
    let hi = n - 1 - ring;
    let side = hi - lo;
    if r == lo {
        c - lo
    } else if c == hi {
        side + (r - lo)
    } else if r == hi {
        2 * side + (hi - c)
    } else {
        3 * side + (hi - r)
    }
}

fn raw() -> RawBoard {
    let mut d = Demo { b: RawBoard::new(FormatId::Demo) };
    d.b.outline_path = outline();
    d.b.outline_segments.extend(circle(Point::new(220.0, 4180.0), 60.0));
    d.b.outline_segments.extend(circle(Point::new(W - 220.0, 220.0), 60.0));

    let ddr: Vec<String> = (0..16)
        .map(|i| format!("DDR_DQ{i}"))
        .chain((0..10).map(|i| format!("DDR_A{i}")))
        .chain((0..3).map(|i| format!("DDR_BA{i}")))
        .chain(
            [
                "DDR_CLK_P",
                "DDR_CLK_N",
                "DDR_CKE",
                "DDR_CS_L",
                "DDR_WE_L",
                "DDR_RAS_L",
                "DDR_CAS_L",
                "DDR_DQS0_P",
                "DDR_DQS0_N",
                "DDR_DQS1_P",
                "DDR_DQS1_N",
                "DDR_DM0",
                "DDR_DM1",
            ]
            .iter()
            .map(|s| s.to_string()),
        )
        .collect();
    let mut soc_signals: Vec<&str> = ddr.iter().map(String::as_str).collect();
    soc_signals.extend([
        "I2C0_SDA",
        "I2C0_SCL",
        "USB_DP",
        "USB_DN",
        "XTAL_IN",
        "XTAL_OUT",
        "CLK_32K",
        "I2S_BCLK",
        "I2S_LRCK",
        "I2S_DOUT",
        "I2S_DIN",
        "CODEC_MCLK",
        "CODEC_IRQ_L",
        "CODEC_RESET_L",
        "PMIC_IRQ_L",
        "CHG_IRQ_L",
        "SOC_RESET_L",
        "PWR_BTN_L",
        "VOL_UP_L",
        "VOL_DN_L",
        "UART_TX",
        "UART_RX",
        "PMIC_EN",
    ]);

    // Top side: SoC, memory and power.
    let soc = Point::new(1250.0, 2700.0);
    d.bga("U1000", Side::Top, "AV-SOC-1 · BGA196", soc, (14, 14), 19.685, |r, c| {
        soc_net(r, c, &soc_signals)
    });
    d.caps_around(
        1000,
        Side::Top,
        soc,
        (230.0, 230.0),
        20,
        &["PP_VCORE", "PP1V8", "PP0V9_SOC", "PP_VCORE"],
        "100nF 0201",
        21.6,
    );

    let dram = Point::new(1250.0, 3620.0);
    let mut dram_signals: Vec<&str> = ddr.iter().map(String::as_str).collect();
    dram_signals.push("DDR_ZQ");
    d.bga("U2000", Side::Top, "AV-LPDDR · BGA100", dram, (10, 10), 25.6, |r, c| {
        let k = r * 10 + c;
        if k % 2 == 0 {
            dram_signals.get(k / 2).map_or_else(|| "PP1V1_DDR".into(), |s| (*s).to_string())
        } else if (r + c) % 3 == 0 {
            "PP1V1_DDR".into()
        } else if k == 99 {
            "NC".into()
        } else {
            "GND".into()
        }
    });
    d.caps_around(2000, Side::Top, dram, (190.0, 190.0), 8, &["PP1V1_DDR"], "1uF 0201", 21.6);
    d.two_pin("R2000", Side::Top, "240R 1% 0201", Point::new(1560.0, 3620.0), 21.6, 90.0, ["DDR_ZQ", "GND"]);

    let pmic = Point::new(620.0, 1700.0);
    #[rustfmt::skip]
    let pmic_nets = [
        "PP_VSYS", "PP_VSYS", "PP_VCORE_SW", "PP_VCORE_SW", "GND", "GND", "PP_VCORE", "PP1V8_SW", "PP1V8_SW", "PP_VSYS",
        "PP1V8", "PP1V1_SW", "PP1V1_SW", "PP_VSYS", "PP1V1_DDR", "PP3V3_EN", "PP0V9_SOC", "PP_VSYS", "GND", "PMIC_VREF",
        "I2C0_SDA", "I2C0_SCL", "PMIC_IRQ_L", "SOC_RESET_L", "PWR_BTN_L", "PMIC_EN", "CLK_32K", "GND", "PP_VRTC", "PP_VBAT",
        "NC", "NC", "PMIC_TEMP", "GND", "PP_VSYS", "PP_VCORE", "PP_VCORE", "GND", "PP1V8", "PP_VSYS",
    ];
    d.qfn("U3000", Side::Top, "AV-PMU-40 · QFN40", pmic, 15.75, 0.0, &pmic_nets);
    d.two_pin(
        "L3000",
        Side::Top,
        "0.47uH 2016",
        Point::new(260.0, 1480.0),
        70.0,
        90.0,
        ["PP_VCORE_SW", "PP_VCORE"],
    );
    d.two_pin("L3001", Side::Top, "1uH 2016", Point::new(260.0, 1760.0), 70.0, 90.0, ["PP1V8_SW", "PP1V8"]);
    d.two_pin(
        "L3002",
        Side::Top,
        "1uH 2016",
        Point::new(260.0, 2040.0),
        70.0,
        90.0,
        ["PP1V1_SW", "PP1V1_DDR"],
    );
    for (i, (y, rail)) in [(1480.0, "PP_VCORE"), (1760.0, "PP1V8"), (2040.0, "PP1V1_DDR")].iter().enumerate()
    {
        d.two_pin(
            &format!("C{}", 3000 + i * 2),
            Side::Top,
            "22uF 0603",
            Point::new(420.0, *y + 60.0),
            60.0,
            0.0,
            [rail, "GND"],
        );
        d.two_pin(
            &format!("C{}", 3001 + i * 2),
            Side::Top,
            "10uF 0402",
            Point::new(420.0, *y - 50.0),
            35.0,
            0.0,
            [rail, "GND"],
        );
    }
    d.two_pin("C3010", Side::Top, "4.7uF 0402", Point::new(860.0, 1500.0), 35.0, 90.0, ["PP_VSYS", "GND"]);
    d.two_pin("C3011", Side::Top, "1uF 0201", Point::new(860.0, 1900.0), 21.6, 90.0, ["PMIC_VREF", "GND"]);
    d.two_pin("C3012", Side::Top, "100nF 0201", Point::new(420.0, 1320.0), 21.6, 0.0, ["PP_VRTC", "GND"]);

    let charger = Point::new(1780.0, 1000.0);
    #[rustfmt::skip]
    let charger_nets = [
        "PP_VBUS", "PP_VBUS", "CHG_SW", "CHG_SW", "GND", "GND",
        "PP_VSYS", "PP_VSYS", "PP_VBAT", "PP_VBAT", "BATT_TEMP", "I2C0_SDA",
        "I2C0_SCL", "CHG_IRQ_L", "USB_CC1", "USB_CC2", "USB_DP", "USB_DN",
        "CHG_EN_L", "GND", "PP_VREGN", "PP_BTST", "NC", "PP_VBUS",
    ];
    d.qfn("U3100", Side::Top, "AV-CHG-24 · QFN24", charger, 19.685, 45.0, &charger_nets);
    d.two_pin("L3100", Side::Top, "1uH 2520", Point::new(2080.0, 1250.0), 80.0, 90.0, ["CHG_SW", "PP_VSYS"]);
    d.two_pin("C3100", Side::Top, "10uF 0402", Point::new(1500.0, 1200.0), 35.0, 45.0, ["PP_VBUS", "GND"]);
    d.two_pin("C3101", Side::Top, "10uF 0402", Point::new(2080.0, 820.0), 35.0, 0.0, ["PP_VSYS", "GND"]);
    d.two_pin("C3102", Side::Top, "47nF 0201", Point::new(1560.0, 820.0), 21.6, 0.0, ["PP_BTST", "CHG_SW"]);
    d.two_pin("C3103", Side::Top, "2.2uF 0201", Point::new(1560.0, 740.0), 21.6, 0.0, ["PP_VREGN", "GND"]);
    d.two_pin("R3100", Side::Top, "10k 0201", Point::new(2080.0, 700.0), 21.6, 0.0, ["BATT_TEMP", "GND"]);

    d.row(
        "J5000",
        Side::Top,
        "Battery 6P",
        Point::new(420.0, 760.0),
        40.0,
        0.0,
        &["PP_VBAT", "PP_VBAT", "BATT_TEMP", "BATT_ID", "GND", "GND"],
    );
    d.two_pin("R5000", Side::Top, "100k 0201", Point::new(420.0, 900.0), 21.6, 0.0, ["BATT_ID", "GND"]);

    let ldo = Point::new(1900.0, 1700.0);
    d.part(
        "U3200",
        Side::Top,
        "3V3 LDO · SOT23-5",
        vec![
            ("1".into(), Point::new(ldo.x - 37.0, ldo.y - 55.0), "PP_VSYS".into()),
            ("2".into(), Point::new(ldo.x, ldo.y - 55.0), "GND".into()),
            ("3".into(), Point::new(ldo.x + 37.0, ldo.y - 55.0), "PP3V3_EN".into()),
            ("4".into(), Point::new(ldo.x + 37.0, ldo.y + 55.0), "NC".into()),
            ("5".into(), Point::new(ldo.x - 37.0, ldo.y + 55.0), "PP3V3".into()),
        ],
    );
    d.two_pin("C3200", Side::Top, "1uF 0201", Point::new(2040.0, 1760.0), 21.6, 90.0, ["PP3V3", "GND"]);

    d.row(
        "Y1000",
        Side::Top,
        "24MHz 2016",
        Point::new(1650.0, 2250.0),
        45.0,
        0.0,
        &["XTAL_IN", "GND", "XTAL_OUT", "GND"],
    );
    d.two_pin("C1100", Side::Top, "12pF 0201", Point::new(1580.0, 2150.0), 21.6, 90.0, ["XTAL_IN", "GND"]);
    d.two_pin("C1101", Side::Top, "12pF 0201", Point::new(1720.0, 2150.0), 21.6, 90.0, ["XTAL_OUT", "GND"]);
    d.two_pin("R1100", Side::Top, "2.2k 0201", Point::new(1850.0, 2350.0), 21.6, 90.0, ["I2C0_SDA", "PP1V8"]);
    d.two_pin("R1101", Side::Top, "2.2k 0201", Point::new(1900.0, 2350.0), 21.6, 90.0, ["I2C0_SCL", "PP1V8"]);
    d.two_pin(
        "R1102",
        Side::Top,
        "100k 0201",
        Point::new(1950.0, 2350.0),
        21.6,
        90.0,
        ["SOC_RESET_L", "PP1V8"],
    );

    // USB-C and its protection at the bottom edge.
    #[rustfmt::skip]
    let usb = ["GND", "PP_VBUS_USB", "USB_CC1", "USB_DP", "USB_DN", "SBU1", "SBU2", "USB_DN", "USB_DP", "USB_CC2", "PP_VBUS_USB", "GND"];
    d.row("J4000", Side::Top, "USB-C 12P", Point::new(1200.0, 150.0), 19.685, 0.0, &usb);
    let mut shell = RawPart::new("J4001", Side::Both, Mount::ThroughHole);
    shell.device = Some("USB-C shell".into());
    for (i, (x, y)) in [(-190.0, 120.0), (190.0, 120.0), (-190.0, 300.0), (190.0, 300.0)].iter().enumerate() {
        shell.pins.push(RawPin {
            pos: Point::new(1200.0 + x, *y),
            side: Some(Side::Both),
            net: "GND".into(),
            number: Some(format!("S{}", i + 1)),
            radius: Some(26.0),
            ..Default::default()
        });
    }
    d.b.parts.push(shell);
    d.two_pin(
        "F4000",
        Side::Top,
        "3A fuse 0402",
        Point::new(900.0, 430.0),
        35.0,
        0.0,
        ["PP_VBUS_USB", "PP_VBUS"],
    );
    d.part(
        "D4000",
        Side::Top,
        "USB ESD · DFN6",
        vec![
            ("1".into(), Point::new(1170.0, 430.0), "USB_DP".into()),
            ("2".into(), Point::new(1170.0, 450.0), "GND".into()),
            ("3".into(), Point::new(1170.0, 470.0), "USB_DN".into()),
            ("4".into(), Point::new(1230.0, 470.0), "USB_DN".into()),
            ("5".into(), Point::new(1230.0, 450.0), "PP_VBUS".into()),
            ("6".into(), Point::new(1230.0, 430.0), "USB_DP".into()),
        ],
    );
    d.two_pin("C4000", Side::Top, "1uF 0402", Point::new(900.0, 520.0), 35.0, 0.0, ["PP_VBUS", "GND"]);

    d.row(
        "J7000",
        Side::Top,
        "Buttons 4P",
        Point::new(2240.0, 3000.0),
        30.0,
        90.0,
        &["PWR_BTN_L", "VOL_UP_L", "VOL_DN_L", "GND"],
    );
    d.two_pin(
        "R7000",
        Side::Top,
        "10k 0201",
        Point::new(2120.0, 2960.0),
        21.6,
        90.0,
        ["PWR_BTN_L", "PP_VRTC"],
    );
    d.two_pin("R7001", Side::Top, "10k 0201", Point::new(2080.0, 2960.0), 21.6, 90.0, ["VOL_UP_L", "PP1V8"]);
    d.two_pin("R7002", Side::Top, "10k 0201", Point::new(2040.0, 2960.0), 21.6, 90.0, ["VOL_DN_L", "PP1V8"]);

    // Bottom side: audio codec, speaker, extra decoupling and test points.
    let codec = Point::new(1250.0, 1500.0);
    #[rustfmt::skip]
    let codec_nets = [
        "PP1V8", "PP3V3", "GND", "I2S_BCLK", "I2S_LRCK", "I2S_DOUT", "I2S_DIN", "CODEC_MCLK",
        "I2C0_SDA", "I2C0_SCL", "CODEC_IRQ_L", "CODEC_RESET_L", "GND", "MIC_BIAS", "MIC_P", "MIC_N",
        "HP_L", "HP_R", "HP_DET", "GND", "SPK_P", "SPK_P", "SPK_N", "SPK_N",
        "PP_VSYS", "PP_VSYS", "GND", "NC", "NC", "PP1V8", "GND", "PP3V3",
    ];
    d.qfn("U6000", Side::Bottom, "AV-CODEC · QFN32", codec, 19.685, 0.0, &codec_nets);
    d.caps_around(
        6000,
        Side::Bottom,
        codec,
        (150.0, 150.0),
        6,
        &["PP1V8", "PP3V3", "PP_VSYS"],
        "1uF 0201",
        21.6,
    );
    d.row("J6000", Side::Bottom, "Speaker 2P", Point::new(1250.0, 800.0), 80.0, 0.0, &["SPK_P", "SPK_N"]);
    d.row(
        "J6100",
        Side::Bottom,
        "Mic/HP 6P",
        Point::new(700.0, 3300.0),
        30.0,
        90.0,
        &["MIC_P", "MIC_N", "MIC_BIAS", "HP_L", "HP_R", "HP_DET"],
    );
    d.caps_around(
        1200,
        Side::Bottom,
        soc,
        (120.0, 120.0),
        12,
        &["PP_VCORE", "PP_VCORE", "PP0V9_SOC"],
        "220nF 0201",
        21.6,
    );

    let tps = [
        (4000, 700.0, 400.0, "PP_VBUS"),
        (3000, 500.0, 1100.0, "PP_VBAT"),
        (3001, 900.0, 1100.0, "PP_VSYS"),
        (3002, 900.0, 2200.0, "PP_VCORE"),
        (3003, 700.0, 2200.0, "PP1V8"),
        (3004, 1700.0, 3300.0, "PP1V1_DDR"),
        (3005, 1900.0, 1900.0, "PP3V3"),
        (1000, 1800.0, 2600.0, "SOC_RESET_L"),
        (1001, 1900.0, 2800.0, "UART_TX"),
        (1002, 1980.0, 2800.0, "UART_RX"),
        (1003, 1800.0, 2800.0, "I2C0_SDA"),
        (1004, 1800.0, 2880.0, "I2C0_SCL"),
        (1, 300.0, 300.0, "GND"),
        (2, 2100.0, 4100.0, "GND"),
    ];
    for (probe, x, y, net) in tps {
        d.test_point(probe, Point::new(x, y), Side::Bottom, net);
    }
    d.b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NetKind;

    #[test]
    fn demo_board_is_consistent() {
        let b = board();
        assert!(b.parts.len() > 80, "{} parts", b.parts.len());
        assert!(b.pins.len() > 500);
        let gnd = &b.nets[b.find_net("GND").unwrap()];
        assert_eq!(gnd.kind, NetKind::Ground);
        let sda = &b.nets[b.find_net("I2C0_SDA").unwrap()];
        // SoC, PMIC, charger, codec, pull-up and test point share the bus.
        let parts: std::collections::HashSet<u32> =
            sda.pins.iter().map(|&p| b.pins[p as usize].part).collect();
        assert!(parts.len() >= 5, "{parts:?}");
        assert_eq!(sda.test_points.len(), 1);
        assert!(b.parts.iter().any(|p| p.side == Side::Bottom));
        assert!(b.parts.iter().any(|p| p.side == Side::Both));
        assert_eq!(b.outline.len(), 3);
    }
}
