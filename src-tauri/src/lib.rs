//! Desktop shell. Parsing runs natively through `avero-formats`; the web UI
//! receives the finished board as JSON.

mod backup;
mod collection;
mod conversion;
mod donors;
mod duplicates;
mod import;
mod library;
mod mcp;
mod meter;
mod notes;
mod package;
mod updater;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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
    if matches!(
        avero_formats::detect(&bytes, name),
        avero_formats::Detected::Supported(avero_formats::FormatId::Xzz)
    ) {
        // The readings the file keeps after its marker go onto whatever board the reading gave.
        return load_xzz(&bytes, name, options).map(|mut board| {
            avero_formats::attach_xzz_readings(&mut board, avero_formats::xzz_readings(&bytes));
            board
        });
    }
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

/// XZZ boards: the direct reader first. Where it stays incomplete (parts
/// locked without a matching key, or none read), the library converter
/// fills in: its GenCAD output, read like any GenCAD file, has every part
/// with pad shapes and traces. A direct read with all parts keeps its frame
/// (so markers and photo alignments stay where they are) and gets the
/// converter's tracks, layers and vias added, lined up on shared pins.
/// Either way the two views XZZ draws side by side are folded into one
/// board with a top and a bottom side.
fn load_xzz(bytes: &[u8], name: Option<&str>, options: ParseOptions) -> Result<Board, LoadError> {
    let key = options.xzz_key;
    let direct = avero_formats::parse_with(bytes, name, options);
    let complete = matches!(&direct, Ok(b) if b.locked_parts == 0 && !b.parts.is_empty());
    let convert = || {
        avero_formats::convert::xzz_to_gencad(bytes, name.unwrap_or("board"), key)
            .ok()
            .and_then(|c| avero_formats::parse(&c.cad, Some("converted.gcd")).ok())
            .filter(|b| !b.parts.is_empty())
            .map(|mut b| {
                avero_formats::fold::fold_side_by_side(&mut b);
                b
            })
    };
    if complete {
        let mut board = direct?;
        avero_formats::fold::fold_side_by_side(&mut board);
        // Parts alone are not the whole board: tracks, vias and layers come from the converter.
        if board.traces.is_empty() {
            if let Some(converted) = convert() {
                match avero_formats::copper::add_copper_from(&mut board, &converted) {
                    Ok((0, 0)) => {}
                    Ok((traces, vias)) => board.warnings.push(format!(
                        "Tracks ({traces}), vias ({vias}) and layers added from the GenCAD conversion."
                    )),
                    Err(e) => board.warnings.push(format!("Tracks of the GenCAD conversion left out: {e}.")),
                }
            }
        }
        return Ok(board);
    }
    match (direct, convert()) {
        (_, Some(mut board)) => {
            board.format = avero_formats::FormatId::Xzz;
            board.format_name = format!("{} → GenCAD", avero_formats::FormatId::Xzz.display_name());
            Ok(board)
        }
        (direct, None) => {
            let mut board = direct?;
            avero_formats::fold::fold_side_by_side(&mut board);
            Ok(board)
        }
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

/// Set once the window has saved everything; closing and quitting then go through.
static QUIT_READY: AtomicBool = AtomicBool::new(false);
static QUIT_ASKED: AtomicBool = AtomicBool::new(false);
/** The window answered and is saving (or asking); no forced exit then. */
static QUIT_ACK: AtomicBool = AtomicBool::new(false);

fn ask_to_quit(app: &tauri::AppHandle) {
    use tauri::Emitter;
    if QUIT_ASKED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit_to("main", "app:save-and-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if !QUIT_ACK.load(Ordering::SeqCst) && QUIT_ASKED.load(Ordering::SeqCst) {
            QUIT_READY.store(true, Ordering::SeqCst);
            handle.exit(0);
        }
    });
}

/// The window got the request to quit and is saving.
#[tauri::command]
fn quit_ack() {
    QUIT_ACK.store(true, Ordering::SeqCst);
}

/// The user chose to stay (saving failed and they want to keep the data).
#[tauri::command]
fn quit_cancel() {
    QUIT_ACK.store(false, Ordering::SeqCst);
    QUIT_ASKED.store(false, Ordering::SeqCst);
}

/// The window has saved its data: quit now.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    QUIT_READY.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// Files handed to the app by Finder before the UI subscribed to them.
#[derive(Default)]
struct PendingPaths(Mutex<Vec<String>>);

