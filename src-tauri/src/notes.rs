//! Per-board workbench data (measurements, repair cases, notes), stored as
//! one JSON file per board in the app's data folder. The content belongs to
//! the UI; this side only checks that it is JSON and writes it safely.

use std::path::{Path, PathBuf};

/// File name for a board key: lower case, filesystem-safe, bounded length.
pub fn file_name(key: &str) -> String {
    let mut safe: String = key
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .collect();
    safe = safe.trim_matches(|c| c == '.' || c == '_').chars().take(96).collect();
    if safe.is_empty() {
        safe = "board".into();
    }
    format!("{safe}.json")
}

pub fn load(dir: &Path, key: &str) -> Result<Option<String>, String> {
    let path = dir.join(file_name(key));
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Writes through a temporary file so a crash never leaves half a file.
pub fn write_json(path: &Path, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("invalid JSON: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let tmp: PathBuf = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn save(dir: &Path, key: &str, json: &str) -> Result<(), String> {
    write_json(&dir.join(file_name(key)), json)
}

/// A board's notes as they were: one snapshot at most every
/// `VERSION_EVERY` seconds, the newest `VERSIONS_KEPT` kept, in
/// `versions/<board>/<unix seconds>.json`.
const VERSION_EVERY: u64 = 600;
const VERSIONS_KEPT: usize = 100;

fn versions_dir(dir: &Path, key: &str) -> PathBuf {
    dir.join("versions").join(file_name(key).trim_end_matches(".json"))
}

/// Snapshot times of a board, newest first.
pub fn versions(dir: &Path, key: &str) -> Vec<u64> {
    let mut out: Vec<u64> = std::fs::read_dir(versions_dir(dir, key))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|e| {
                    e.file_name().to_string_lossy().strip_suffix(".json").and_then(|s| s.parse().ok())
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_unstable_by(|a, b| b.cmp(a));
    out
}

pub fn load_version(dir: &Path, key: &str, stamp: u64) -> Result<String, String> {
    let path = versions_dir(dir, key).join(format!("{stamp}.json"));
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Saves the board's notes and, when the last snapshot is old enough, a new snapshot.
pub fn save_with_version(dir: &Path, key: &str, json: &str, now: u64) -> Result<(), String> {
    save(dir, key, json)?;
    let existing = versions(dir, key);
    if existing.first().is_some_and(|&last| now.saturating_sub(last) < VERSION_EVERY) {
        return Ok(());
    }
    write_json(&versions_dir(dir, key).join(format!("{now}.json")), json)?;
    for old in existing.iter().skip(VERSIONS_KEPT - 1) {
        let _ = std::fs::remove_file(versions_dir(dir, key).join(format!("{old}.json")));
    }
    Ok(())
}

/// Image types a board photo may have.
const PHOTO_TYPES: &[&str] = &["jpg", "jpeg", "png", "heic", "webp"];

/// Copies a photo of the board (side `top`/`bottom`) or of a repair case
/// (`case`) into `dir` as `<key>-<side>-<stamp>.<ext>`
/// and returns the copy's path, so the photo survives the original being
/// moved or deleted.
pub fn store_photo(dir: &Path, key: &str, side: &str, source: &Path, stamp: u128) -> Result<PathBuf, String> {
    // Board photos per side, or photos of a repair case.
    if !matches!(side, "top" | "bottom" | "case") {
        return Err(format!("unknown side {side}"));
    }
    let ext = source.extension().and_then(|e| e.to_str()).map(str::to_lowercase).unwrap_or_default();
    if !PHOTO_TYPES.contains(&ext.as_str()) {
        return Err(format!("{}: not a JPEG, PNG, HEIC or WebP image", source.display()));
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = file_name(key);
    let stem = name.trim_end_matches(".json");
    let target = dir.join(format!("{stem}-{side}-{stamp}.{ext}"));
    std::fs::copy(source, &target).map_err(|e| format!("{}: {e}", source.display()))?;
    Ok(target)
}

/// Stores a PNG the app made itself (a board picture taken from a PDF page).
pub fn store_photo_png(
    dir: &Path,
    key: &str,
    side: &str,
    png: &[u8],
    stamp: u128,
) -> Result<PathBuf, String> {
    if !matches!(side, "top" | "bottom") {
        return Err(format!("unknown side {side}"));
    }
    if !png.starts_with(b"\x89PNG") {
        return Err("not a PNG image".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = file_name(key);
    let stem = name.trim_end_matches(".json");
    let target = dir.join(format!("{stem}-{side}-{stamp}.png"));
    std::fs::write(&target, png).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(target)
}

/// Deletes a stored photo; paths outside `dir` are refused.
pub fn remove_photo(dir: &Path, path: &Path) -> Result<(), String> {
    let inside = path.parent().is_some_and(|p| p == dir) && path.file_name().is_some();
    if !inside {
        return Err(format!("{}: not a stored photo", path.display()));
    }
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("{}: {e}", path.display())),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_removes_photos() {
        let dir = std::env::temp_dir().join(format!("avero-photos-{}", std::process::id()));
        let source = std::env::temp_dir().join(format!("avero-photo-src-{}.JPG", std::process::id()));
        std::fs::write(&source, b"jpeg").unwrap();
        let stored = store_photo(&dir, "820-02100", "top", &source, 7).unwrap();
        assert_eq!(stored.file_name().unwrap(), "820-02100-top-7.jpg");
        assert_eq!(std::fs::read(&stored).unwrap(), b"jpeg");
        assert!(store_photo(&dir, "x", "left", &source, 7).is_err());
        let case = store_photo(&dir, "820-02100", "case", &source, 8).unwrap();
        assert_eq!(case.file_name().unwrap(), "820-02100-case-8.jpg");
        remove_photo(&dir, &case).unwrap();
        assert!(store_photo(&dir, "x", "top", Path::new("/tmp/a.pdf"), 7).is_err());
        assert!(remove_photo(&dir, &source).is_err());
        remove_photo(&dir, &stored).unwrap();
        assert!(!stored.exists());
        std::fs::remove_file(&source).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stores_rendered_pngs() {
        let dir = std::env::temp_dir().join(format!("avero-png-{}", std::process::id()));
        let stored = store_photo_png(&dir, "PS5 EDM-010", "top", b"\x89PNG\r\n", 9).unwrap();
        assert_eq!(stored.file_name().unwrap(), "ps5_edm-010-top-9.png");
        assert!(store_photo_png(&dir, "x", "case", b"\x89PNG", 9).is_err());
        assert!(store_photo_png(&dir, "x", "top", b"GIF89a", 9).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_snapshots_apart_in_time() {
        let dir = std::env::temp_dir().join(format!("avero-versions-{}", std::process::id()));
        save_with_version(&dir, "820-02100", "{\"a\":1}", 1000).unwrap();
        save_with_version(&dir, "820-02100", "{\"a\":2}", 1300).unwrap();
        save_with_version(&dir, "820-02100", "{\"a\":3}", 1700).unwrap();
        assert_eq!(versions(&dir, "820-02100"), vec![1700, 1000]);
        assert_eq!(load_version(&dir, "820-02100", 1000).unwrap(), "{\"a\":1}");
        assert_eq!(load(&dir, "820-02100").unwrap().as_deref(), Some("{\"a\":3}"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn makes_safe_file_names() {
        assert_eq!(file_name("820-02100"), "820-02100.json");
        assert_eq!(file_name("../../etc/passwd"), "etc_passwd.json");
        assert_eq!(file_name("Mein Board: X1 Carbon"), "mein_board__x1_carbon.json");
        assert_eq!(file_name("  "), "board.json");
    }

    #[test]
    fn round_trips_and_rejects_non_json() {
        let dir = std::env::temp_dir().join(format!("avero-notes-{}", std::process::id()));
        assert_eq!(load(&dir, "x").unwrap(), None);
        save(&dir, "x", r#"{"version":1}"#).unwrap();
        assert_eq!(load(&dir, "x").unwrap().as_deref(), Some(r#"{"version":1}"#));
        assert!(save(&dir, "x", "not json").is_err());
        assert_eq!(load(&dir, "x").unwrap().as_deref(), Some(r#"{"version":1}"#));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
