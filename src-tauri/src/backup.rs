//! A complete local backup in one ZIP: the own library (boardviews and
//! schematics), Avero's data folder (board notes, repair cases, photos,
//! knowledge, saved flows, datasheets) and the settings handed over by the
//! UI. Restoring puts everything back and rewrites stored absolute paths, so
//! a backup moves to another Mac with another user name.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;

/// Folders in the data folder that are caches, rebuilt on their own.
const SKIP_DATA: &[&str] = &["text-index", "EBWebView", "WebKit"];
const MANIFEST: &str = "avero-backup.json";

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct Manifest {
    pub version: u32,
    pub created: String,
    pub app: String,
    /// Paths on the machine the backup was made on, to rewrite stored paths.
    pub library_dir: String,
    pub data_dir: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub files: usize,
    pub bytes: u64,
}

fn walk(dir: &Path, base: &Path, skip: &[&str], out: &mut Vec<(PathBuf, String)>) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || (dir == base && skip.contains(&name.as_str())) {
            continue;
        }
        let ty = entry.file_type()?;
        if ty.is_dir() {
            walk(&path, base, skip, out)?;
        } else if ty.is_file() {
            let rel = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            out.push((path, rel));
        }
    }
    Ok(())
}

/// Writes the backup. `settings` is the UI's stored settings as JSON.
pub fn create(
    out: &Path,
    library: &Path,
    data: &Path,
    settings: &str,
    app: &str,
    created: &str,
) -> Result<Summary, String> {
    let mut files = Vec::new();
    walk(library, library, &[], &mut files).map_err(|e| format!("{}: {e}", library.display()))?;
    let library_count = files.len();
    walk(data, data, SKIP_DATA, &mut files).map_err(|e| format!("{}: {e}", data.display()))?;

    let tmp = out.with_extension("zip.part");
    let file = File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    // Photos and PDFs hardly shrink: store them, compress the rest.
    let stored =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
    let packed =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    let mut summary = Summary::default();
    let mut buf = Vec::new();
    for (i, (path, rel)) in files.iter().enumerate() {
        let name = if i < library_count { format!("library/{rel}") } else { format!("data/{rel}") };
        let lower = rel.to_lowercase();
        let options = if [".jpg", ".jpeg", ".png", ".heic", ".webp", ".pdf", ".zip", ".7z", ".rar"]
            .iter()
            .any(|x| lower.ends_with(x))
        {
            stored
        } else {
            packed
        };
        buf.clear();
        File::open(path)
            .and_then(|mut f| f.read_to_end(&mut buf))
            .map_err(|e| format!("{}: {e}", path.display()))?;
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(&buf).map_err(|e| e.to_string())?;
        summary.files += 1;
        summary.bytes += buf.len() as u64;
    }
    zip.start_file("settings.json", packed).map_err(|e| e.to_string())?;
    zip.write_all(settings.as_bytes()).map_err(|e| e.to_string())?;
    let manifest = Manifest {
        version: 1,
        created: created.to_string(),
        app: app.to_string(),
        library_dir: library.to_string_lossy().into_owned(),
        data_dir: data.to_string_lossy().into_owned(),
        files: summary.files,
        bytes: summary.bytes,
    };
    zip.start_file(MANIFEST, packed).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, out).map_err(|e| format!("{}: {e}", out.display()))?;
    Ok(summary)
}

/// Joins a relative archive path onto `base`, refusing anything that climbs out of it.
fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(base.join(rel))
}

/// JSON-escaped form of a path, as it appears inside stored JSON.
fn json_path(p: &str) -> String {
    let quoted = serde_json::to_string(p).unwrap_or_default();
    quoted.trim_matches('"').to_string()
}

pub struct Restored {
    pub summary: Summary,
    pub settings: Option<String>,
    pub manifest: Manifest,
}

