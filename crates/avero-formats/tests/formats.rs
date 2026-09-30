//! One small, hand-written board per format. The fixtures are synthetic so
//! the repository never contains vendor boardview data.

use avero_formats::formats::{encode_bdv, encode_brd};
use avero_formats::{parse, parse_asc, Board, FormatId, Mount, NetKind, ParseError, Side, TestPointKind};

fn part<'a>(b: &'a Board, name: &str) -> &'a avero_formats::Part {
    &b.parts[b.find_part(name).unwrap_or_else(|| panic!("part {name} missing"))]
}

fn net_name(b: &Board, pin: &avero_formats::Pin) -> String {
    b.nets[pin.net as usize].name.clone()
}

fn assert_close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6, "{a} != {b}");
}

const BRD: &str = "str_length:
0 0 0 0
var_data:
4 3 7 2
Format:
0 0
1000 0
1000 500
0 500
Parts:
U1 5 4
R1 10 6
J1 1 7
Pins:
100 100 -99 1 VCC
200 100 -99 1 GND
100 200 -99 1 SDA
200 200 3 1
400 100 -99 2 VCC
440 100 -99 2 SDA
800 300 -99 3 GND
Nails:
3 250 250 1 SCL
7 900 400 2 GND
";

fn check_brd(b: &Board) {
    assert_eq!(b.format, FormatId::Brd);
    assert_eq!(b.parts.len(), 3);
    assert_eq!(b.pins.len(), 7);
    assert_eq!(b.test_points.len(), 2);
    assert_eq!(b.outline.len(), 1);
    assert_eq!(b.outline[0].len(), 4);

    let u1 = part(b, "U1");
    assert_eq!((u1.side, u1.mount, u1.pin_count), (Side::Top, Mount::Smd, 4));
    let r1 = part(b, "R1");
    assert_eq!((r1.side, r1.mount), (Side::Bottom, Mount::Smd));
    assert_eq!(part(b, "J1").mount, Mount::ThroughHole);

    // The fourth U1 pin has no net name and inherits it from nail 3.
    let pin = &b.part_pins(b.find_part("U1").unwrap())[3];
    assert_eq!(net_name(b, pin), "SCL");
    assert_eq!(pin.number, "4");
    assert_eq!(pin.side, Side::Top);

    let gnd = &b.nets[b.find_net("GND").unwrap()];
    assert_eq!(gnd.kind, NetKind::Ground);
    assert_eq!(gnd.pins.len(), 2);
    assert_eq!(gnd.test_points.len(), 1);
    assert!(b.warnings.is_empty(), "{:?}", b.warnings);
}

#[test]
fn brd_plain() {
    check_brd(&parse(BRD.as_bytes(), Some("board.brd")).unwrap());
}

#[test]
fn brd_obfuscated_and_crlf() {
    let crlf = BRD.replace('\n', "\r\n");
    let encoded = encode_brd(crlf.as_bytes());
    assert_ne!(encoded, crlf.as_bytes());
    check_brd(&parse(&encoded, Some("BOARD.BRD")).unwrap());
}

#[test]
fn brd2() {
    let src = "BRDOUT: 4 1000 500
0 0
1000 0
1000 500
0 500

NETS: 3
1 VCC
2 GND
3 SDA

PARTS: 2
U1 50 50 250 250 0 1
R1 400 400 480 450 2 2

PINS: 4
100 100 1 1
200 100 2 1
420 80 1 2
460 80 3 2

NAILS: 1
5 300 100 3 2
";
    let b = parse(src.as_bytes(), Some("x.brd")).unwrap();
    assert_eq!(b.format, FormatId::Brd2);
    assert_eq!(part(&b, "U1").pin_count, 2);
    let r1 = b.find_part("R1").unwrap();
    assert_eq!(b.parts[r1].side, Side::Bottom);
    // Bottom-side coordinates are stored mirrored in Y.
    let pins = b.part_pins(r1);
    assert_close(pins[0].y, 420.0);
    assert_eq!(net_name(&b, &pins[1]), "SDA");
    assert_close(b.parts[r1].bounds.min_y, 50.0);
    assert_close(b.test_points[0].y, 400.0);
    assert_eq!(b.nets[b.test_points[0].net as usize].name, "SDA");
}

