//! Per-board workbench data (measurements, repair cases, notes), stored as
//! one JSON file per board in the app's data folder. The content belongs to
//! the UI; this side only checks that it is JSON and writes it safely.

use std::path::{Path, PathBuf};

/// File name for a board key: lower case, filesystem-safe, bounded length.
/// A key that had to be changed for that (other characters, too long) gets a
/// hash of the full key, so `A+B` and `A B` never share a file.
pub fn file_name(key: &str) -> String {
    let (safe, exact) = safe_name(key);
    if exact {
        format!("{safe}.json")
    } else {
        format!("{safe}~{:08x}.json", fnv1a(key.trim()) as u32)
    }
}

/// The name before keys were made unique; still read when a board has no file under the new name.
fn legacy_file_name(key: &str) -> String {
    format!("{}.json", safe_name(key).0)
}

fn safe_name(key: &str) -> (String, bool) {
    let lower = key.trim().to_lowercase();
    let mapped: String = lower
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .collect();
    let trimmed = mapped.trim_matches(|c| c == '.' || c == '_');
    let mut safe: String = trimmed.chars().take(96).collect();
    let exact = safe == key.trim() && !safe.is_empty();
    if safe.is_empty() {
        safe = "board".into();
    }
    (safe, exact)
}

/// FNV-1a: small, stable across versions and platforms.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

pub fn load(dir: &Path, key: &str) -> Result<Option<String>, String> {
    let read = |name: String| {
        let path = dir.join(name);
        match std::fs::read_to_string(&path) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    };
    let name = file_name(key);
    let legacy = legacy_file_name(key);
    match read(name.clone())? {
        Some(s) => Ok(Some(s)),
        None if legacy != name => read(legacy),
        None => Ok(None),
    }
}

