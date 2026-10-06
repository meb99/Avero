//! Optional CLI for reproducible conversions and bit-exact source recovery.
//! Avero uses the same Rust converter directly from its file picker.
use std::{io::Read, process::ExitCode};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let (restore, input, output, key) = match args.as_slice() {
        [input, output] => (false, input, output, None),
        [flag, input, output] if flag == "--restore-source" => (true, input, output, None),
        [input, output, flag, value] if flag == "--xzz-key" => {
            let key = avero_formats::formats::parse_xzz_key(value).ok_or("Invalid hexadecimal XZZ key")?;
            (false, input, output, Some(key))
        }
        _ => return Err("Usage: xzz-to-gencad input.pcb output.cad [--xzz-key HEX]\n       xzz-to-gencad --restore-source input.cad output.pcb".into()),
    };
    if std::path::Path::new(input).canonicalize()?
        == std::path::Path::new(output).canonicalize().unwrap_or_default()
    {
        return Err("Input and output must be different files".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(input)?.take(avero_formats::MAX_FILE_SIZE as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > avero_formats::MAX_FILE_SIZE {
        return Err("Input is too large".into());
    }
    let result = if restore {
        avero_formats::convert::original_xzz(&bytes)?.ok_or("This CAD has no embedded XZZ source")?
    } else {
        let drawing = std::path::Path::new(input).file_stem().and_then(|s| s.to_str()).unwrap_or("XZZ board");
        let converted = avero_formats::convert::xzz_to_gencad(&bytes, drawing, key)?;
        eprintln!(
            "{} parts, {} pins, {} traces, {} vias; {}/{} readings assigned",
            converted.parts,
            converted.pins,
            converted.traces,
            converted.vias,
            converted.report.assigned_readings,
            converted.report.readings
        );
        for warning in &converted.report.warnings {
            eprintln!("{warning}");
        }
        converted.cad
    };
    // Never overwrite an existing file (including a symlink). A failed write
    // removes only the file created by this invocation.
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(output)?;
    if let Err(error) = std::io::Write::write_all(&mut file, &result).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(output);
        return Err(error.into());
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