const ASC_FORMAT: &str = "Board outline
Units: inch
X Y
;
;
;
;
;
0.000 0.000
1.000 0.000
1.000 0.500
0.000 0.500
";

const ASC_PINS: &str = "Pins
Part Pin Name X Y Layer Net Nail
;
;
Part U1 (T)
1 1 0.100 0.100 1 VCC 0
2 2 0.200 0.100 1 GND 0
Part C1 (B)
3 1 0.400 0.300 2 VCC 0
4 2 0.440 0.300 2 GND 0
";

const ASC_NAILS: &str = "Nails
Nail X Y Type Grid T/B Net# NetName
-1 0.300 0.300 1 A1 (T) 1 VCC
-2 0.600 0.300 1 A2 (B) 2 GND
";

fn check_asc(b: &Board) {
    assert_eq!(b.parts.len(), 2);
    assert_eq!(b.pins.len(), 4);
    assert_eq!(b.outline[0].len(), 4);
    let c1 = b.find_part("C1").unwrap();
    assert_eq!(b.parts[c1].side, Side::Bottom);
    let pin = &b.part_pins(c1)[1];
    assert_close(pin.x, 440.0);
    assert_eq!(net_name(b, pin), "GND");
    assert_eq!(b.test_points.len(), 2);
    assert_eq!(b.test_points[1].side, Side::Bottom);
    assert_eq!(b.test_points[0].probe, Some(1));
}

#[test]
fn bdv() {
    let plain = format!("<<format.asc>>\n{ASC_FORMAT}<<pins.asc>>\n{ASC_PINS}<<nails.asc>>\n{ASC_NAILS}")
        .replace('\n', "\r\n");
    let encoded = encode_bdv(plain.as_bytes());
    let b = parse(&encoded, Some("board.bdv")).unwrap();
    assert_eq!(b.format, FormatId::Bdv);
    check_asc(&b);
}

#[test]
fn asc_file_set() {
    let b = parse_asc(Some(ASC_FORMAT.as_bytes()), ASC_PINS.as_bytes(), Some(ASC_NAILS.as_bytes())).unwrap();
    assert_eq!(b.format, FormatId::Asc);
    check_asc(&b);
    assert_eq!(parse(ASC_PINS.as_bytes(), Some("pins.asc")).unwrap_err(), ParseError::NeedsAscFiles);
}

#[test]
fn bvr_v1() {
    let src = "BVRAW_FORMAT_1
<<Layout>>
X,Y
0.0,0.0
1.0,0.0
1.0,0.5
0.0,0.5
<<Pin>>
Part Side ID Name X Y Layer Net
U1 (T) 1 1 0.1 0.1 1 VCC
U1 (T) 2 2 0.2 0.1 1 GND
R1 (B) 3 1 0.4 0.3 2 VCC
R1 (B) 4 2 0.44 0.3 2 GND
<<Nail>>
Name X Y Type Grid Side NetID Net
N1\t0.3 0.3 1 A1 (T) 1 VCC
";
    let b = parse(src.as_bytes(), Some("board.bvr")).unwrap();
    assert_eq!(b.format, FormatId::Bvr);
    assert_eq!(b.parts.len(), 2);
    assert_eq!(part(&b, "R1").side, Side::Bottom);
    assert_close(b.outline[0][2].x, 1000.0);
    assert_eq!(b.test_points.len(), 1);
    assert_eq!(b.nets[b.test_points[0].net as usize].name, "VCC");
}

