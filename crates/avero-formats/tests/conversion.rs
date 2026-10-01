//! Synthetic XZZ files only. Real manufacturer boards stay outside the repository.
use avero_formats::{convert::xzz_to_gencad, formats::xzz_encrypt, parse, FormatId, NetKind};

fn word(data: &mut Vec<u8>, n: u32) {
    data.extend(n.to_le_bytes());
}
fn put(data: &mut [u8], offset: usize, n: u32) {
    data[offset..offset + 4].copy_from_slice(&n.to_le_bytes());
}
fn block(out: &mut Vec<u8>, kind: u8, body: &[u8]) {
    out.push(kind);
    word(out, body.len() as u32);
    out.extend(body);
}
fn label(s: &str) -> Vec<u8> {
    let mut b = vec![0; 30];
    put(&mut b, 26, s.len() as u32);
    b.extend(s.as_bytes());
    b
}
fn pin(name: &str, x: u32, y: u32, net: u32, short: bool, layer: u32) -> Vec<u8> {
    let mut b = vec![0; 24];
    put(&mut b, 0, layer);
    put(&mut b, 4, x * 10000);
    put(&mut b, 8, y * 10000);
    put(&mut b, 16, 900000);
    put(&mut b, 20, name.len() as u32);
    b.extend(name.as_bytes());
    for _ in 0..3 {
        word(&mut b, 40000);
        word(&mut b, 20000);
        b.push(2);
    }
    b.extend([0; 5]);
    word(&mut b, net);
    if !short {
        b.extend([0; 8]);
    }
    b
}
fn fixture(encrypted: bool, xor: u8, with_pins: bool, layer: u32) -> Vec<u8> {
    let mut part = vec![0; 26];
    put(&mut part, 8, 1000000);
    put(&mut part, 12, 2000000);
    put(&mut part, 16, 900000);
    put(&mut part, 22, 3);
    part.extend(b"QFN");
    block(&mut part, 6, &label("U1"));
    block(&mut part, 6, &label("MCU"));
    if with_pins {
        block(&mut part, 9, &pin("1", 110, 205, 5, false, layer));
        block(&mut part, 9, &pin("2", 125, 210, 7, true, layer));
        block(&mut part, 9, &pin("3", 130, 210, 8, false, layer));
    }
    block(&mut part, 3, &[b'x'; 9]);
    let size = part.len() - 4;
    put(&mut part, 0, size as u32);
    part.resize(part.len().div_ceil(8) * 8 + 3, 0);
    if encrypted {
        part = xzz_encrypt(&part, 0xDCFC_12AC_0000_0000);
    }
    let mut main = vec![0; 4];
    for edge in [[100, 200, 140, 200], [140, 200, 140, 220], [140, 220, 100, 220], [100, 220, 100, 200]] {
        let mut b = Vec::new();
        word(&mut b, 28);
        for n in edge {
            word(&mut b, n * 10000);
        }
        word(&mut b, 10000);
        word(&mut b, 0);
        block(&mut main, 5, &b);
    }
    block(&mut main, 7, &part);
    let mut trace = Vec::new();
    for n in [1, 1100000, 2050000, 1250000, 2100000, 20000, 5] {
        word(&mut trace, n);
    }
    block(&mut main, 5, &trace);
    let mut via = Vec::new();
    for n in [1150000, 2100000, 30000, 0, 1, 16, 5] {
        word(&mut via, n);
    }
    block(&mut main, 2, &via);
    let mut nets = Vec::new();
    for (id, name) in [(5, "GND"), (7, "VCC space"), (8, "NC")] {
        word(&mut nets, 8 + name.len() as u32);
        word(&mut nets, id);
        nets.extend(name.as_bytes());
    }
    let mut file = vec![0; 0x64];
    file[..6].copy_from_slice(b"XZZPCB");
    put(&mut file, 0x20, 0x40);
    put(&mut file, 0x60, main.len() as u32);
    file.extend(main);
    let net_offset = file.len() - 0x20;
    put(&mut file, 0x28, net_offset as u32);
    word(&mut file, nets.len() as u32);
    file.extend(nets);
    if xor != 0 {
        for b in &mut file {
            *b ^= xor;
        }
    }
    file.extend(b"v6v6555v6v6 metadata");
    file
}

#[test]
fn real_layout_plain_and_encrypted_round_trip() {
    for encrypted in [false, true] {
        for xor in [0, 0x6b] {
            let input = fixture(encrypted, xor, true, 1);
            let c = xzz_to_gencad(&input, "board", None).unwrap();
            assert_eq!((c.parts, c.pins, c.traces, c.vias), (1, 3, 1, 1));
            let b = parse(&c.cad, Some("converted.cad")).unwrap();
            assert_eq!(b.format, FormatId::GenCad);
            assert_eq!(b.parts.len(), 1);
            assert_eq!(b.pins.len(), 3);
            assert_eq!(b.test_points.len(), 1);
            assert_eq!(b.traces.len(), 1);
            assert_eq!(b.parts[0].name, "U1");
            assert_eq!(b.parts[0].device.as_deref(), Some("MCU · QFN"));
            for (p, (x, y, name)) in b.pins.iter().zip([
                (10.0, 5.0, "GND"),
                (25.0, 10.0, "VCC space"),
                (30.0, 10.0, "UNCONNECTED"),
            ]) {
                assert!((p.x - x).abs() < 1e-7);
                assert!((p.y - y).abs() < 1e-7);
                assert_eq!(b.nets[p.net as usize].name, name);
            }
            assert_eq!(b.nets[b.pins[2].net as usize].kind, NetKind::Unconnected);
            assert!((b.bounds.width() - 40.0).abs() < 1e-7);
            assert!((b.bounds.height() - 20.0).abs() < 1e-7);
            assert!(b.warnings.is_empty(), "{:?}", b.warnings);
            assert!(String::from_utf8(c.cad).unwrap().contains("RECTANGLE -2 -1 4 2"));
        }
    }
}

#[test]
fn bottom_layer_and_position_survive_conversion() {
    let c = xzz_to_gencad(&fixture(true, 0, true, 16), "bottom", None).unwrap();
    let b = parse(&c.cad, Some("bottom.cad")).unwrap();
    assert_eq!(b.parts[0].side, avero_formats::Side::Bottom);
    assert!(b.pins.iter().all(|p| p.side == avero_formats::Side::Bottom));
    assert!((b.pins[0].x - 10.0).abs() < 1e-7);
    assert!((b.pins[0].y - 5.0).abs() < 1e-7);
}

#[test]
fn truncated_input_and_zero_pin_boards_do_not_become_empty_cad() {
    let file = fixture(true, 0, true, 1);
    for end in 0..file.len() {
        let r = std::panic::catch_unwind(|| xzz_to_gencad(&file[..end], "test", None));
        assert!(r.is_ok(), "panic at {end}");
    }
    assert!(xzz_to_gencad(&fixture(true, 0, false, 1), "test", None).is_err());
    assert!(xzz_to_gencad(&file, "test", Some(0)).is_err());
}