// Commands are async so large files are parsed off the main thread.
#[tauri::command]
async fn open_board(
    path: String,
    xzz_key: Option<String>,
    fz_key: Option<String>,
) -> Result<Board, LoadError> {
    use avero_formats::formats::{assign_fz_keys, parse_fz_keys, parse_xzz_key};
    let given = |k: &Option<String>| k.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(str::to_owned);
    // A malformed key becomes one that fails the parity check, so only the
    // files that need that key report it (and not every other file too).
    let xzz_key = given(&xzz_key).map(|text| parse_xzz_key(&text).unwrap_or(0));
    // The field may hold the .fz and the .cae key (44 words each).
    let (fz_key, cae_key) = match given(&fz_key) {
        None => (None, None),
        Some(text) => {
            parse_fz_keys(&text).map_or((Some([0; 44]), Some([0; 44])), |keys| assign_fz_keys(&keys))
        }
    };
    load(Path::new(&path), ParseOptions { xzz_key, fz_key, cae_key })
}

/// A part on other boards of the library (donor boards), best fits first.
#[tauri::command]
async fn find_donors(
    paths: Vec<String>,
    query: donors::DonorQuery,
    xzz_key: Option<String>,
    fz_key: Option<String>,
) -> Result<Vec<donors::DonorHit>, String> {
    let mut hits = Vec::new();
    for path in paths {
        if query.exclude.as_deref() == Some(path.as_str()) {
            continue;
        }
        // Boards that do not open (no key, broken) are skipped, not fatal.
        if let Ok(board) = open_board(path.clone(), xzz_key.clone(), fz_key.clone()).await {
            hits.extend(donors::find_in(&board, &path, &query));
        }
    }
    donors::rank(&mut hits);
    hits.truncate(200);
    Ok(hits)
}

