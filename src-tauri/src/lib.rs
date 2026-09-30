//! Desktop shell. Parsing runs natively through `avero-formats`; the web UI
//! receives the finished board as JSON.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use avero_formats::{Board, ParseError, ASC_FILES, MAX_FILE_SIZE};
use serde::Serialize;

/// Error shape the UI expects (see `src/core/types.ts`).
#[derive(Debug, Serialize)]
pub struct LoadError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'static str>,
}

impl From<ParseError> for LoadError {
    fn from(e: ParseError) -> Self {
        LoadError { code: e.code(), message: e.to_string(), format: e.format() }
    }
}

fn io_error(path: &Path, e: std::io::Error) -> LoadError {
    LoadError { code: "io", message: format!("{}: {e}", path.display()), format: None }
}

fn read(path: &Path) -> Result<Vec<u8>, LoadError> {
    let size = std::fs::metadata(path).map_err(|e| io_error(path, e))?.len();
    if size > MAX_FILE_SIZE as u64 {
        return Err(ParseError::TooLarge.into());
    }
    std::fs::read(path).map_err(|e| io_error(path, e))
}

/// Finds `name` in `dir` ignoring case, as ASC sets come in any spelling.
fn find_insensitive(dir: &Path, name: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name))
        .map(|e| e.path())
}

pub fn load(path: &Path) -> Result<Board, LoadError> {
    let bytes = read(path)?;
    let name = path.file_name().and_then(|n| n.to_str());
    match avero_formats::parse(&bytes, name) {
        Err(ParseError::NeedsAscFiles) => {
            let dir = path.parent().unwrap_or(Path::new("."));
            let [format, pins, nails] = ASC_FILES.map(|f| find_insensitive(dir, f));
            let pins = pins.ok_or(ParseError::NeedsAscFiles)?;
            let format = format.map(|p| read(&p)).transpose()?;
            let nails = nails.map(|p| read(&p)).transpose()?;
            Ok(avero_formats::parse_asc(format.as_deref(), &read(&pins)?, nails.as_deref())?)
        }
        other => Ok(other?),
    }
}

/// Files handed to the app by Finder before the UI subscribed to them.
#[derive(Default)]
struct PendingPaths(Mutex<Vec<String>>);

// Commands are async so large files are parsed off the main thread.
#[tauri::command]
async fn open_board(path: String) -> Result<Board, LoadError> {
    load(Path::new(&path))
}

#[tauri::command]
async fn open_demo() -> Result<Board, LoadError> {
    Ok(avero_formats::demo::board())
}

#[tauri::command]
fn take_pending_paths(pending: tauri::State<'_, PendingPaths>) -> Vec<String> {
    pending.0.lock().map(|mut p| std::mem::take(&mut *p)).unwrap_or_default()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingPaths::default())
        .invoke_handler(tauri::generate_handler![open_board, open_demo, take_pending_paths])
        .build(tauri::generate_context!())
        .expect("error while building Avero");

    app.run(|_app, _event| {
        // Finder "Open With", double-click on an associated file, or a drop
        // on the Dock icon.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            use tauri::{Emitter, Manager};
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if paths.is_empty() {
                return;
            }
            // Keep them for a UI that is still starting, and notify a running one.
            if let Ok(mut pending) = _app.state::<PendingPaths>().0.lock() {
                pending.extend(paths.iter().cloned());
            }
            let _ = _app.emit("open-paths", paths);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_asc_companions_case_insensitively() {
        let dir = std::env::temp_dir().join(format!("avero-asc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Format.ASC"), "0 0\n1 0\n1 1\n").unwrap();
        std::fs::write(dir.join("PINS.asc"), "Part U1 (T)\n1 1 0.1 0.1 1 VCC 0\n2 2 0.2 0.1 1 GND 0\n")
            .unwrap();
        let board = load(&dir.join("PINS.asc")).unwrap();
        assert_eq!(board.parts.len(), 1);
        assert_eq!(board.outline[0].len(), 3);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reports_missing_files_as_io_errors() {
        let err = load(Path::new("/definitely/not/here.brd")).unwrap_err();
        assert_eq!(err.code, "io");
    }
}