/// Restores a backup. The current data folder is kept beside it as
/// `<data>-before-restore-<stamp>`, so a restore can be undone by hand.
pub fn restore(archive: &Path, library: &Path, data: &Path, stamp: &str) -> Result<Restored, String> {
    let file = File::open(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("{}: {e}", archive.display()))?;
    let manifest: Manifest = {
        let mut entry = zip.by_name(MANIFEST).map_err(|_| "not an Avero backup".to_string())?;
        let mut text = String::new();
        entry.read_to_string(&mut text).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| format!("{MANIFEST}: {e}"))?
    };
    if data.exists() {
        let name = format!(
            "{}-before-restore-{stamp}",
            data.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()
        );
        let keep = data.with_file_name(name);
        // Copy, not move: the running app keeps files open in its data folder.
        let mut files = Vec::new();
        walk(data, data, SKIP_DATA, &mut files).map_err(|e| e.to_string())?;
        for (path, rel) in files {
            if let Some(target) = safe_join(&keep, &rel) {
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::copy(&path, &target).map_err(|e| format!("{}: {e}", path.display()))?;
            }
        }
    }
    // Stored notes hold absolute paths of photos and library files: point them here.
    let rewrites = [
        (json_path(&manifest.data_dir), json_path(&data.to_string_lossy())),
        (json_path(&manifest.library_dir), json_path(&library.to_string_lossy())),
    ];
    let mut summary = Summary::default();
    let mut settings = None;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        let target = if let Some(rel) = name.strip_prefix("library/") {
            safe_join(library, rel)
        } else if let Some(rel) = name.strip_prefix("data/") {
            if rel.ends_with(".json") {
                let mut text = String::from_utf8_lossy(&buf).into_owned();
                for (from, to) in &rewrites {
                    if !from.is_empty() && from != to {
                        text = text.replace(from.as_str(), to);
                    }
                }
                buf = text.into_bytes();
            }
            safe_join(data, rel)
        } else {
            if name == "settings.json" {
                settings = Some(String::from_utf8_lossy(&buf).into_owned());
            }
            None
        };
        let Some(target) = target else { continue };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        std::fs::write(&target, &buf).map_err(|e| format!("{}: {e}", target.display()))?;
        summary.files += 1;
        summary.bytes += buf.len() as u64;
    }
    Ok(Restored { summary, settings, manifest })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("avero-backup-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backs_up_and_restores_with_paths_rewritten() {
        let root = tmp("a");
        let library = root.join("old/Bibliothek");
        let data = root.join("old/data");
        std::fs::create_dir_all(library.join("Apple/A2338")).unwrap();
        std::fs::write(library.join("Apple/A2338/820-02100.brd"), b"board").unwrap();
        std::fs::create_dir_all(data.join("boards")).unwrap();
        std::fs::create_dir_all(data.join("photos")).unwrap();
        std::fs::create_dir_all(data.join("text-index")).unwrap();
        std::fs::write(data.join("photos/x-top-1.png"), b"\x89PNG").unwrap();
        let photo = data.join("photos/x-top-1.png").to_string_lossy().into_owned();
        std::fs::write(
            data.join("boards/x.json"),
            format!("{{\"photos\":{{\"top\":{{\"file\":{}}}}}}}", serde_json::to_string(&photo).unwrap()),
        )
        .unwrap();
        std::fs::write(data.join("text-index/cache.json"), b"{}").unwrap();

        let archive = root.join("backup.zip");
        let made = create(
            &archive,
            &library,
            &data,
            "{\"avero.settings.v1\":\"{}\"}",
            "0.9.20",
            "2026-10-02T12:00:00Z",
        )
        .unwrap();
        assert_eq!(made.files, 3, "library file, notes, photo; the cache is left out");

        let new_library = root.join("new/Bibliothek");
        let new_data = root.join("new/data");
        std::fs::create_dir_all(&new_data).unwrap();
        std::fs::write(new_data.join("old.txt"), b"before").unwrap();
        let back = restore(&archive, &new_library, &new_data, "1").unwrap();
        assert_eq!(back.summary.files, 3);
        assert_eq!(back.settings.as_deref(), Some("{\"avero.settings.v1\":\"{}\"}"));
        assert_eq!(back.manifest.app, "0.9.20");
        assert_eq!(std::fs::read(new_library.join("Apple/A2338/820-02100.brd")).unwrap(), b"board");
        let notes = std::fs::read_to_string(new_data.join("boards/x.json")).unwrap();
        assert!(
            notes.contains(&new_data.join("photos/x-top-1.png").to_string_lossy().into_owned()),
            "{notes}"
        );
        // The data folder as it was is kept beside it.
        assert_eq!(std::fs::read(root.join("new/data-before-restore-1/old.txt")).unwrap(), b"before");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refuses_paths_that_climb_out() {
        assert!(safe_join(Path::new("/a"), "../etc/passwd").is_none());
        assert!(safe_join(Path::new("/a"), "/etc/passwd").is_none());
        assert_eq!(safe_join(Path::new("/a"), "b/c.json"), Some(PathBuf::from("/a/b/c.json")));
    }
}
