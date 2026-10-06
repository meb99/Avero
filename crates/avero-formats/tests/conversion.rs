//! Synthetic XZZ files only. Real manufacturer boards stay outside the repository.
use avero_formats::{
    convert::{conversion_report, original_xzz, xzz_to_gencad},
    formats::xzz_encrypt,
    parse, FormatId, NetKind, Side,
};

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
            assert_eq!(c.report.preserved_blocks.len(), 1);
            assert!(b.warnings.iter().any(|w| w.contains("undocumented")));
            assert_eq!(original_xzz(&c.cad).unwrap().as_deref(), Some(input.as_slice()));
            assert!(String::from_utf8(c.cad).unwrap().contains("RECTANGLE -2 -1 4 2"));
        }
    }
}

fn get(data: &[u8], offset: usize) -> usize {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize
}

/// Rebuild section addresses after changing a synthetic main block.
fn edit_main(input: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let n = get(input, 0x60);
    let mut main = input[0x64..0x64 + n].to_vec();
    edit(&mut main);
    let mut out = input[..0x64].to_vec();
    put(&mut out, 0x60, main.len() as u32);
    let delta = main.len() as i64 - n as i64;
    put(&mut out, 0x28, (get(input, 0x28) as i64 + delta) as u32);
    out.extend(main);
    out.extend(&input[0x64 + n..]);
    out
}

fn edit_part(input: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    edit_main(input, |main| {
        let mut offset = 4;
        while main[offset] != 7 {
            offset += 5 + get(main, offset + 1);
        }
        let old_end = offset + 5 + get(main, offset + 1);
        let body = &main[offset + 5..old_end];
        let mut part = body[..4 + get(body, 0)].to_vec();
        edit(&mut part);
        let n = part.len() - 4;
        put(&mut part, 0, n as u32);
        let mut replacement = Vec::new();
        block(&mut replacement, 7, &part);
        main.splice(offset..old_end, replacement);
    })
}

fn with_tail(input: &[u8], tail: &[u8]) -> Vec<u8> {
    let end = input.windows(11).position(|w| w == b"v6v6555v6v6").unwrap() + 11;
    let mut out = input[..end].to_vec();
    out.extend(tail);
    out
}

fn line_body(layer: u32, edge: [u32; 4], net: u32) -> Vec<u8> {
    let mut out = Vec::new();
    word(&mut out, layer);
    for n in edge {
        word(&mut out, n * 10000);
    }
    word(&mut out, 10000);
    word(&mut out, net);
    out
}

#[test]
fn rotated_component_body_and_global_pad_axes_survive_round_trip() {
    let input = edit_part(&fixture(false, 0, true, 16), |part| {
        for edge in [[105, 201, 135, 201], [135, 201, 135, 216], [135, 216, 105, 216], [105, 216, 105, 201]] {
            block(part, 5, &line_body(17, edge, 0));
        }
    });
    let c = xzz_to_gencad(&input, "body", None).unwrap();
    let b = parse(&c.cad, None).unwrap();
    let body = &b.parts[0];
    assert_eq!(body.side, Side::Bottom);
    assert!((body.bounds.min_x - 5.0).abs() < 1e-6);
    assert!((body.bounds.max_x - 35.0).abs() < 1e-6);
    assert!((body.bounds.min_y - 1.0).abs() < 1e-6);
    assert!((body.bounds.max_y - 16.0).abs() < 1e-6);
    let pad = b.pins[0].pad.unwrap();
    assert_eq!((pad.w, pad.h, pad.angle), (4.0, 2.0, 0.0));
    assert_eq!((c.report.contours, c.report.texts), (4, 2));
    let text = String::from_utf8(c.cad).unwrap();
    let components = text.split("$COMPONENTS\n").nth(1).unwrap().split("$ENDCOMPONENTS").next().unwrap();
    assert!(components.contains("TEXT "));
    assert!(!text.split("$DEVICES\n").nth(1).unwrap().split("$ENDDEVICES").next().unwrap().contains("TEXT "));
}

#[test]
fn via_drill_blind_span_and_declared_inner_layers_survive() {
    let input = edit_main(&fixture(false, 0, true, 1), |main| {
        block(main, 5, &line_body(2, [111, 205, 120, 210], 5));
        block(main, 5, &line_body(3, [111, 205, 120, 210], 5));
        for (from, to, x) in [(1, 3, 112), (2, 3, 114), (3, 16, 116)] {
            let mut via = Vec::new();
            for n in [x * 10000, 2090000, 40000, 15000, from, to, 5] {
                word(&mut via, n);
            }
            block(main, 2, &via);
        }
    });
    let c = xzz_to_gencad(&input, "vias", None).unwrap();
    let b = parse(&c.cad, None).unwrap();
    assert_eq!(b.test_points.len(), 4);
    let [top, inner, bottom] = [&b.test_points[1], &b.test_points[2], &b.test_points[3]];
    assert_eq!((top.side, bottom.side), (Side::Top, Side::Bottom));
    assert!((top.radius - 4.0).abs() < 1e-6);
    assert_eq!(top.via.as_ref().unwrap().drill, 3.0);
    assert_eq!(top.via.as_ref().unwrap().layers, ["TOP", "LAYER_2", "LAYER_3"]);
    assert!(inner.via.as_ref().unwrap().buried);
    assert!(!bottom.via.as_ref().unwrap().buried);
    assert!(b.layers.iter().filter(|l| l.name.starts_with("LAYER_")).all(|l| l.side == Side::Both));
}