#[test]
fn bvr_v3() {
    let src = "BVRAW_FORMAT_3
OUTLINE_POINTS 0 0 1000 0 1000 500 0 500 0 0
PART_NAME U1
PART_SIDE T
PART_ORIGIN 100 100
PART_MOUNT SMD
PIN_ID 1
PIN_NUMBER 1
PIN_NAME VIN
PIN_SIDE T
PIN_ORIGIN 0 0
PIN_RADIUS 7.5
PIN_NET VCC
PIN_END
PIN_ID 2
PIN_NUMBER 2
PIN_NAME GND
PIN_SIDE T
PIN_ORIGIN 50 0
PIN_RADIUS 7.5
PIN_NET GND
PIN_END
PART_END
PART_NAME J1
PART_SIDE O
PART_ORIGIN 600 300
PART_MOUNT TH
PIN_NUMBER 1
PIN_SIDE O
PIN_ORIGIN 0 0
PIN_NET GND
PIN_END
PART_END
";
    let b = parse(src.as_bytes(), Some("board.bvr")).unwrap();
    assert_eq!(b.format, FormatId::Bvr3);
    let u1 = b.find_part("U1").unwrap();
    let pin = &b.part_pins(u1)[1];
    assert_close(pin.x, 150.0);
    assert_close(pin.radius, 7.5);
    assert_eq!(pin.name.as_deref(), Some("GND"));
    let j1 = part(&b, "J1");
    assert_eq!((j1.side, j1.mount), (Side::Both, Mount::ThroughHole));
    assert_eq!(b.outline[0].len(), 5);
}

#[test]
fn panel_cad() {
    let src = "###Panel Added
COMP U1 1 0 0 0.1 0.1 1 0
COMP R1 2 0 0 0.4 0.3 2 0
C_PIN U1-1 0.1 0.1 0 0 0 X /VCC
C_PIN U1-2 0.2 0.1 0 0 0 X /GND
C_PIN R1-1 0.4 0.3 0 0 0 X /VCC
C_PIN R1-2 0.44 0.3 0 0 0 X GND
NET /VCC
N_VIA 0.3 0.3 X 1 0
";
    let b = parse(src.as_bytes(), Some("board.cad")).unwrap();
    assert_eq!(b.format, FormatId::Cad);
    assert_eq!(part(&b, "R1").side, Side::Bottom);
    let u1 = b.find_part("U1").unwrap();
    assert_eq!(net_name(&b, &b.part_pins(u1)[0]), "VCC");
    assert_eq!(b.part_pins(u1)[1].number, "2");
    assert_eq!(b.nets[b.find_net("GND").unwrap()].pins.len(), 2);
    assert_eq!(b.test_points[0].kind, TestPointKind::Via);
    assert_eq!(b.nets[b.test_points[0].net as usize].name, "VCC");
    // No outline in the file: one is derived from the pins.
    assert_eq!(b.outline.len(), 1);
}

const GENCAD: &str = r#"$HEADER
GENCAD 1.4
USER "Avero test"
UNITS INCH
ORIGIN 0 0
$ENDHEADER
$BOARD
LINE 0 0 1 0
LINE 1 0.5 0 0.5
LINE 1 0 1 0.5
LINE 0 0.5 0 0
$ENDBOARD
$PADS
PAD SMD20 RECTANGULAR -1
RECTANGLE -0.01 -0.01 0.02 0.02
PAD TH60 ROUND 0.035
CIRCLE 0 0 0.03
$ENDPADS
$PADSTACKS
PADSTACK PS_SMD -1
PAD SMD20 TOP 0 0
PADSTACK PS_TH 0.035
PAD TH60 TOP 0 0
PAD TH60 BOTTOM 0 0
$ENDPADSTACKS
$SHAPES
SHAPE R0402
INSERT SMD
LINE -0.04 -0.02 0.04 -0.02
LINE 0.04 -0.02 0.04 0.02
LINE 0.04 0.02 -0.04 0.02
LINE -0.04 0.02 -0.04 -0.02
PIN 1 PS_SMD -0.02 0 TOP 0 0
PIN 2 PS_SMD 0.02 0 TOP 0 0
SHAPE HDR2
INSERT TH
PIN 1 PS_TH 0 0 TOP 0 0
PIN 2 PS_TH 0.1 0 TOP 0 0
$ENDSHAPES
$COMPONENTS
COMPONENT R1
PLACE 0.5 0.25
LAYER TOP
ROTATION 90
SHAPE R0402 0 0
DEVICE RES_10K
COMPONENT R2
PLACE 0.3 0.25
LAYER BOTTOM
ROTATION 0
SHAPE R0402 MIRRORX FLIP
DEVICE RES_10K
COMPONENT J1
PLACE 0.8 0.1
LAYER TOP
ROTATION 0
SHAPE HDR2 0 0
$ENDCOMPONENTS
$DEVICES
DEVICE RES_10K
PART "RC0402-10K"
VALUE "10k"
$ENDDEVICES
$SIGNALS
SIGNAL VCC
NODE R1 1
NODE R2 1
NODE J1 1
SIGNAL GND
NODE R1 2
NODE R2 2
NODE J1 2
$ENDSIGNALS
$ROUTES
ROUTE VCC
VIA PS_TH 0.6 0.4 ALL 0.012
$ENDROUTES
"#;

