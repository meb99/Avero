//! Command-line companion for checking what Avero reads from a file.
//!
//! ```text
//! avero-inspect <file>          summary
//! avero-inspect <file> --json   full board as JSON
//! avero-inspect --demo --json   the built-in demo board
//! ```
//!
//! XinZhiZao files need the DES key: `--xzz-key 0x…` or `AVERO_XZZ_KEY`.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");
    let demo = args.iter().any(|a| a == "--demo");
    let key_arg = args.iter().position(|a| a == "--xzz-key").and_then(|i| args.get(i + 1)).cloned();
    let key_text = key_arg.clone().or_else(|| std::env::var("AVERO_XZZ_KEY").ok());
    let xzz_key = match key_text.as_deref().map(avero_formats::formats::parse_xzz_key) {
        None => None,
        Some(Some(k)) => Some(k),
        Some(None) => {
            eprintln!("--xzz-key: not a hexadecimal key");
            return ExitCode::from(2);
        }
    };
    let options = avero_formats::ParseOptions { xzz_key };
    let path = args.iter().filter(|a| Some(*a) != key_arg.as_ref()).find(|a| !a.starts_with("--"));

    let board = if demo {
        avero_formats::demo::board()
    } else if let Some(path) = path {
        match read(path, options) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("{path}: {e}");
                return ExitCode::FAILURE;
            }
        }
    } else {
        eprintln!("usage: avero-inspect <file> [--json] | --demo [--json]");
        return ExitCode::from(2);
    };

    if json {
        match serde_json::to_string(&board) {
            Ok(s) => println!("{s}"),
            Err(e) => {
                eprintln!("{e}");
                return ExitCode::FAILURE;
            }
        }
        return ExitCode::SUCCESS;
    }

    let b = &board;
    let mm = |mils: f64| mils * 0.0254;
    println!("format      {}", b.format_name);
    println!("size        {:.1} × {:.1} mm", mm(b.bounds.width()), mm(b.bounds.height()));
    println!("parts       {}", b.parts.len());
    println!("pins        {}", b.pins.len());
    println!("test points {}", b.test_points.len());
    println!("nets        {}", b.nets.len());
    for w in &b.warnings {
        println!("warning     {w}");
    }
    ExitCode::SUCCESS
}

fn read(path: &str, options: avero_formats::ParseOptions) -> Result<avero_formats::Board, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let name = std::path::Path::new(path).file_name().and_then(|n| n.to_str());
    match avero_formats::parse_with(&bytes, name, options) {
        Err(avero_formats::ParseError::NeedsAscFiles) => {
            let dir = std::path::Path::new(path).parent().unwrap_or(std::path::Path::new("."));
            let [format, pins, nails] = avero_formats::ASC_FILES.map(|f| find_insensitive(dir, f));
            let pins = pins.ok_or("pins.asc not found next to the file")?;
            avero_formats::parse_asc(format.as_deref(), &pins, nails.as_deref()).map_err(|e| e.to_string())
        }
        other => other.map_err(|e| e.to_string()),
    }
}

fn find_insensitive(dir: &std::path::Path, name: &str) -> Option<Vec<u8>> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name))
        .and_then(|e| std::fs::read(e.path()).ok())
}