#[test]
fn major_wrap_and_full_circle_copper_arcs_keep_their_net() {
    let input = edit_main(&fixture(false, 0, true, 1), |main| {
        for (start, end, x) in [(0, 270, 115), (270, 90, 125), (0, 360, 135)] {
            let mut a = Vec::new();
            for n in [2, x * 10000, 2100000, 50000, start * 10000, end * 10000, 10000, 7] {
                word(&mut a, n);
            }
            block(main, 1, &a);
        }
    });
    let c = xzz_to_gencad(&input, "arcs", None).unwrap();
    assert_eq!(c.report.arcs, 3);
    let text = String::from_utf8(c.cad.clone()).unwrap();
    assert!(text.contains("ARC 20 10 15 5 15 10"));
    assert!(text.contains("ARC 25 5 25 15 25 10"));
    assert!(text.contains("CIRCLE 35 10 5"));
    let b = parse(&c.cad, None).unwrap();
    let arcs: Vec<_> = b.traces.iter().filter(|t| b.nets[t.net as usize].name == "VCC space").collect();
    assert!(arcs.iter().any(|t| t.x2 < 11.0), "the major arc must reach its left half");
    assert!(arcs.iter().all(|t| t.side == Side::Both));
    assert!(arcs.iter().any(|t| t.x2 > 39.0), "a full circle must not disappear");
}

#[test]
fn readings_survive_saved_cad_utf8_gbk_and_all_line_endings() {
    for header in ["阻值".as_bytes(), &[0xd7, 0xe8, 0xd6, 0xb5][..]] {
        for separator in ["\n", "\r\n", "\r"] {
            let mut tail = b"===".to_vec();
            tail.extend(header);
            tail.extend(format!("{separator}=480=U1(1){separator}=OL=U1(2){separator}").as_bytes());
            let input = with_tail(&fixture(true, 0x44, true, 1), &tail);
            let c = xzz_to_gencad(&input, "readings", None).unwrap();
            assert_eq!((c.report.readings, c.report.assigned_readings), (2, 2));
            let b = parse(&c.cad, None).unwrap();
            assert_eq!(b.readings[0].value, Some(0.480));
            assert_eq!(b.readings[1].value, None);
            let mut b2 = b.clone();
            avero_formats::attach_xzz_readings(&mut b2, avero_formats::xzz_readings(&input));
            assert_eq!(b2.readings, b.readings, "original load must not attach the same readings twice");
            assert_eq!(original_xzz(&c.cad).unwrap().as_deref(), Some(input.as_slice()));
        }
    }
}

#[test]
fn annotations_images_unknown_blocks_and_metadata_are_retained() {
    let input = edit_main(&fixture(false, 0, true, 1), |main| {
        block(main, 8, b"unknown main bytes");
        let mut text = label("Connector note");
        put(&mut text, 0, 17);
        put(&mut text, 4, 1050000);
        put(&mut text, 8, 2050000);
        block(main, 6, &text);
    });
    let mut input =
        with_tail(&input, "===电压\nVCC=3.3\n===Custom section\n{\"anything\":true}\n".as_bytes());
    let marker = input.windows(11).position(|w| w == b"v6v6555v6v6").unwrap();
    let mut image = vec![1, 0, 0];
    word(&mut image, 640);
    word(&mut image, 480);
    word(&mut image, 9);
    image.extend(b"board.png");
    put(&mut input, 0x24, (marker - 0x20) as u32);
    let mut section = Vec::new();
    word(&mut section, image.len() as u32);
    section.extend(image);
    input.splice(marker..marker, section);
    let c = xzz_to_gencad(&input, "metadata", None).unwrap();
    assert_eq!(original_xzz(&c.cad).unwrap().unwrap(), input);
    let report = conversion_report(&c.cad).unwrap().unwrap();
    assert_eq!(report.images[0].name, "board.png");
    assert_eq!((report.images[0].width, report.images[0].height), (640, 480));
    assert_eq!(report.board_texts[0].text, "Connector note");
    assert_eq!(report.board_texts[0].x, 105.0);
    assert_eq!(report.sections[0].name, "电压");
    assert!(report.sections[1].text.contains("anything"));
    assert_eq!(report.preserved_blocks.len(), 2);
    let main_block = report.preserved_blocks.iter().find(|b| b.scope == "main").unwrap();
    assert_eq!(input[main_block.offset], 8);
}