/// Moves a file that is no valid JSON aside (`<name>.damaged-<stamp>.json`)
/// so a new save cannot overwrite it; returns the new path.
pub fn set_aside(dir: &Path, key: &str, stamp: u64) -> Result<Option<PathBuf>, String> {
    for name in [file_name(key), legacy_file_name(key)] {
        let path = dir.join(&name);
        if path.exists() {
            let target = dir.join(format!("{}.damaged-{stamp}.json", name.trim_end_matches(".json")));
            std::fs::rename(&path, &target).map_err(|e| format!("{}: {e}", path.display()))?;
            return Ok(Some(target));
        }
    }
    Ok(None)
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

fn legacy_versions_dir(dir: &Path, key: &str) -> PathBuf {
    dir.join("versions").join(legacy_file_name(key).trim_end_matches(".json"))
}

/// Snapshot times of a board, newest first (also those from before keys were made unique).
pub fn versions(dir: &Path, key: &str) -> Vec<u64> {
    let mut out = stamps(&versions_dir(dir, key));
    if legacy_file_name(key) != file_name(key) {
        for s in stamps(&legacy_versions_dir(dir, key)) {
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out.sort_unstable_by(|a, b| b.cmp(a));
    out
}

fn stamps(folder: &Path) -> Vec<u64> {
    std::fs::read_dir(folder)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|e| {
                    e.file_name().to_string_lossy().strip_suffix(".json").and_then(|s| s.parse().ok())
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn load_version(dir: &Path, key: &str, stamp: u64) -> Result<String, String> {
    let path = versions_dir(dir, key).join(format!("{stamp}.json"));
    match std::fs::read_to_string(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let old = legacy_versions_dir(dir, key).join(format!("{stamp}.json"));
            std::fs::read_to_string(&old).map_err(|e| format!("{}: {e}", old.display()))
        }
        other => other.map_err(|e| format!("{}: {e}", path.display())),
    }
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

/// Stores a PNG the app made itself (a board picture taken from a PDF page,
/// or a camera snapshot).
pub fn store_photo_png(
    dir: &Path,
    key: &str,
    side: &str,
    png: &[u8],
    stamp: u128,
) -> Result<PathBuf, String> {
    // Board pictures per side, or camera snapshots for a repair case.
    if !matches!(side, "top" | "bottom" | "case") {
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

/// Deletes stored photos that no board refers to any more: not in the notes,
/// not in any saved version of them, and older than `min_age` (undo within a
/// session still finds them). Returns how many went.
pub fn prune_photos(photos: &Path, notes: &Path, min_age: std::time::Duration) -> usize {
    fn texts(dir: &Path, out: &mut String) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.filter_map(Result::ok) {
            let path = e.path();
            if path.is_dir() {
                texts(&path, out);
            } else if path.extension().is_some_and(|x| x == "json") {
                if let Ok(s) = std::fs::read_to_string(&path) {
                    out.push_str(&s);
                }
            }
        }
    }
    let mut referenced = String::new();
    texts(notes, &mut referenced);
    let Ok(entries) = std::fs::read_dir(photos) else { return 0 };
    let now = std::time::SystemTime::now();
    let mut removed = 0;
    for e in entries.filter_map(Result::ok) {
        let path = e.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if referenced.contains(name) {
            continue;
        }
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age >= min_age);
        if old && path.is_file() && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Copies a picture of a saved wiki page into `dir`, named by its content so
/// the same picture on several pages is stored once; returns the copy's path.
pub fn store_knowledge_image(dir: &Path, source: &Path) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"))
        .ok_or_else(|| format!("{}: not a picture", source.display()))?;
    let bytes = std::fs::read(source).map_err(|e| format!("{}: {e}", source.display()))?;
    let hash = Sha256::digest(&bytes);
    let name: String = hash[..12].iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let target = dir.join(format!("{name}.{ext}"));
    if !target.exists() {
        std::fs::write(&target, &bytes).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_photos_the_notes_or_their_versions_still_use() {
        let base = std::env::temp_dir().join(format!("avero-prune-{}", std::process::id()));
        let (photos, notes) = (base.join("photos"), base.join("boards"));
        std::fs::create_dir_all(&photos).unwrap();
        for n in ["used.jpg", "in-version.jpg", "gone.jpg"] {
            std::fs::write(photos.join(n), b"x").unwrap();
        }
        save(&notes, "b", r#"{"file":"/x/photos/used.jpg"}"#).unwrap();
        write_json(&notes.join("versions/b/1.json"), r#"{"file":"/x/photos/in-version.jpg"}"#).unwrap();
        // Young files stay even when unused.
        assert_eq!(prune_photos(&photos, &notes, std::time::Duration::from_secs(3600)), 0);
        assert_eq!(prune_photos(&photos, &notes, std::time::Duration::ZERO), 1);
        assert!(photos.join("used.jpg").exists() && photos.join("in-version.jpg").exists());
        assert!(!photos.join("gone.jpg").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn keys_that_only_look_alike_get_their_own_files() {
        assert_eq!(file_name("820-02100"), "820-02100.json");
        assert_ne!(file_name("A+B"), file_name("A B"));
        let long_a = format!("{}a", "x".repeat(100));
        let long_b = format!("{}b", "x".repeat(100));
        assert_ne!(file_name(&long_a), file_name(&long_b));

        let dir = std::env::temp_dir().join(format!("avero-keys-{}", std::process::id()));
        save(&dir, "A+B", r#"{"k":1}"#).unwrap();
        save(&dir, "A B", r#"{"k":2}"#).unwrap();
        assert_eq!(load(&dir, "A+B").unwrap().unwrap(), r#"{"k":1}"#);
        assert_eq!(load(&dir, "A B").unwrap().unwrap(), r#"{"k":2}"#);
        // A file written under the old name is still found.
        std::fs::write(dir.join("c_d.json"), r#"{"k":3}"#).unwrap();
        assert_eq!(load(&dir, "c+d").unwrap().unwrap(), r#"{"k":3}"#);
        // A damaged file is moved aside, not overwritten.
        let aside = set_aside(&dir, "c+d", 5).unwrap().unwrap();
        assert!(aside.ends_with("c_d.damaged-5.json"));
        assert_eq!(load(&dir, "c+d").unwrap(), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stores_each_knowledge_picture_once() {
        let base = std::env::temp_dir().join(format!("avero-kb-{}", std::process::id()));
        let dir = base.join("images");
        std::fs::create_dir_all(&base).unwrap();
        let a = base.join("a.JPG");
        let b = base.join("b.jpg");
        let other = base.join("c.jpg");
        std::fs::write(&a, b"same").unwrap();
        std::fs::write(&b, b"same").unwrap();
        std::fs::write(&other, b"other").unwrap();
        let sa = store_knowledge_image(&dir, &a).unwrap();
        assert_eq!(sa, store_knowledge_image(&dir, &b).unwrap());
        assert_ne!(sa, store_knowledge_image(&dir, &other).unwrap());
        assert_eq!(sa.extension().unwrap(), "jpg");
        assert!(store_knowledge_image(&dir, &base.join("x.html")).is_err());
        std::fs::remove_dir_all(&base).unwrap();
    }

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
        let name = stored.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("ps5_edm-010~") && name.ends_with("-top-9.png"), "{name}");
        // Camera snapshots for a repair case.
        let snap = store_photo_png(&dir, "x", "case", b"\x89PNG", 9).unwrap();
        assert_eq!(snap.file_name().unwrap(), "x-case-9.png");
        assert!(store_photo_png(&dir, "x", "left", b"\x89PNG", 9).is_err());
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
        assert!(file_name("../../etc/passwd").starts_with("etc_passwd~"));
        assert!(file_name("Mein Board: X1 Carbon").starts_with("mein_board__x1_carbon~"));
        assert!(file_name("  ").starts_with("board~"));
        assert!(!file_name("../x").contains('/'));
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
