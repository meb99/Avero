//! Desktop shell. Parsing runs natively through `avero-formats`; the web UI
//! receives the finished board as JSON.

mod import;
mod library;
mod notes;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use avero_formats::{Board, ParseError, ParseOptions, ASC_FILES, MAX_FILE_SIZE};
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

pub fn load(path: &Path, options: ParseOptions) -> Result<Board, LoadError> {
    let bytes = read(path)?;
    let name = path.file_name().and_then(|n| n.to_str());
    match avero_formats::parse_with(&bytes, name, options) {
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

/// Schematic PDFs next to a board file, best match first: same file name,
/// then a shared board number (`820-02100`), then everything else.
pub fn find_schematics(board: &Path) -> Vec<PathBuf> {
    let Some(dir) = board.parent() else { return Vec::new() };
    let stem = board.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let board_tokens = id_tokens(&stem);
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };

    let mut found: Vec<(u8, String, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")))
        .map(|p| {
            let name = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
            let rank = if name == stem {
                0
            } else if id_tokens(&name).iter().any(|t| board_tokens.contains(t)) {
                1
            } else {
                2
            };
            (rank, name, p)
        })
        .collect();
    found.sort();
    found.into_iter().map(|(_, _, p)| p).collect()
}

/// Parts of a file name that look like identifiers: at least five
/// characters with a digit, e.g. `820-02100`, `x1carbon6`, `nm-b461`.
fn id_tokens(name: &str) -> Vec<String> {
    name.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .filter(|t| t.len() >= 5 && t.chars().any(|c| c.is_ascii_digit()))
        .map(str::to_string)
        .collect()
}

/// Files handed to the app by Finder before the UI subscribed to them.
#[derive(Default)]
struct PendingPaths(Mutex<Vec<String>>);

// Commands are async so large files are parsed off the main thread.
#[tauri::command]
async fn open_board(path: String, xzz_key: Option<String>) -> Result<Board, LoadError> {
    let xzz_key = match xzz_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        None => None,
        Some(text) => Some(avero_formats::formats::parse_xzz_key(text).ok_or(ParseError::InvalidKey)?),
    };
    load(Path::new(&path), ParseOptions { xzz_key })
}

#[tauri::command]
async fn open_demo() -> Result<Board, LoadError> {
    Ok(avero_formats::demo::board())
}

#[tauri::command]
fn schematics_for(board_path: String) -> Vec<String> {
    find_schematics(Path::new(&board_path)).into_iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

/// Raw file bytes (schematic PDFs), sent as binary rather than JSON.
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, LoadError> {
    Ok(tauri::ipc::Response::new(read(Path::new(&path))?))
}

/// Scans the library folders. Runs on a worker thread; large libraries take
/// a moment.
#[tauri::command]
async fn scan_library(folders: Vec<String>) -> library::LibraryScan {
    let roots: Vec<PathBuf> = folders.into_iter().map(PathBuf::from).collect();
    library::scan(&roots)
}

/// Avero's own library folder, `~/Documents/Avero/Bibliothek`, created on demand.
fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Avero").join("Bibliothek");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

#[tauri::command]
fn library_root(app: tauri::AppHandle) -> Result<String, String> {
    library_dir(&app).map(|d| d.to_string_lossy().into_owned())
}

/// Copies files, folders or ZIP archives into the library.
#[tauri::command]
async fn import_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    folder: Option<String>,
) -> Result<import::ImportResult, String> {
    let root = library_dir(&app)?;
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    Ok(import::import(&root, &paths, folder.as_deref()))
}

fn notes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map(|d| d.join("boards")).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_notes(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    notes::load(&notes_dir(&app)?, &key)
}

#[tauri::command]
fn save_notes(app: tauri::AppHandle, key: String, data: String) -> Result<(), String> {
    notes::save(&notes_dir(&app)?, &key, &data)
}

/// Decodes the percent-encoding the UI uses to pass paths in a header.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Writes binary data (e.g. an exported PNG) to a path the user picked. The
/// bytes come as the raw request body, the path in the `x-path` header.
#[tauri::command]
fn write_binary(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected binary data".into());
    };
    let path = request.headers().get("x-path").and_then(|v| v.to_str().ok()).ok_or("missing path")?;
    let path = PathBuf::from(percent_decode(path));
    std::fs::write(&path, data).map_err(|e| format!("{}: {e}", path.display()))
}

/// Writes a JSON export to a path the user picked in a save panel.
#[tauri::command]
fn export_json(path: String, data: String) -> Result<(), String> {
    notes::write_json(Path::new(&path), &data)
}

#[tauri::command]
fn take_pending_paths(pending: tauri::State<'_, PendingPaths>) -> Vec<String> {
    pending.0.lock().map(|mut p| std::mem::take(&mut *p)).unwrap_or_default()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingPaths::default())
        .invoke_handler(tauri::generate_handler![
            open_board,
            open_demo,
            schematics_for,
            read_file,
            scan_library,
            library_root,
            import_files,
            load_notes,
            save_notes,
            export_json,
            write_binary,
            take_pending_paths
        ])
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
        let board = load(&dir.join("PINS.asc"), ParseOptions::default()).unwrap();
        assert_eq!(board.parts.len(), 1);
        assert_eq!(board.outline[0].len(), 3);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ranks_schematics_next_to_the_board() {
        let dir = std::env::temp_dir().join(format!("avero-sch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for f in ["J413 820-02100.PDF", "notes.pdf", "board.pdf", "board.brd", "readme.txt"] {
            std::fs::write(dir.join(f), b"%PDF").unwrap();
        }
        let names = |board: &str| -> Vec<String> {
            find_schematics(&dir.join(board))
                .iter()
                .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
                .collect()
        };
        assert_eq!(names("board.brd"), ["board.pdf", "J413 820-02100.PDF", "notes.pdf"]);
        assert_eq!(names("820-02100 boardview.brd")[0], "J413 820-02100.PDF");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn decodes_percent_encoded_paths() {
        assert_eq!(percent_decode("/Users/me/B%C3%B6rd%20A.png"), "/Users/me/Börd A.png");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn reports_missing_files_as_io_errors() {
        let err = load(Path::new("/definitely/not/here.brd"), ParseOptions::default()).unwrap_err();
        assert_eq!(err.code, "io");
    }
}
