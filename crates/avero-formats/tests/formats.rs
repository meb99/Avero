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

#[test]
fn gencad_routes_and_misdeclared_units() {
    // As written by XZZ converters: INCH declared, mils used, pinless shapes,
    // quoted net names and connectivity only through routes.
    let src = b"$HEADER\nGENCAD 1.4\nUNITS INCH\n$ENDHEADER\n\
$BOARD\nLINE 50000 50000 56000 50000\nLINE 56000 50000 56000 54000\n\
LINE 56000 54000 50000 54000\nLINE 50000 54000 50000 50000\n$ENDBOARD\n\
$SHAPES\nSHAPE SHAPE_1\n$ENDSHAPES\n\
$COMPONENTS\nCOMPONENT \"C-0402\"\nPLACE 52000 53000\nLAYER LAYER_0\nROTATION 0\nSHAPE SHAPE_1 0 0\n$ENDCOMPONENTS\n\
$SIGNALS\nSIGNAL \"PP3V3\"\n$ENDSIGNALS\n\
$TRACKS\nTRACK TRACE_1 4\n$ENDTRACKS\n\
$ROUTES\nROUTE \"PP3V3\"\nTRACK TRACE_1\nLAYER LAYER_1\nLINE 51000 51000 52000 51000\n\
ROUTE \"PP3V3\"\nTRACK TRACE_1\nLAYER LAYER_3\nLINE 52000 51000 52000 52000\n\
ROUTE \"PP3V3\"\nTRACK TRACE_1\nLAYER LAYER_16\nLINE 52000 52000 53000 52000\n\
VIA VIASTACK_1 52000 51000 ALL 0 VIA_1\n$ENDROUTES\n";
    let b = parse(src, Some("board.cad")).unwrap();
    assert_eq!(b.format, FormatId::GenCad);
    assert_close(b.bounds.max_x - b.bounds.min_x, 6000.0);
    assert!(b.warnings.iter().any(|w| w.contains("mils")));
    assert_eq!(b.traces.len(), 3);
    let sides: Vec<Side> = b.traces.iter().map(|t| t.side).collect();
    assert_eq!(sides, [Side::Top, Side::Both, Side::Bottom]);
    let layers: Vec<&str> = b.layers.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(layers, ["LAYER_1", "LAYER_3", "LAYER_16"]);
    assert_eq!(b.traces[2].layer, 2);
    assert_close(b.traces[0].width, 4.0);
    let net = &b.nets[b.find_net("PP3V3").unwrap()];
    assert_eq!(net.kind, NetKind::Power);
    assert_eq!((net.traces.len(), net.test_points.len()), (3, 1));
    // Without matching copper the part gets a typical 0402 body around its place.
    let c = part(&b, "C-0402");
    assert!(c.outline.len() == 4 && c.bounds.min_x < 52000.0 && c.bounds.max_x > 52000.0);
    assert!(c.estimated && !c.marker);
    assert_eq!(c.package, Some(avero_formats::Package::Passive));
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
    assert!(matches!(parse(b"XZZPCB V1.0 ...", Some("a.pcb")), Err(ParseError::Invalid { .. })));
    assert_eq!(parse(b"\x00\x01", Some("a.fz")).unwrap_err().code(), "invalid");
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

const XZZ_KEY: u64 = 0x8003_0303_0303_0303;

/// A small XZZ board: a rectangular outline, one encrypted part with two
/// pins and a test pad. `xor` > 0 builds the XOR-obfuscated variant.
fn xzz_fixture(xor: u8) -> Vec<u8> {
    use avero_formats::formats::xzz_encrypt;
    fn u32le(v: &mut Vec<u8>, n: u32) {
        v.extend_from_slice(&n.to_le_bytes());
    }
    let mil = |v: u32| v * 10_000;

    let mut nets = Vec::new();
    for (index, name) in [(1u32, "VCC"), (2, "GND"), (3, "NC")] {
        u32le(&mut nets, 8 + name.len() as u32);
        u32le(&mut nets, index);
        nets.extend_from_slice(name.as_bytes());
    }

    let pin = |x: u32, y: u32, name: &str, net: u32| {
        let mut b = vec![0x09];
        u32le(&mut b, (4 + 4 + 4 + 8 + 4 + name.len() + 32 + 4) as u32);
        b.extend_from_slice(&[0; 4]);
        u32le(&mut b, mil(x));
        u32le(&mut b, mil(y));
        b.extend_from_slice(&[0; 8]);
        u32le(&mut b, name.len() as u32);
        b.extend_from_slice(name.as_bytes());
        b.extend_from_slice(&[0; 32]);
        u32le(&mut b, net);
        b
    };
    let mut body = vec![0; 18];
    u32le(&mut body, 3);
    body.extend_from_slice(b"GRP");
    body.push(0x06);
    body.extend_from_slice(&[0; 30]);
    u32le(&mut body, 2);
    body.extend_from_slice(b"U1");
    // A silkscreen line inside the part, which the reader skips.
    body.push(0x05);
    u32le(&mut body, 8);
    body.extend_from_slice(&[0xAB; 8]);
    body.extend(pin(300, 400, "1", 1));
    body.extend(pin(350, 400, "2", 3));
    let mut part = Vec::new();
    u32le(&mut part, body.len() as u32);
    part.extend(body);
    part.resize(part.len().div_ceil(8) * 8, 0);
    let part = xzz_encrypt(&part, XZZ_KEY);

    let mut blocks = Vec::new();
    let mut block = |kind: u8, data: &[u8]| {
        blocks.push(kind);
        u32le(&mut blocks, data.len() as u32);
        blocks.extend_from_slice(data);
    };
    for (layer, (x1, y1, x2, y2)) in [
        (28, (100, 200, 1100, 200)),
        (28, (1100, 200, 1100, 700)),
        (28, (1100, 700, 100, 700)),
        (28, (100, 700, 100, 200)),
        (1, (0, 0, 5000, 5000)),
    ] {
        let mut l = Vec::new();
        for v in [layer, mil(x1), mil(y1), mil(x2), mil(y2), 10_000, 0] {
            u32le(&mut l, v);
        }
        block(0x05, &l);
    }
    block(0x07, &part);
    block(0x02, &[0; 12]);
    let mut pad = Vec::new();
    for v in [7, mil(900), mil(600), 0, 0, 3] {
        u32le(&mut pad, v);
    }
    pad.extend_from_slice(b"TP7");
    pad.extend_from_slice(&[0; 4]);
    u32le(&mut pad, 1);
    block(0x09, &pad);

    let mut file = b"XZZPCB V1.0".to_vec();
    file.resize(0x40, 0);
    let main_start = file.len();
    u32le(&mut file, blocks.len() as u32);
    file.extend(blocks);
    let net_start = file.len();
    u32le(&mut file, nets.len() as u32);
    file.extend(nets);
    file[0x20..0x24].copy_from_slice(&((main_start - 0x20) as u32).to_le_bytes());
    file[0x28..0x2c].copy_from_slice(&((net_start - 0x20) as u32).to_le_bytes());
    let marker = file.len();
    file.extend_from_slice(b"v6v6555v6v6 trailing data");
    if xor != 0 {
        for b in &mut file[..marker] {
            *b ^= xor;
        }
    }
    file
}

fn check_xzz(b: &Board) {
    assert_eq!(b.format, FormatId::Xzz);
    let u1 = b.find_part("U1").unwrap();
    let pins = b.part_pins(u1);
    assert_eq!(pins.len(), 2);
    // Moved so the outline starts at the origin.
    assert_close(pins[0].x, 200.0);
    assert_close(pins[0].y, 200.0);
    assert_eq!(net_name(b, &pins[0]), "VCC");
    assert_eq!(b.nets[pins[1].net as usize].kind, NetKind::Unconnected);
    assert_eq!(pins[1].number, "2");
    assert_eq!(b.test_points.len(), 1);
    assert_eq!(b.test_points[0].name.as_deref(), Some("TP7"));
    assert_eq!(b.nets[b.test_points[0].net as usize].name, "VCC");
    assert_eq!(b.outline.len(), 1);
    assert_eq!(b.outline[0].len(), 5);
    assert_close(b.bounds.max_x, 1000.0);
}

fn xzz_options(key: u64) -> avero_formats::ParseOptions {
    avero_formats::ParseOptions { xzz_key: Some(key), ..Default::default() }
}

#[test]
fn xzz_plain_and_xored() {
    check_xzz(&avero_formats::parse_with(&xzz_fixture(0), Some("board.pcb"), xzz_options(XZZ_KEY)).unwrap());
    check_xzz(
        &avero_formats::parse_with(&xzz_fixture(0x5a), Some("board.pcb"), xzz_options(XZZ_KEY)).unwrap(),
    );
}

#[test]
fn xzz_key_errors() {
    let file = xzz_fixture(0);
    assert_eq!(avero_formats::parse_with(&file, None, xzz_options(0)).unwrap_err(), ParseError::InvalidKey);
    // Plausible but wrong: the part data decrypts to garbage.
    let wrong = 0x8003_0303_0303_0305;
    assert!(avero_formats::formats::xzz_key_is_plausible(wrong));
    match avero_formats::parse_with(&file, None, xzz_options(wrong)).unwrap_err() {
        ParseError::Invalid { message, .. } => assert!(message.contains("key"), "{message}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn xzz_without_key_shows_outline_and_test_pads() {
    let b = parse(&xzz_fixture(0x5a), Some("board.pcb")).unwrap();
    assert!(b.parts.is_empty());
    assert_eq!(b.locked_parts, 1);
    assert_eq!(b.test_points.len(), 1);
    assert_eq!(b.test_points[0].name.as_deref(), Some("TP7"));
    assert_eq!(b.nets[b.test_points[0].net as usize].name, "VCC");
    assert_eq!(b.outline.len(), 1);
}

#[test]
fn truncated_xzz_is_an_error_not_a_panic() {
    let file = xzz_fixture(0);
    for len in [0x11, 0x2c, 0x60, file.len() / 2, file.len() - 30] {
        let r = avero_formats::parse_with(&file[..len], None, xzz_options(XZZ_KEY));
        assert!(r.is_err(), "len {len}");
    }
}

// --- ASUS FZ -----------------------------------------------------------------

const FZ_CONTENT: &str = "A!REFDES!COMP_INSERTION_CODE!SYM_NAME!SYM_MIRROR!SYM_ROTATE!
S!U1!!!NO!0!
S!C5!!!YES!90!
S!R7!!!NO!0!
A!NET_NAME!REFDES!PIN_NUMBER!PIN_NAME!PIN_X!PIN_Y!TEST_POINT!RADIUS!
S!PP3V3!U1!1!VCC!100.0!200.0!!6!
S!GND!U1!2!GND!150,5!200.0!12!6!
S!SATA_GP1!U1!0!AJ43!200!200!!7.48!
S!PP3V3!C5!1!!100!300!!6!
S!GND!C5!2!!140!300!!6!
S!PP3V3!R7!1!!300!100!!6!
S!EN!R7!2!!340!100!!6!
S!EN!X9!1!!0!0!!6!
A!TESTVIA!TESTVIA!REFDES!PIN_NUMBER!PIN_NAME!VIA_X!VIA_Y!TEST_POINT!RADIUS!
S!Y!PP3V3!U1!1!VCC!120!220!T!10!
S!Y!GND!C5!2!!130!320!B!10!
";

const FZ_DESCR: &str = "BOARD X541UA
PARTNUMBER\tDESCRIPTION\tQTY\tLOCATION\tPARTNUMBER2
0101-001\tRES 10K 1% 0402\t1\tR7\tabc
0102-002\tCAP 10UF 0402\t2\tC5,X1\tdef
s-skip\tUNUSED\t1\tU1\tx
";

/// Parity every FZ key word must have (published with OpenBoardView).
const FZ_PARITY: [u32; 44] = [
    0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 1, 0, 0, 1, 1, 0, 1,
];

/// A made-up key with the right parity; real keys are not part of Avero.
fn fz_test_key(seed: u32) -> avero_formats::formats::FzKey {
    std::array::from_fn(|i| {
        let v = (i as u32 ^ seed).wrapping_mul(0x9e37_79b9) ^ 0x5bd1_e995;
        if u32::from(v.count_ones().is_multiple_of(2)) == FZ_PARITY[i] {
            v
        } else {
            v ^ 1
        }
    })
}

fn zlib(data: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

/// Layout as OpenBoardView reads it: 4 bytes, content, part list, and a
/// trailing length from which the part list's start is found.
fn fz_fixture(content: &str) -> Vec<u8> {
    let c = zlib(content.as_bytes());
    let d = zlib(FZ_DESCR.as_bytes());
    let mut file = (content.len() as u32).to_le_bytes().to_vec();
    file.extend_from_slice(&c);
    file.extend_from_slice(&d);
    file.extend_from_slice(&((d.len() + 8) as u32).to_le_bytes());
    file
}

fn check_fz(board: &Board, scale: f64) {
    assert_eq!(board.format, FormatId::Fz);
    assert_eq!(board.parts.len(), 3);
    assert_eq!(board.pins.len(), 7);
    let part = |name: &str| board.parts.iter().find(|p| p.name == name).unwrap();
    assert_eq!(part("C5").side, Side::Bottom);
    assert_eq!(part("U1").side, Side::Top);
    assert_eq!(part("R7").device.as_deref(), Some("RES 10K 1% 0402"));
    assert_eq!(part("C5").device.as_deref(), Some("CAP 10UF 0402"));
    assert_eq!(part("U1").device, None);
    let u1 = part("U1");
    let pins = &board.pins[u1.first_pin as usize..(u1.first_pin + u1.pin_count) as usize];
    assert_eq!(pins.iter().map(|p| p.number.as_str()).collect::<Vec<_>>(), ["1", "2", "AJ43"]);
    assert_eq!(pins[0].name.as_deref(), Some("VCC"));
    assert!((pins[1].x - 150.5 * scale).abs() < 1e-6, "decimal comma");
    assert_eq!(board.test_points.len(), 2);
    assert_eq!(board.test_points[1].side, Side::Bottom);
    assert!(board.warnings.iter().any(|w| w.contains("not listed")));
    assert_eq!(board.outline.len(), 1);
}

#[test]
fn fz_plain() {
    check_fz(&parse(&fz_fixture(FZ_CONTENT), Some("board.fz")).unwrap(), 1.0);
}

#[test]
fn fz_in_millimeters() {
    let content = format!("UNIT:millimeters\n{FZ_CONTENT}");
    check_fz(&parse(&fz_fixture(&content), Some("board.fz")).unwrap(), 1000.0 / 25.4);
}

#[test]
fn fz_encrypted() {
    use avero_formats::formats::{fz_encrypt, fz_key_is_plausible};
    let key = fz_test_key(1);
    assert!(fz_key_is_plausible(&key));
    let file = fz_encrypt(&fz_fixture(FZ_CONTENT), &key);
    let with = |key| avero_formats::ParseOptions { fz_key: Some(key), ..Default::default() };

    assert_eq!(parse(&file, Some("board.fz")).unwrap_err(), ParseError::NeedsFzKey);
    let mut typo = key;
    typo[3] ^= 1;
    assert_eq!(
        avero_formats::parse_with(&file, Some("board.fz"), with(typo)).unwrap_err(),
        ParseError::InvalidFzKey
    );
    assert_eq!(
        avero_formats::parse_with(&file, Some("board.fz"), with(fz_test_key(2))).unwrap_err(),
        ParseError::InvalidFzKey
    );
    check_fz(&avero_formats::parse_with(&file, Some("board.fz"), with(key)).unwrap(), 1.0);
}

/// A made-up key with the parity pattern of CAE keys.
fn cae_test_key(seed: u32) -> avero_formats::formats::FzKey {
    const CAE_PARITY: [u32; 44] = [
        1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
        1, 0, 1, 1, 0, 1, 1, 1, 0, 0,
    ];
    std::array::from_fn(|i| {
        let v = (i as u32 ^ seed).wrapping_mul(0x85eb_ca6b) ^ 0xc2b2_ae35;
        if u32::from(v.count_ones().is_multiple_of(2)) == CAE_PARITY[i] {
            v
        } else {
            v ^ 1
        }
    })
}

#[test]
fn cae_is_fz_with_its_own_key() {
    use avero_formats::formats::{assign_fz_keys, fz_encrypt, fz_key_fits, FzVariant};
    let key = cae_test_key(7);
    assert!(fz_key_fits(&key, FzVariant::Cae));
    assert!(!fz_key_fits(&key, FzVariant::Fz));
    let file = fz_encrypt(&fz_fixture(FZ_CONTENT), &key);
    let with = |cae| avero_formats::ParseOptions { cae_key: cae, ..Default::default() };

    assert_eq!(parse(&file, Some("board.cae")).unwrap_err(), ParseError::NeedsCaeKey);
    let mut typo = key;
    typo[5] ^= 1;
    assert_eq!(
        avero_formats::parse_with(&file, Some("b.cae"), with(Some(typo))).unwrap_err(),
        ParseError::InvalidCaeKey
    );
    let b = avero_formats::parse_with(&file, Some("board.cae"), with(Some(key))).unwrap();
    assert_eq!(b.format, FormatId::Cae);
    assert_eq!(b.parts.len(), 3);
    // Plain (unencrypted) .cae files open without a key.
    assert_eq!(parse(&fz_fixture(FZ_CONTENT), Some("board.cae")).unwrap().format, FormatId::Cae);

    // Both keys in one settings field, in either order, sorted by parity.
    let fz = fz_test_key(1);
    assert_eq!(assign_fz_keys(&[key, fz]), (Some(fz), Some(key)));
    assert_eq!(assign_fz_keys(&[fz, key]), (Some(fz), Some(key)));
    assert_eq!(assign_fz_keys(&[fz]), (Some(fz), None));
    // A typo fits neither: both get it, so the file says "key wrong".
    let mut bad = fz;
    bad[0] ^= 1;
    assert_eq!(assign_fz_keys(&[bad]), (Some(bad), Some(bad)));
}

// --- KiCad and EAGLE ---------------------------------------------------------

const KICAD: &str = r#"(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "GND")
  (net 2 "PP3V3")
  (gr_rect (start 0 0) (end 50 30) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_line (start 0 0) (end 10 10) (layer "F.SilkS"))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (at 10 10 90)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS"))
    (property "Value" "10k" (at 0 0 0) (layer "F.Fab"))
    (pad "1" smd roundrect (at -0.5 0 90) (size 0.6 0.5) (layers "F.Cu") (net 2 "PP3V3"))
    (pad "2" smd roundrect (at 0.5 0 90) (size 0.6 0.5) (layers "F.Cu") (net 1 "GND")))
  (footprint "Connector:Pin" (layer "B.Cu") (at 40 20)
    (property "Reference" "J1")
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu") (net 1 "GND"))
    (pad "" np_thru_hole circle (at 3 0) (size 2 2) (drill 2) (layers "*.Cu")))
  (module R2 (layer B.Cu) (at 20 20 180) (fp_text reference R2 (at 0 0)) (fp_text value 1k (at 0 0))
    (pad 1 smd rect (at 1 0) (size 1 1) (layers B.Cu) (net 2 PP3V3)))
  (via (at 25 15) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))
)"#;

const MIL: f64 = 1000.0 / 25.4;

#[test]
fn kicad_boards() {
    let b = parse(KICAD.as_bytes(), Some("board.kicad_pcb")).unwrap();
    assert_eq!(b.format, FormatId::KiCad);
    let part = |name: &str| b.parts.iter().find(|p| p.name == name).unwrap();
    let pins = |name: &str| {
        let p = part(name);
        &b.pins[p.first_pin as usize..(p.first_pin + p.pin_count) as usize]
    };
    assert_eq!(part("R1").device.as_deref(), Some("10k"));
    assert_eq!(part("R1").side, Side::Top);
    // Pad 1 at (-0.5, 0), footprint turned 90° at (10, 10): (10, 10.5) mm, Y flipped.
    assert_close(pins("R1")[0].x, 10.0 * MIL);
    assert_close(pins("R1")[0].y, -10.5 * MIL);
    assert_eq!(b.nets[pins("R1")[0].net as usize].name, "PP3V3");
    // Through-hole parts are reachable from both sides.
    assert_eq!(part("J1").side, Side::Both);
    assert_eq!(part("J1").mount, Mount::ThroughHole);
    assert_eq!(pins("J1").len(), 1, "the unnamed mounting hole is not a pin");
    // KiCad 5 syntax.
    assert_eq!(part("R2").device.as_deref(), Some("1k"));
    assert_eq!(part("R2").side, Side::Bottom);
    assert_close(pins("R2")[0].x, 19.0 * MIL);
    assert_eq!(b.test_points.len(), 1);
    assert_eq!(b.test_points[0].kind, TestPointKind::Via);
    assert_eq!(b.nets[b.test_points[0].net as usize].name, "GND");
    assert_eq!(b.outline.len(), 1);
    assert_close(b.bounds.max_x, 50.0 * MIL);
}

const EAGLE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<eagle version="9.6.2"><drawing><board>
<plain>
<wire x1="0" y1="0" x2="50" y2="0" width="0" layer="20"/>
<wire x1="50" y1="0" x2="50" y2="30" width="0" layer="20"/>
<wire x1="50" y1="30" x2="0" y2="30" width="0" layer="20"/>
<wire x1="0" y1="30" x2="0" y2="0" width="0" layer="20" curve="180"/>
<wire x1="5" y1="5" x2="6" y2="6" width="0.2" layer="21"/>
</plain>
<libraries>
<library name="rcl"><packages><package name="R0402">
<smd name="1" x="-0.5" y="0" dx="0.6" dy="0.5" layer="1"/>
<smd name="2" x="0.5" y="0" dx="0.6" dy="0.5" layer="1"/>
</package></packages></library>
<library name="con"><packages><package name="PIN">
<pad name="1" x="1" y="0" drill="1" diameter="1.7"/>
</package></packages></library>
</libraries>
<elements>
<element name="R1" library="rcl" package="R0402" value="10k" x="10" y="10" rot="R90"/>
<element name="J1" library="con" package="PIN" value="" x="40" y="20" rot="MR0"/>
<element name="X9" library="gone" package="NONE" value="" x="1" y="1"/>
</elements>
<signals>
<signal name="GND"><contactref element="R1" pad="2"/><contactref element="J1" pad="1"/>
<via x="25" y="15" extent="1-16" drill="0.3" diameter="0.6"/></signal>
<signal name="PP3V3"><contactref element="R1" pad="1"/></signal>
</signals>
</board></drawing></eagle>"#;

#[test]
fn eagle_boards() {
    let b = parse(EAGLE.as_bytes(), Some("board.brd")).unwrap();
    assert_eq!(b.format, FormatId::Eagle);
    let part = |name: &str| b.parts.iter().find(|p| p.name == name).unwrap();
    let pins = |name: &str| {
        let p = part(name);
        &b.pins[p.first_pin as usize..(p.first_pin + p.pin_count) as usize]
    };
    assert_eq!(part("R1").device.as_deref(), Some("10k"));
    // Pad 1 at (-0.5, 0) turned 90° counter-clockwise around (10, 10): (10, 9.5) mm.
    assert_close(pins("R1")[0].x, 10.0 * MIL);
    assert_close(pins("R1")[0].y, 9.5 * MIL);
    assert_eq!(b.nets[pins("R1")[0].net as usize].name, "PP3V3");
    // Mirrored: the pad's x is flipped (through-hole, so both sides).
    assert_eq!(part("J1").side, Side::Both);
    assert_close(pins("J1")[0].x, 39.0 * MIL);
    assert_eq!(b.nets[pins("J1")[0].net as usize].name, "GND");
    assert_eq!(b.parts.len(), 2);
    assert!(b.warnings.iter().any(|w| w.contains("packages")));
    assert_eq!(b.test_points.len(), 1);
    // The curved edge bulges 15 mm to the left.
    assert!((b.bounds.min_x + 15.0 * MIL).abs() < 5.0, "{}", b.bounds.min_x);
}

#[test]
fn bvr3_with_absolute_pin_origins() {
    // Some writers store PIN_ORIGIN absolute (seen in real files), others
    // relative to PART_ORIGIN; the reader tells them apart per file.
    let file = "BVRAW_FORMAT_3\r\n\r\nPART_NAME U1\r\n\tPART_SIDE T\r\n\tPART_ORIGIN 2000 1500\r\n\tPART_MOUNT SMD\r\n\
        \tPIN_ID U1-1\r\n\t\tPIN_NUMBER 1\r\n\t\tPIN_SIDE T\r\n\t\tPIN_ORIGIN 1990 1500\r\n\t\tPIN_NET GND\r\n\tPIN_END\r\n\
        \tPIN_ID U1-2\r\n\t\tPIN_NUMBER 2\r\n\t\tPIN_SIDE T\r\n\t\tPIN_ORIGIN 2010 1500\r\n\t\tPIN_NET VCC\r\n\tPIN_END\r\n\
        PART_END\r\n\r\nOUTLINE_POINTS 0 0 4000 0 4000 3000 0 3000 0 0\r\n";
    let b = parse(file.as_bytes(), Some("board.bvr")).unwrap();
    assert_close(b.pins[0].x, 1990.0);
    assert_close(b.pins[1].x, 2010.0);
    assert_close(b.bounds.max_x, 4000.0);
}

#[test]
fn gencad_pad_shapes() {
    // Rectangular 20 × 40 mil pads, and an oblong pad drawn from lines and arcs.
    let src = GENCAD
        .replace("RECTANGLE -0.01 -0.01 0.02 0.02", "RECTANGLE -0.01 -0.02 0.02 0.04")
        .replace(
            "PAD TH60 ROUND 0.035\nCIRCLE 0 0 0.03",
            "PAD TH60 POLYGON 0.035\nLINE -0.02 -0.01 0.02 -0.01\nARC 0.02 -0.01 0.02 0.01 0.02 0\nLINE 0.02 0.01 -0.02 0.01\nARC -0.02 0.01 -0.02 -0.01 -0.02 0",
        );
    let b = parse(src.as_bytes(), Some("board.cad")).unwrap();
    let r1 = b.find_part("R1").unwrap();
    let pad = b.part_pins(r1)[0].pad.expect("rectangular pad");
    assert_close(pad.w, 20.0);
    assert_close(pad.h, 40.0);
    // R1 is rotated by 90°: the pad turns with it.
    assert_close(pad.angle, 90.0);
    assert!(!pad.round);
    let j1 = b.find_part("J1").unwrap();
    let oblong = b.part_pins(j1)[0].pad.expect("oblong pad");
    assert_close(oblong.w, 60.0);
    assert_close(oblong.h, 20.0);
    assert!(oblong.round);
}

#[test]
fn altium_pcbdoc_is_named_not_unknown() {
    let mut ole = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    ole.resize(512, 0);
    assert_eq!(
        avero_formats::detect(&ole, Some("Main.PcbDoc")),
        avero_formats::Detected::Unsupported("Altium PcbDoc")
    );
    assert_eq!(parse(&ole, Some("Main.PcbDoc")).unwrap_err(), ParseError::Unsupported("Altium PcbDoc"));
}

// --- Robustness ----------------------------------------------------------------

/// Damaged files of every format: flipped bytes, cuts and repeats must give an
/// error or a board, never a panic (a panic would end the open in the app).
const ALTIUM: &str = "|RECORD=Board|KIND=Protel_Advanced_PCB|VERSION=5.01|VX0=0mil|VY0=0mil|KIND0=0|VX1=1000mil|VY1=0mil|KIND1=0|VX2=1000mil|VY2=500mil|KIND2=0|VX3=0mil|VY3=500mil|KIND3=0
|RECORD=Net|ID=0|NAME=GND
|RECORD=Net|ID=1|NAME=PP3V3 S5
|RECORD=Component|ID=0|LAYER=TOP|X=100mil|Y=100mil|ROTATION=0|PATTERN=C0402|SOURCEDESIGNATOR=C1|SOURCELIBREFERENCE=CAP 100nF
|RECORD=Component|ID=1|LAYER=BOTTOM|X=500mil|Y=200mil|ROTATION=90|PATTERN=HDR1X2|SOURCEDESIGNATOR=J1
|RECORD=Pad|INDEXFORSAVE=0|LAYER=TOP|NET=1|COMPONENT=0|NAME=1|X=80mil|Y=100mil|XSIZE=20mil|YSIZE=24mil|SHAPE=RECTANGLE|ROTATION=90
|RECORD=Pad|INDEXFORSAVE=1|LAYER=TOP|NET=0|COMPONENT=0|NAME=2|X=120mil|Y=100mil|XSIZE=20mil|YSIZE=24mil|SHAPE=RECTANGLE|ROTATION=90
|RECORD=Pad|INDEXFORSAVE=2|LAYER=MULTILAYER|NET=0|COMPONENT=1|NAME=1|X=500mil|Y=150mil|XSIZE=60mil|YSIZE=60mil|SHAPE=ROUND
|RECORD=Pad|INDEXFORSAVE=3|LAYER=MULTILAYER|COMPONENT=1|NAME=2|X=500mil|Y=250mil|XSIZE=60mil|YSIZE=60mil|SHAPE=ROUND
|RECORD=Pad|INDEXFORSAVE=4|LAYER=BOTTOM|NET=1|NAME=TP7|X=2.54mm|Y=300mil|XSIZE=40mil|YSIZE=40mil|SHAPE=ROUND
|RECORD=Via|X=300mil|Y=300mil|DIAMETER=20mil|HOLESIZE=10mil|NET=0
|RECORD=Track|LAYER=TOP|NET=1|X1=80mil|Y1=100mil|X2=80mil|Y2=300mil|WIDTH=8mil
|RECORD=Track|LAYER=TOPOVERLAY|COMPONENT=0|X1=0mil|Y1=0mil|X2=10mil|Y2=0mil|WIDTH=5mil
|RECORD=Track|LAYER=KEEPOUT|X1=0mil|Y1=0mil|X2=10mil|Y2=10mil|WIDTH=5mil
";

#[test]
fn altium_ascii_pcbdoc() {
    let b = parse(ALTIUM.as_bytes(), Some("board.PcbDoc")).unwrap();
    assert_eq!(b.format, FormatId::Altium);
    assert_eq!(b.parts.len(), 2);
    let c1 = part(&b, "C1");
    assert_eq!(c1.side, Side::Top);
    assert_eq!(c1.device.as_deref(), Some("CAP 100nF C0402"));
    let pins = &b.pins[c1.first_pin as usize..(c1.first_pin + c1.pin_count) as usize];
    assert_eq!(pins.len(), 2);
    let pin1 = pins.iter().find(|p| p.number == "1").unwrap();
    assert_close(pin1.x, 80.0);
    assert_close(pin1.y, 100.0);
    assert_eq!(net_name(&b, pin1), "PP3V3 S5");
    let pad = pin1.pad.as_ref().unwrap();
    assert_close(pad.w, 20.0);
    assert_close(pad.angle, 90.0);
    // Through-hole connector on the bottom; the pad without a net is unconnected.
    let j1 = part(&b, "J1");
    assert_eq!(j1.mount, Mount::ThroughHole);
    let j1_pins = &b.pins[j1.first_pin as usize..(j1.first_pin + j1.pin_count) as usize];
    assert!(j1_pins.iter().any(|p| net_name(&b, p) == "GND"));
    // A free pad with a net is a test pad; millimetres are converted.
    let tp = b.test_points.iter().find(|t| t.kind == TestPointKind::Nail).unwrap();
    assert_close(tp.x, 100.0);
    assert_eq!(b.nets[tp.net as usize].name, "PP3V3 S5");
    assert_eq!(b.test_points.iter().filter(|t| t.kind == TestPointKind::Via).count(), 1);
    // Copper tracks with a net become traces; overlay and keep-out do not.
    assert_eq!(b.traces.len(), 1);
    // The board shape wins over keep-out lines.
    assert_close(b.outline.iter().flatten().map(|p| p.x).fold(0.0, f64::max), 1000.0);
    // The binary format stays named.
    assert!(matches!(
        parse(&[0xD0, 0xCF, 0x11, 0xE0, 1, 2, 3], Some("x.PcbDoc")),
        Err(ParseError::Unsupported(_))
    ));
}

const ALLEGRO: &str = "J!demo.brd!Mon Oct 05 12:00:00 2026!0.0!0.0!50.0!30.0!0.001!millimeters!
A!REFDES!COMP_CLASS!COMP_PART_NUMBER!COMP_DEVICE_TYPE!SYM_NAME!SYM_MIRROR!SYM_ROTATE!SYM_X!SYM_Y!COMP_VALUE!
S!U1!IC!TPS51125!TPS51125_QFN24!QFN24!NO!0!10.0!10.0!!
S!C1!DISCRETE!!CAP_0402!C0402!YES!90!30.0!10.0!100NF!
S!J1!IO!!HDR2!HDR2!NO!0!40.0!20.0!!
A!PAD_NAME!REC_NUMBER!LAYER!FIXFLAG!VIAFLAG!PADSHAPE1!PADWIDTH!PADHGHT!PADXOFF!PADYOFF!
S!SMD_R!1!TOP!!!RECTANGLE!0.6!0.3!0!0!
S!TH_60!1!TOP!!!CIRCLE!1.5!1.5!0!0!
S!TH_60!2!BOTTOM!!!CIRCLE!1.5!1.5!0!0!
S!VIA10!1!TOP!!!CIRCLE!0.4!0.4!0!0!
A!SYM_NAME!SYM_MIRROR!PIN_NAME!PIN_NUMBER!PIN_X!PIN_Y!PAD_STACK_NAME!REFDES!PIN_ROTATION!TEST_POINT!
S!QFN24!NO!VIN!1!9.5!10.0!SMD_R!U1!90!!
S!QFN24!NO!GND!2!10.5!10.0!SMD_R!U1!90!!
S!C0402!YES!1!1!29.5!10.0!SMD_R!C1!0!!
S!C0402!YES!2!2!30.5!10.0!SMD_R!C1!0!!
S!HDR2!NO!1!1!40.0!20.0!TH_60!J1!0!!
S!HDR2!NO!2!2!42.54!20.0!TH_60!J1!0!!
A!NET_NAME!REFDES!PIN_NUMBER!PIN_NAME!PIN_GROUND!PIN_POWER!
S!+19V!U1!1!VIN!!!
S!GND!U1!2!GND!!!
S!+19V!C1!1!1!!!
S!GND!C1!2!2!!!
S!+19V!J1!1!1!!!
S!GND!J1!2!2!!!
A!VIA_X!VIA_Y!PAD_STACK_NAME!NET_NAME!TEST_POINT!VIA_MIRROR!VIA_ROTATION!
S!20.0!15.0!VIA10!+19V!!NO!0!
S!25.0!15.0!VIA10!GND!PROBE_TOP!NO!0!
A!CLASS!SUBCLASS!GRAPHIC_DATA_NAME!GRAPHIC_DATA_NUMBER!RECORD_TAG!GRAPHIC_DATA_1!GRAPHIC_DATA_2!GRAPHIC_DATA_3!GRAPHIC_DATA_4!GRAPHIC_DATA_5!GRAPHIC_DATA_6!GRAPHIC_DATA_7!GRAPHIC_DATA_8!GRAPHIC_DATA_9!GRAPHIC_DATA_10!SYMBOL_NAME!REFDES!NET_NAME!
S!BOARD GEOMETRY!OUTLINE!LINE!1!1 1 0!0.0!0.0!50.0!0.0!0.1!!!!!!!!!
S!BOARD GEOMETRY!OUTLINE!LINE!2!2 1 0!50.0!0.0!50.0!30.0!0.1!!!!!!!!!
S!BOARD GEOMETRY!OUTLINE!ARC!3!3 1 0!50.0!30.0!40.0!30.0!45.0!30.0!5.0!0.1!COUNTERCLOCKWISE!!!!!
S!BOARD GEOMETRY!OUTLINE!LINE!4!4 1 0!40.0!30.0!0.0!30.0!0.1!!!!!!!!!
S!BOARD GEOMETRY!OUTLINE!LINE!5!5 1 0!0.0!30.0!0.0!0.0!0.1!!!!!!!!!
S!ETCH!TOP!LINE!6!6 1 0!9.5!10.0!20.0!15.0!0.2!!!!!!!!+19V!
S!ETCH!TOP!LINE!7!7 1 0!20.0!15.0!29.5!10.0!0.2!!!!!!!!+19V!
";

#[test]
fn allegro_ascii_extract() {
    let b = parse(ALLEGRO.as_bytes(), Some("board.txt")).unwrap();
    assert_eq!(b.format, FormatId::AllegroAscii);
    assert_eq!(b.parts.len(), 3);
    let u1 = part(&b, "U1");
    assert_eq!(u1.side, Side::Top);
    assert_eq!(u1.device.as_deref(), Some("TPS51125_QFN24"));
    let pins = &b.pins[u1.first_pin as usize..(u1.first_pin + u1.pin_count) as usize];
    // Millimetres to mils.
    assert_close(pins[0].x, 9.5 * MIL);
    assert_eq!(net_name(&b, &pins[0]), "+19V");
    assert_eq!(pins[0].name.as_deref(), Some("VIN"));
    let pad = pins[0].pad.as_ref().unwrap();
    assert_close(pad.w, 0.6 * MIL);
    assert_close(pad.angle, 90.0);
    // Mirrored component on the bottom, its value with the device.
    let c1 = part(&b, "C1");
    assert_eq!(c1.side, Side::Bottom);
    assert_eq!(c1.device.as_deref(), Some("CAP_0402 100NF"));
    // A pad stack on both outer layers is through-hole.
    assert_eq!(part(&b, "J1").mount, Mount::ThroughHole);
    assert_eq!(b.test_points.iter().filter(|t| t.kind == TestPointKind::Via).count(), 1);
    assert_eq!(b.test_points.iter().filter(|t| t.kind == TestPointKind::Nail).count(), 1);
    assert_eq!(b.traces.len(), 2);
    assert_close(b.bounds.max_x, 50.0 * MIL);
    // The arc bulges above the top edge.
    assert!(b.outline.iter().flatten().any(|p| p.y > 30.0 * MIL + 1.0));
}

#[test]
fn damaged_files_never_panic() {
    let samples: Vec<(&str, Vec<u8>)> = vec![
        ("board.brd", BRD.as_bytes().to_vec()),
        ("board.gcd", GENCAD.as_bytes().to_vec()),
        ("board.cst", cst_fixture()),
        ("board.pcb", xzz_fixture(0x5a)),
        ("board.fz", fz_fixture(FZ_CONTENT)),
        ("board.kicad_pcb", KICAD.as_bytes().to_vec()),
        ("board.brd", EAGLE.as_bytes().to_vec()),
        ("board.PcbDoc", ALTIUM.as_bytes().to_vec()),
        ("board.txt", ALLEGRO.as_bytes().to_vec()),
    ];
    // A fixed pseudo-random sequence, so a failure can be repeated.
    let mut seed: u64 = 0x2545_f491_4f6c_dd1d;
    let mut rand = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for (name, data) in &samples {
        for round in 0..400 {
            let mut d = data.clone();
            match round % 4 {
                0 => {
                    for _ in 0..1 + rand() % 8 {
                        let i = (rand() as usize) % d.len();
                        d[i] = rand() as u8;
                    }
                }
                1 => d.truncate((rand() as usize) % d.len()),
                2 => {
                    let at = (rand() as usize) % d.len();
                    let piece = d[at..(at + 64).min(d.len())].to_vec();
                    d.splice(at..at, piece);
                }
                _ => {
                    let i = (rand() as usize) % d.len();
                    d[i..].iter_mut().for_each(|b| *b = b.wrapping_add(rand() as u8));
                }
            }
            let options = avero_formats::ParseOptions { xzz_key: Some(XZZ_KEY), ..Default::default() };
            let r = std::panic::catch_unwind(|| avero_formats::parse_with(&d, Some(name), options));
            assert!(r.is_ok(), "{name} round {round} panicked");
        }
    }
}