#[test]
fn gencad() {
    let b = parse(GENCAD.as_bytes(), Some("board.cad")).unwrap();
    assert_eq!(b.format, FormatId::GenCad);
    assert_eq!(b.parts.len(), 3);
    assert_eq!(b.outline.len(), 1);
    assert_eq!(b.outline[0].len(), 5);

    let r1 = b.find_part("R1").unwrap();
    let pins = b.part_pins(r1);
    assert_close(pins[0].x, 500.0);
    assert_close(pins[0].y, 230.0);
    assert_close(pins[0].radius, 10.0);
    assert_eq!(net_name(&b, &pins[0]), "VCC");
    assert_eq!(b.parts[r1].device.as_deref(), Some("10k · RC0402-10K"));
    assert_eq!(b.parts[r1].outline.len(), 4);

    let r2 = b.find_part("R2").unwrap();
    assert_eq!(b.parts[r2].side, Side::Bottom);
    let pins = b.part_pins(r2);
    // Same mirroring convention as OpenBoardView (MIRRORX negates Y at 0°).
    assert_close(pins[0].x, 280.0);
    assert_eq!(pins[0].side, Side::Bottom);

    let j1 = b.find_part("J1").unwrap();
    assert_eq!((b.parts[j1].side, b.parts[j1].mount), (Side::Both, Mount::ThroughHole));
    assert_close(b.part_pins(j1)[1].radius, 30.0);
    assert_eq!(b.part_pins(j1)[0].side, Side::Both);

    assert_eq!(b.test_points.len(), 1);
    assert_eq!(b.nets[b.test_points[0].net as usize].name, "VCC");
}

#[test]
fn gencad_metric_units() {
    let src = GENCAD.replace("UNITS INCH", "UNITS USER 1000");
    let b = parse(src.as_bytes(), Some("board.gcd")).unwrap();
    // USER 1000 = thousandths of an inch = mils, so coordinates shrink 1000×.
    let r1 = b.find_part("R1").unwrap();
    assert_close(b.part_pins(r1)[0].x, 0.5);
}

fn cst_fixture() -> Vec<u8> {
    let mut v: Vec<u8> = Vec::new();
    let i16 = |v: &mut Vec<u8>, n: i16| v.extend_from_slice(&n.to_le_bytes());
    i16(&mut v, 2);
    v.extend_from_slice(&[0; 4]);
    i16(&mut v, 5);
    v.extend_from_slice(b"CPart");
    for (name, layer, last) in [("U1", 0x0c, false), ("R1", 0x01, true)] {
        v.push(name.len() as u8);
        v.extend_from_slice(name.as_bytes());
        v.extend_from_slice(&[0; 4]);
        v.push(layer);
        v.extend_from_slice(&[0; 4]);
        // The last two bytes of the final part record hold the net count.
        i16(&mut v, if last { 2 } else { 0 });
    }
    for net in ["VCC", "GND"] {
        v.push(net.len() as u8);
        v.extend_from_slice(net.as_bytes());
    }
    v.extend_from_slice(&[0xAA; 7]);
    i16(&mut v, 4);
    v.extend_from_slice(&[0; 6]);
    v.extend_from_slice(b"CPad");
    for (part, probe, net, x, y) in
        [(0, 1, 0, 100, 100), (0, 2, 1, 200, 100), (1, 3, 0, 400, 300), (-1, 4, 1, 50, 50)]
    {
        for n in [part, probe, net, x, y, 0] {
            i16(&mut v, n);
        }
        v.extend_from_slice(&[0; 4]);
    }
    v
}