/// Part and net names of a boardview, upper case, for the library's
/// content search. Keys are passed like for `open_board`.
#[tauri::command]
async fn board_words(
    path: String,
    xzz_key: Option<String>,
    fz_key: Option<String>,
) -> Result<Vec<String>, LoadError> {
    let board = open_board(path, xzz_key, fz_key).await?;
    let mut words: Vec<String> = board
        .parts
        .iter()
        .map(|p| p.name.to_uppercase())
        .chain(
            board
                .nets
                .iter()
                .filter(|n| n.kind != avero_formats::NetKind::Unconnected)
                .map(|n| n.name.to_uppercase()),
        )
        .filter(|w| w.len() >= 2)
        .collect();
    words.sort_unstable();
    words.dedup();
    Ok(words)
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

/// Files in the library folders with exactly the same content. Runs on a
/// worker thread; same-size files are read completely.
#[tauri::command]
async fn find_duplicates(folders: Vec<String>) -> Vec<duplicates::DuplicateGroup> {
    let roots: Vec<PathBuf> = folders.into_iter().map(PathBuf::from).collect();
    duplicates::find(library::files(&roots))
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

/// Sorts library files into a category folder such as `Sony/PlayStation/PS4`.
#[tauri::command]
fn move_library_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    folder: String,
) -> Result<Vec<String>, String> {
    let root = library_dir(&app)?;
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    import::move_into(&root, &paths, &folder)
        .map(|v| v.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// Moves library files to the Trash; returns how many were moved.
#[tauri::command]
fn trash_library_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<usize, String> {
    use tauri::Manager;
    let root = library_dir(&app)?;
    let bin = app.path().home_dir().map_err(|e| e.to_string())?.join(".Trash");
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    import::trash(&root, &bin, &paths)
}

/// Renames a file of the library; returns the new path.
#[tauri::command]
fn rename_library_file(path: String, name: String) -> Result<String, String> {
    import::rename_file(Path::new(&path), &name).map(|p| p.to_string_lossy().into_owned())
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

/// Runs the built-in converter on a worker and saves its result directly into
/// the library. The UI selects paths, without asking for an output name.
#[tauri::command]
async fn convert_xzz_file(
    app: tauri::AppHandle,
    path: String,
    folder: Option<String>,
    xzz_key: Option<String>,
) -> Result<conversion::ConvertedFile, String> {
    let root = library_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        conversion::convert_file(&root, Path::new(&path), folder.as_deref(), xzz_key.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn find_xzz_files(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || conversion::find_files(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_console_collection(
    app: tauri::AppHandle,
    path: String,
    xzz_key: Option<String>,
    on_progress: tauri::ipc::Channel<collection::CollectionProgress>,
) -> Result<collection::CollectionResult, String> {
    let root = library_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        collection::import_collection(&root, Path::new(&path), xzz_key.as_deref(), |event| {
            let _ = on_progress.send(event);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn notes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map(|d| d.join("boards")).map_err(|e| e.to_string())
}

fn photos_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map(|d| d.join("photos")).map_err(|e| e.to_string())
}

/// Copies a board photo into the app's data folder; returns the copy's path.
#[tauri::command]
fn import_photo(app: tauri::AppHandle, key: String, side: String, path: String) -> Result<String, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    notes::store_photo(&photos_dir(&app)?, &key, &side, Path::new(&path), stamp)
        .map(|p| p.to_string_lossy().into_owned())
}

/// A board picture rendered by the app (PNG as the raw request body; board
/// key and side in the `x-key` and `x-side` headers).
#[tauri::command]
fn store_photo_png(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected binary data".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(percent_decode);
    let key = header("x-key").ok_or("missing key")?;
    let side = header("x-side").ok_or("missing side")?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    notes::store_photo_png(&photos_dir(&app)?, &key, &side, data, stamp)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn remove_photo(app: tauri::AppHandle, path: String) -> Result<(), String> {
    notes::remove_photo(&photos_dir(&app)?, Path::new(&path))
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Backs up the own library, the data folder and the given settings into one ZIP.
#[tauri::command]
async fn backup_create(
    app: tauri::AppHandle,
    path: String,
    settings: String,
    created: String,
) -> Result<backup::Summary, String> {
    let library = library_dir(&app)?;
    let data = data_dir(&app)?;
    let version = app.package_info().version.to_string();
    backup::create(Path::new(&path), &library, &data, &settings, &version, &created)
}

/// Packs one board with its notes, photos and (on request) files into a portable package.
#[tauri::command]
async fn package_create(
    app: tauri::AppHandle,
    path: String,
    request: package::PackRequest,
    created: String,
) -> Result<package::PackResult, String> {
    let version = app.package_info().version.to_string();
    package::create(Path::new(&path), &request, &version, &created)
}

/// Opens a package: photos into the photo folder, board and PDFs into the library.
#[tauri::command]
async fn package_open(app: tauri::AppHandle, path: String) -> Result<package::Unpacked, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    package::open(Path::new(&path), &library_dir(&app)?, &photos_dir(&app)?, stamp)
}

/// Packs a device of several boards with its project as one file.
#[tauri::command]
async fn device_package_create(
    app: tauri::AppHandle,
    path: String,
    request: package::DeviceRequest,
    created: String,
) -> Result<package::PackResult, String> {
    let version = app.package_info().version.to_string();
    package::create_device(Path::new(&path), &request, &version, &created)
}

/// Opens a board package or a device package.
#[tauri::command]
async fn package_open_any(app: tauri::AppHandle, path: String) -> Result<package::Opened, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    package::open_any(Path::new(&path), &library_dir(&app)?, &photos_dir(&app)?, stamp)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    files: usize,
    bytes: u64,
    settings: Option<String>,
    created: String,
    app: String,
}

/// Restores a backup made with `backup_create`; returns the stored settings for the UI.
#[tauri::command]
async fn backup_restore(
    app: tauri::AppHandle,
    path: String,
    stamp: String,
    mode: Option<backup::Mode>,
) -> Result<RestoreResult, String> {
    let library = library_dir(&app)?;
    let data = data_dir(&app)?;
    let r = backup::restore(Path::new(&path), &library, &data, &stamp, mode.unwrap_or_default())?;
    Ok(RestoreResult {
        files: r.summary.files,
        bytes: r.summary.bytes,
        settings: r.settings,
        created: r.manifest.created,
        app: r.manifest.app,
    })
}

fn datasheets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("datasheets"))
}

/// Port the AI connection listens on unless the settings say otherwise.
pub const MCP_DEFAULT_PORT: u16 = 47321;

/// `Avero --mcp [port]`: MCP over stdin/stdout for Claude Desktop.
pub fn mcp_bridge(port: u16) {
    mcp::bridge(port)
}

/// Switches the AI connection (MCP server on 127.0.0.1) on.
#[tauri::command]
fn mcp_start(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    if port < 1024 {
        return Err(format!("port {port}: choose 1024 or above"));
    }
    let emitter = app.clone();
    let forward: mcp::Forward = std::sync::Arc::new(move |id, message| {
        let _ = emitter.emit_to("main", "mcp:call", serde_json::json!({ "id": id, "message": message }));
    });
    app.state::<mcp::Mcp>().start(port, forward)
}

/// Path of Avero's own program, for the Claude Desktop configuration.
#[tauri::command]
fn app_executable() -> Result<String, String> {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

#[tauri::command]
fn mcp_stop(state: tauri::State<'_, mcp::Mcp>) {
    state.stop();
}

#[tauri::command]
fn mcp_status(state: tauri::State<'_, mcp::Mcp>) -> Option<u16> {
    state.port()
}

/// The window's answer to a forwarded MCP request.
#[tauri::command]
fn mcp_reply(state: tauri::State<'_, mcp::Mcp>, id: u64, answer: serde_json::Value) {
    state.reply(id, answer);
}

/// Serial ports a multimeter may be on.
#[tauri::command]
fn meter_ports() -> Result<Vec<meter::PortInfo>, String> {
    meter::ports()
}

#[tauri::command]
async fn meter_connect(app: tauri::AppHandle, port: String, baud: u32) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || meter::connect(&app.state::<meter::Meter>(), &port, baud))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn meter_disconnect(state: tauri::State<'_, meter::Meter>) {
    meter::disconnect(&state);
}

/// Sends SCPI commands in order; returns the answer of each query.
#[tauri::command]
async fn meter_send(app: tauri::AppHandle, commands: Vec<String>) -> Result<Vec<Option<String>>, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<meter::Meter>();
        commands.iter().map(|c| meter::send(&state, c)).collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Size and modification time (seconds) of a file, as the library lists them.
#[tauri::command]
fn file_stamp(path: String) -> Result<(u64, u64), String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    Ok((meta.len(), modified))
}

/// Text recognised on the scanned pages of a schematic, kept so a PDF is read once.
#[tauri::command]
fn load_ocr(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    notes::load(&data_dir(&app)?.join("ocr"), &key)
}

#[tauri::command]
fn save_ocr(app: tauri::AppHandle, key: String, data: String) -> Result<(), String> {
    let dir = data_dir(&app)?.join("ocr");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    notes::save(&dir, &key, &data)
}

/// Copies the pictures of saved wiki pages into Avero's data folder, so the
/// pages show them offline; a picture that cannot be read gives `None`.
#[tauri::command]
async fn import_knowledge_images(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    let dir = data_dir(&app)?.join("knowledge-images");
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|p| {
                notes::store_knowledge_image(&dir, Path::new(p))
                    .ok()
                    .map(|t| t.to_string_lossy().into_owned())
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Copies a datasheet PDF into Avero's data folder; returns the copy's path.
#[tauri::command]
fn import_datasheet(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let source = Path::new(&path);
    if !source.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
        return Err(format!("{path}: not a PDF"));
    }
    let dir = datasheets_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "datasheet.pdf".into());
    // Same name already there (another version): keep both.
    let mut target = dir.join(&name);
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{}-{n}.pdf", name.trim_end_matches(".pdf").trim_end_matches(".PDF")));
        n += 1;
    }
    std::fs::copy(source, &target).map_err(|e| format!("{path}: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn remove_datasheet(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = datasheets_dir(&app)?;
    let p = Path::new(&path);
    if p.parent() != Some(dir.as_path()) {
        return Err(format!("{path}: not a stored datasheet"));
    }
    match std::fs::remove_file(p) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("{path}: {e}")),
        _ => Ok(()),
    }
}

/// App-wide JSON stores in the data folder, by name: saved diagnosis flows,
/// the datasheet register, the workspace to restore, key bindings.
const STORES: &[&str] = &["flows", "datasheets", "workspace", "shortcuts", "projects"];

fn store_name(name: &str) -> Result<&str, String> {
    STORES.iter().copied().find(|s| *s == name).ok_or_else(|| format!("unknown store {name}"))
}

#[tauri::command]
fn load_store(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    notes::load(&data_dir(&app)?, store_name(&name)?)
}

#[tauri::command]
fn save_store(app: tauri::AppHandle, name: String, data: String) -> Result<(), String> {
    notes::save(&data_dir(&app)?, store_name(&name)?, &data)
}

/// Imported repair knowledge (wiki pages), one JSON file.
#[tauri::command]
fn load_knowledge(app: tauri::AppHandle) -> Result<Option<String>, String> {
    notes::load(&data_dir(&app)?, "knowledge")
}

#[tauri::command]
fn save_knowledge(app: tauri::AppHandle, data: String) -> Result<(), String> {
    notes::save(&data_dir(&app)?, "knowledge", &data)
}

fn text_index_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map(|d| d.join("text-index")).map_err(|e| e.to_string())
}

/// Cached word index of a library schematic (full-text search).
#[tauri::command]
fn load_text_index(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    notes::load(&text_index_dir(&app)?, &key)
}

#[tauri::command]
fn save_text_index(app: tauri::AppHandle, key: String, data: String) -> Result<(), String> {
    notes::save(&text_index_dir(&app)?, &key, &data)
}

#[tauri::command]
fn load_notes(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    notes::load(&notes_dir(&app)?, &key)
}

#[tauri::command]
fn save_notes(app: tauri::AppHandle, key: String, data: String) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    notes::save_with_version(&notes_dir(&app)?, &key, &data, now)
}

/// Snapshot times (unix seconds) of a board's notes, newest first.
/// Moves a damaged notes file aside so a new save cannot overwrite it.
#[tauri::command]
fn set_notes_aside(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let now =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    Ok(notes::set_aside(&notes_dir(&app)?, &key, now)?.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn note_versions(app: tauri::AppHandle, key: String) -> Result<Vec<u64>, String> {
    Ok(notes::versions(&notes_dir(&app)?, &key))
}

#[tauri::command]
fn load_note_version(app: tauri::AppHandle, key: String, stamp: u64) -> Result<String, String> {
    notes::load_version(&notes_dir(&app)?, &key, stamp)
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

/// Label of the separate schematic window (second monitor).
const SCHEMATIC_WINDOW: &str = "schematic";

/// Opens the schematic in its own window, or brings that window forward.
/// The page finds out from its window label that it shows only the schematic.
#[tauri::command]
async fn open_schematic_window(app: tauri::AppHandle, title: String) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(SCHEMATIC_WINDOW) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(&app, SCHEMATIC_WINDOW, tauri::WebviewUrl::default())
        .title(title)
        .inner_size(1100.0, 860.0)
        .min_inner_size(480.0, 360.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn close_schematic_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(SCHEMATIC_WINDOW) {
        let _ = window.close();
    }
}

/// The latest release on GitHub if it is newer than `current`.
#[tauri::command]
async fn check_update(current: String) -> Result<Option<updater::Available>, String> {
    updater::check(&current)
}

/// Downloads a newer release, replaces the app and restarts into it.
#[tauri::command]
async fn install_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
    updater::install(&app, &version)
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
        .manage(meter::Meter::default())
        .manage(mcp::Mcp::default())
        .setup(|app| {
            // Photos taken out of the notes are kept for undo and versions;
            // only those nothing refers to for a month are cleared away.
            if let (Ok(photos), Ok(notes)) = (photos_dir(app.handle()), notes_dir(app.handle())) {
                std::thread::spawn(move || {
                    notes::prune_photos(&photos, &notes, std::time::Duration::from_secs(30 * 24 * 3600));
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_board,
            open_demo,
            schematics_for,
            read_file,
            scan_library,
            library_root,
            import_files,
            convert_xzz_file,
            find_xzz_files,
            import_console_collection,
            board_words,
            rename_library_file,
            move_library_files,
            trash_library_files,
            find_duplicates,
            load_notes,
            save_notes,
            export_json,
            write_binary,
            import_photo,
            store_photo_png,
            remove_photo,
            load_text_index,
            load_knowledge,
            load_store,
            note_versions,
            set_notes_aside,
            load_note_version,
            backup_create,
            package_create,
            package_open,
            package_open_any,
            device_package_create,
            find_donors,
            import_datasheet,
            import_knowledge_images,
            load_ocr,
            meter_ports,
            mcp_start,
            app_executable,
            mcp_stop,
            mcp_status,
            mcp_reply,
            meter_connect,
            meter_disconnect,
            meter_send,
            save_ocr,
            remove_datasheet,
            backup_restore,
            save_store,
            save_knowledge,
            save_text_index,
            check_update,
            install_update,
            open_schematic_window,
            close_schematic_window,
            take_pending_paths,
            quit_app,
            file_stamp,
            quit_ack,
            quit_cancel
        ])
        .build(tauri::generate_context!())
        .expect("error while building Avero");

    app.run(|_app, _event| {
        // Closing the main window or quitting: the window saves what is still
        // unsaved first and then calls `quit_app`; a window that does not
        // answer within a few seconds does not keep the app open.
        match &_event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" && !QUIT_READY.load(Ordering::SeqCst) => {
                api.prevent_close();
                ask_to_quit(_app);
            }
            tauri::RunEvent::ExitRequested { api, .. } if !QUIT_READY.load(Ordering::SeqCst) => {
                use tauri::Manager;
                if _app.get_webview_window("main").is_some() {
                    api.prevent_exit();
                    ask_to_quit(_app);
                }
            }
            _ => {}
        }
        if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = &_event {
            use tauri::Emitter;
            if label == SCHEMATIC_WINDOW {
                // The main window shows the schematic again.
                let _ = _app.emit_to("main", "schematic:closed", ());
            } else if label == "main" {
                // Closing the main window ends the app, schematic window included.
                _app.exit(0);
            }
        }

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

    /// A small synthetic XZZ board whose part is not encrypted: the direct
    /// reader treats it as locked, the converter reads it.
    fn plain_xzz() -> Vec<u8> {
        fn word(d: &mut Vec<u8>, n: u32) {
            d.extend(n.to_le_bytes());
        }
        fn put(d: &mut [u8], at: usize, n: u32) {
            d[at..at + 4].copy_from_slice(&n.to_le_bytes());
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
        fn pin(name: &str, x: u32, y: u32, net: u32) -> Vec<u8> {
            let mut b = vec![0; 24];
            put(&mut b, 0, 1);
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
            b.extend([0; 8]);
            b
        }
        let mut part = vec![0; 26];
        put(&mut part, 8, 1000000);
        put(&mut part, 12, 2000000);
        put(&mut part, 16, 900000);
        put(&mut part, 22, 3);
        part.extend(b"QFN");
        block(&mut part, 6, &label("U1"));
        block(&mut part, 6, &label("MCU"));
        block(&mut part, 9, &pin("1", 110, 205, 5));
        block(&mut part, 9, &pin("2", 130, 210, 7));
        block(&mut part, 3, &[b'x'; 9]);
        let size = part.len() - 4;
        put(&mut part, 0, size as u32);
        part.resize(part.len().div_ceil(8) * 8 + 3, 0);
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
        let mut nets = Vec::new();
        for (id, name) in [(5, "GND"), (7, "PP3V3")] {
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
        file.extend(b"v6v6555v6v6 metadata");
        file
    }

    #[test]
    fn xzz_opens_through_the_converter_when_the_direct_read_is_incomplete() {
        let path = std::env::temp_dir().join(format!("avero-xzz-{}.pcb", std::process::id()));
        std::fs::write(&path, plain_xzz()).unwrap();
        let direct = avero_formats::parse_with(&plain_xzz(), Some("x.pcb"), ParseOptions::default());
        assert!(!matches!(&direct, Ok(b) if !b.parts.is_empty() && b.locked_parts == 0), "{direct:?}");
        let board = load(&path, ParseOptions::default()).unwrap();
        assert_eq!(board.format, avero_formats::FormatId::Xzz);
        assert!(board.format_name.ends_with("GenCAD"), "{}", board.format_name);
        assert_eq!(board.parts.len(), 1);
        assert_eq!(board.parts[0].name, "U1");
        assert_eq!(board.pins.len(), 2);
        assert!(board.nets.iter().any(|n| n.name == "PP3V3"));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn xzz_readings_after_the_marker_go_onto_their_pins() {
        let path = std::env::temp_dir().join(format!("avero-xzz-readings-{}.pcb", std::process::id()));
        let mut file = plain_xzz();
        // The diode list (`阻值` in GBK): two pins of U1, and one of a part the board does not have.
        file.extend(b"\n===\xD7\xE8\xD6\xB5\n=480=U1(1)\n=OL=U1(2)\n=5=U9(1)\n");
        std::fs::write(&path, &file).unwrap();
        let board = load(&path, ParseOptions::default()).unwrap();
        std::fs::remove_file(&path).unwrap();
        let at = |pin: &str| board.readings.iter().find(|r| r.part == "U1" && r.pin == pin).map(|r| r.value);
        assert_eq!(at("1"), Some(Some(0.48)));
        assert_eq!(at("2"), Some(None));
        assert_eq!(board.readings.len(), 2);
        assert!(
            board.warnings.iter().any(|w| w.starts_with("1 readings of the file")),
            "{:?}",
            board.warnings
        );
    }

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