#[test]
fn bad_archive_lengths_corruption_and_truncation_fail_without_panicking() {
    let c = xzz_to_gencad(&fixture(true, 0x44, true, 1), "archive", None).unwrap();
    let text = String::from_utf8(c.cad).unwrap();
    assert!(original_xzz(b"$HEADER\nGENCAD 1.4\n$ENDHEADER\n").unwrap().is_none());
    let bad_size = text.replace(&format!("SOURCE_BYTES {}", c.report.source_bytes), "SOURCE_BYTES 1");
    assert!(original_xzz(bad_size.as_bytes()).is_err());
    let missing_end = text.replace("ATTRIBUTE AVERO_XZZ END 1", "");
    assert!(original_xzz(missing_end.as_bytes()).is_err());
    let at = text.find("DATA ").unwrap() + 5;
    let mut damaged = text.into_bytes();
    damaged[at] = b'z';
    assert!(parse(&damaged, None).is_err(), "a damaged archive must not silently lose measurements");
}

#[test]
fn converted_two_view_xzz_opens_with_top_and_bottom_on_one_board() {
    let input = edit_main(&fixture(false, 0, true, 1), |main| {
        let mut offset = 4;
        while main[offset] != 7 {
            offset += 5 + get(main, offset + 1);
        }
        let start = offset + 5;
        let mut part = main[start..start + get(main, offset + 1)].to_vec();
        let x = get(&part, 8) as u32;
        put(&mut part, 8, x + 600000);
        let mut sub = 26 + get(&part, 22);
        let end = 4 + get(&part, 0);
        part[sub + 5 + 31] = b'2'; // first label U1 → U2
        while sub < end {
            let kind = part[sub];
            sub += 1;
            if kind == 0 {
                continue;
            }
            let n = get(&part, sub);
            sub += 4;
            if kind == 9 {
                let x = get(&part, sub + 4) as u32;
                put(&mut part, sub + 4, x + 600000);
            }
            sub += n;
        }
        block(main, 7, &part);
        for edge in [[160, 200, 200, 200], [200, 200, 200, 220], [200, 220, 160, 220], [160, 220, 160, 200]] {
            block(main, 5, &line_body(28, edge, 0));
        }
    });
    let c = xzz_to_gencad(&input, "two sides", None).unwrap();
    let b = parse(&c.cad, None).unwrap();
    assert_eq!(b.parts.len(), 2);
    assert_eq!(b.pins.len(), 6);
    assert_eq!(b.parts[0].side, Side::Top);
    assert_eq!(b.parts[1].side, Side::Bottom);
    assert_eq!(b.outline.len(), 1);
    assert!((b.bounds.width() - 40.0).abs() < 1e-6);
    assert_eq!(original_xzz(&c.cad).unwrap().unwrap(), input);
}

#[test]
fn ambiguous_and_missing_measurement_names_are_reported_without_guessing() {
    let input = edit_part(&fixture(false, 0, true, 1), |part| {
        block(part, 9, &pin("1", 133, 215, 7, false, 1)); // two pins called 1
    });
    let input = with_tail(&input, "===阻值\n=480=U1(1)\n=500=U1(1_2)\n=250=U1(2)\n".as_bytes());
    let c = xzz_to_gencad(&input, "ambiguous", None).unwrap();
    let b = parse(&c.cad, None).unwrap();
    assert_eq!((c.report.readings, c.report.assigned_readings), (3, 1));
    assert_eq!(b.readings[0].pin, "2");
    assert!(b.warnings.iter().any(|w| w.contains("ambiguous")));
    assert!(b.warnings.iter().any(|w| w.contains("absent")));
    assert_eq!(original_xzz(&c.cad).unwrap().unwrap(), input);
}

#[test]
fn gbk_component_name_and_measurement_target_are_decoded_consistently() {
    let input = edit_part(&fixture(false, 0, true, 1), |part| {
        let at = 26 + get(part, 22);
        // GBK 电, two bytes just like the synthetic name U1.
        part[at + 35..at + 37].copy_from_slice(&[0xb5, 0xe7]);
    });
    let input = with_tail(&input, b"===\xd7\xe8\xd6\xb5\n=480=\xb5\xe7(1)\n");
    let c = xzz_to_gencad(&input, "GBK", None).unwrap();
    let b = parse(&c.cad, None).unwrap();
    assert_eq!(b.parts[0].name, "电");
    assert_eq!(b.readings[0].part, "电");
    assert_eq!(b.readings[0].value, Some(0.480));
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
