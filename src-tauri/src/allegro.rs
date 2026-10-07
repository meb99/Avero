//! Standalone GPL reader, file IPC only; never linked to Avero's MIT code.
use avero_formats::{Board, FormatId, ParseError};
use std::{
    path::Path,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
const READER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/avero-allegro-reader"));
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Work(std::path::PathBuf);
impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
pub fn load(path: &Path) -> Result<Board, super::LoadError> {
    let fail = |s: String| super::LoadError { code: "invalid", message: s, format: Some("Cadence Allegro") };
    let stamp =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let work = Work(std::env::temp_dir().join(format!(
        "avero-allegro-{}-{stamp}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )));
    std::fs::create_dir(&work.0).map_err(|e| fail(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&work.0, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| fail(e.to_string()))?;
    }
    let executable = work.0.join("reader");
    let output = work.0.join("board.averoboard");
    std::fs::write(&executable, READER).map_err(|e| fail(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| fail(e.to_string()))?;
    }
    let errors = work.0.join("errors.txt");
    let log = std::fs::File::create(&errors).map_err(|e| fail(e.to_string()))?;
    let mut child = Command::new(&executable)
        .arg(path)
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| fail(format!("Could not start the bundled Allegro reader: {e}")))?;
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(fail(e.to_string()));
            }
        }
        if start.elapsed() > Duration::from_secs(45) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(fail(
                "Allegro reader exceeded 45 seconds; the file may use an unsupported record variant.".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if !status.success() {
        use std::io::Read;
        let mut message = String::new();
        if let Ok(log) = std::fs::File::open(&errors) {
            let _ = log.take(8192).read_to_string(&mut message);
        }
        return Err(fail(if message.trim().is_empty() {
            "Allegro reader rejected the file. Supported binary versions: 16.0–17.4.".into()
        } else {
            message.trim().into()
        }));
    }
    let size = std::fs::metadata(&output).map_err(|e| fail(e.to_string()))?.len();
    if size > avero_formats::MAX_FILE_SIZE as u64 {
        return Err(ParseError::TooLarge.into());
    }
    let bytes = std::fs::read(output).map_err(|e| fail(e.to_string()))?;
    let mut board = avero_formats::parse(&bytes, Some("board.averoboard"))?;
    board.format = FormatId::Allegro;
    board.format_name = FormatId::Allegro.display_name().into();
    Ok(board)
}