#[test]
fn cst() {
    let b = parse(&cst_fixture(), Some("board.cst")).unwrap();
    assert_eq!(b.format, FormatId::Cst);
    assert_eq!(b.parts.len(), 3);
    assert_eq!(part(&b, "U1").side, Side::Top);
    assert_eq!(part(&b, "R1").side, Side::Bottom);
    assert_eq!(part(&b, "...").pin_count, 1);
    let u1 = b.find_part("U1").unwrap();
    assert_eq!(net_name(&b, &b.part_pins(u1)[1]), "GND");
}

#[test]
fn truncated_cst_is_an_error_not_a_panic() {
    let data = cst_fixture();
    for len in [3, 20, 40, data.len() - 5] {
        assert!(matches!(parse(&data[..len], Some("b.cst")), Err(ParseError::Invalid { .. })), "len {len}");
    }
}

#[test]
fn errors() {
    assert_eq!(parse(b"", Some("a.brd")).unwrap_err(), ParseError::Empty);
    assert_eq!(parse(b"hello world", Some("a.txt")).unwrap_err(), ParseError::Unrecognized);
    assert_eq!(parse(b"%PDF-1.7 ...", Some("a.pdf")).unwrap_err(), ParseError::Pdf);
    assert_eq!(
        parse(b"XZZPCB V1.0 ...", Some("a.pcb")).unwrap_err(),
        ParseError::Unsupported("XinZhiZao PCB")
    );
    assert_eq!(parse(b"\x00\x01", Some("a.fz")).unwrap_err().code(), "unsupported");
}

#[test]
fn garbage_never_panics() {
    // Cheap fuzzing: random bytes behind every format's signature.
    let heads: [&[u8]; 8] = [
        b"str_length:\nvar_data:\n",
        b"BRDOUT: 1 1 1\nNETS: 1\n",
        b"<<format.asc>>\n<<pins.asc>>\n",
        b"BVRAW_FORMAT_1\n<<Pin>>\n",
        b"BVRAW_FORMAT_3\n",
        b"###Panel Added C_PIN\n",
        b"GENCAD $HEADER\n$COMPONENTS\n",
        &avero_formats::formats::encode_brd(b"str_"),
    ];
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for head in heads {
        for _ in 0..200 {
            let len = (next() % 400) as usize;
            let mut buf = head.to_vec();
            buf.extend((0..len).map(|_| {
                let r = next() % 16;
                // Bias towards digits, whitespace and separators.
                match r {
                    0..=5 => b'0' + (next() % 10) as u8,
                    6..=8 => b' ',
                    9 => b'\n',
                    10 => b'-',
                    11 => b'.',
                    _ => (next() % 256) as u8,
                }
            }));
            let _ = parse(&buf, Some("fuzz.brd"));
            let _ = parse(&buf, Some("fuzz.cst"));
        }
    }
}

#[test]
fn json_shape() {
    let b = parse(BRD.as_bytes(), Some("board.brd")).unwrap();
    let v: serde_json::Value = serde_json::to_value(&b).unwrap();
    assert_eq!(v["format"], "brd");
    assert_eq!(v["unit"], "mil");
    assert_eq!(v["parts"][2]["mount"], "th");
    assert!(v["parts"][0]["firstPin"].is_number());
    assert!(v["pins"][0]["radius"].as_f64().unwrap() > 0.0);
    assert_eq!(v["nets"][0]["kind"], "power");
    assert!(v["testPoints"][0]["kind"] == "nail");
}
