//! Copies boardviews and schematics into Avero's own library folder.
//!
//! Accepts single files, whole folders and ZIP, 7z and RAR archives. Files are sorted
//! into one folder per board: the name the user typed, else the board number
//! from the file or archive name, else the file name. Identical files are
//! skipped; different files with the same name are numbered.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::id_tokens;
use crate::library::is_importable;

const MAX_DEPTH: usize = 16;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Paths of the copied files inside the library.
    pub imported: Vec<String>,
    /// Files already in the library with identical content.
    pub duplicates: usize,
    /// Files that are neither boardviews nor PDFs.
    pub skipped: usize,
    pub errors: Vec<String>,
}

enum Data {
    File(PathBuf),
    Bytes(Vec<u8>),
}

struct Source {
    name: String,
    /// Name of the folder or archive the file came from.
    context: String,
    data: Data,
}

fn head_of(path: &Path) -> Vec<u8> {
    let mut head = vec![0u8; 0x20];
    let n = std::fs::File::open(path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    head.truncate(n);
    head
}

fn stem(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(s, _)| s)
}

fn dir_name(path: &Path) -> String {
    path.parent().and_then(Path::file_name).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn collect(path: &Path, depth: usize, out: &mut Vec<Source>, result: &mut ImportResult) {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if name.starts_with('.') {
        return;
    }
    if path.is_dir() {
        if depth >= MAX_DEPTH {
            return;
        }
        match std::fs::read_dir(path) {
            Ok(entries) => {
                for e in entries.filter_map(Result::ok) {
                    collect(&e.path(), depth + 1, out, result);
                }
            }
            Err(e) => result.errors.push(format!("{}: {e}", path.display())),
        }
    } else if name.to_ascii_lowercase().ends_with(".zip") {
        if let Err(e) = expand_zip(path, out, result) {
            result.errors.push(format!("{name}: {e}"));
        }
    } else if [".7z", ".rar"].iter().any(|ext| name.to_ascii_lowercase().ends_with(ext)) {
        if let Err(e) = expand_with_bsdtar(path, out, result) {
            result.errors.push(format!("{name}: {e}"));
        }
    } else if is_importable(&name, || head_of(path)) {
        out.push(Source { context: dir_name(path), name, data: Data::File(path.to_path_buf()) });
    } else {
        result.skipped += 1;
    }
}

fn expand_zip(path: &Path, out: &mut Vec<Source>, result: &mut ImportResult) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let archive_name = path.file_name().map(|n| stem(&n.to_string_lossy()).to_string()).unwrap_or_default();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        // Only the base name is used, so archive paths cannot escape the library.
        let entry_path = entry.name().replace('\\', "/");
        let mut parts: Vec<&str> = entry_path.split('/').filter(|p| !p.is_empty()).collect();
        let Some(name) = parts.pop().map(str::to_string) else { continue };
        if name.starts_with('.') || entry_path.contains("__MACOSX") {
            continue;
        }
        if entry.size() > avero_formats::MAX_FILE_SIZE as u64 {
            result.errors.push(format!("{name}: too large"));
            continue;
        }
        let mut data = Vec::with_capacity(entry.size() as usize);
        if let Err(e) = entry.read_to_end(&mut data) {
            result.errors.push(format!("{name}: {e}"));
            continue;
        }
        if is_importable(&name, || data.iter().take(0x20).copied().collect()) {
            let context = parts.last().map_or(archive_name.clone(), |p| (*p).to_string());
            out.push(Source { name, context, data: Data::Bytes(data) });
        } else {
            result.skipped += 1;
        }
    }
    Ok(())
}

/// libarchive's `bsdtar`, which reads 7z and RAR. macOS ships it as `tar`.
fn bsdtar() -> Option<&'static str> {
    let works = |tool: &str| Command::new(tool).arg("--version").output().is_ok_and(|o| o.status.success());
    ["bsdtar", "/usr/bin/bsdtar"]
        .into_iter()
        .find(|tool| works(tool))
        .or(cfg!(target_os = "macos").then_some("/usr/bin/tar"))
}

/// Unpacks a 7z or RAR archive into a temporary folder and reads the
/// usable files from it. bsdtar refuses absolute paths and `..` in archive
/// entries; symbolic links from the archive are not followed either.
fn expand_with_bsdtar(path: &Path, out: &mut Vec<Source>, result: &mut ImportResult) -> Result<(), String> {
    let tool = bsdtar().ok_or("7z and RAR archives need bsdtar (part of macOS)")?;
    let stamp =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("avero-unpack-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let unpacked = Command::new(tool)
        .arg("-x")
        .arg("-f")
        .arg(path)
        .arg("-C")
        .arg(&tmp)
        .output()
        .map_err(|e| e.to_string())
        .and_then(|o| {
            if o.status.success() {
                Ok(())
            } else {
                let message = String::from_utf8_lossy(&o.stderr);
                Err(message.lines().last().unwrap_or("could not unpack").trim().to_string())
            }
        });
    if unpacked.is_ok() {
        let archive_name =
            path.file_name().map(|n| stem(&n.to_string_lossy()).to_string()).unwrap_or_default();
        read_unpacked(&tmp, &archive_name, 0, out, result);
    }
    let _ = std::fs::remove_dir_all(&tmp);
    unpacked
}

/// Reads files from an unpacked archive into memory (the folder is removed
/// right after).
fn read_unpacked(dir: &Path, context: &str, depth: usize, out: &mut Vec<Source>, result: &mut ImportResult) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        if name.starts_with('.') || name == "__MACOSX" || meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if depth < MAX_DEPTH {
                read_unpacked(&path, &name, depth + 1, out, result);
            }
        } else if meta.len() > avero_formats::MAX_FILE_SIZE as u64 {
            result.errors.push(format!("{name}: too large"));
        } else if is_importable(&name, || head_of(&path)) {
            match std::fs::read(&path) {
                Ok(data) => out.push(Source { name, context: context.to_string(), data: Data::Bytes(data) }),
                Err(e) => result.errors.push(format!("{name}: {e}")),
            }
        } else {
            result.skipped += 1;
        }
    }
}

/// Renames a library file in place. The new name may not leave the folder,
/// keeps the old extension when none is given, and never overwrites.
pub fn rename_file(path: &Path, new_name: &str) -> Result<PathBuf, String> {
    let name = new_name.trim();
    let bad = name.is_empty()
        || name.starts_with('.')
        || name.contains(['/', '\\', ':'])
        || name.chars().any(char::is_control);
    if bad {
        return Err(format!("invalid name: {new_name}"));
    }
    if !path.is_file() {
        return Err(format!("{}: not a file", path.display()));
    }
    let ext = path.extension().map(|e| e.to_string_lossy().into_owned());
    let has_ext = match &ext {
        Some(e) => name.to_ascii_lowercase().ends_with(&format!(".{}", e.to_ascii_lowercase())),
        None => true,
    };
    let file = if has_ext { name.to_string() } else { format!("{name}.{}", ext.unwrap_or_default()) };
    let target = path.with_file_name(&file);
    if target == path {
        return Ok(target);
    }
    // Only a change of upper/lower case may point at the same file.
    let same_file = target.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase();
    if target.exists() && !same_file {
        return Err(format!("{file} already exists"));
    }
    std::fs::rename(path, &target).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(target)
}

/// Keeps a user-typed folder path inside the library: no `..`, no
/// characters Finder or other systems choke on.
pub fn sanitize_folder(folder: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for part in folder.split(['/', '\\']) {
        let clean: String =
            part.trim()
                .chars()
                .map(|c| {
                    if c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                        '_'
                    } else {
                        c
                    }
                })
                .take(80)
                .collect();
        let clean = clean.trim_matches('.').trim();
        if !clean.is_empty() {
            out.push(clean);
        }
    }
    (out.components().count() > 0).then_some(out)
}

/// Folder inside the library a file belongs to when none was given.
fn board_folder(source: &Source) -> PathBuf {
    let token = id_tokens(&stem(&source.name).to_lowercase())
        .into_iter()
        .next()
        .or_else(|| id_tokens(&source.context.to_lowercase()).into_iter().next());
    if let Some(t) = token {
        return PathBuf::from(t.to_uppercase());
    }
    // ASC sets are several files with generic names; keep them together.
    let fallback = if source.name.to_ascii_lowercase().ends_with(".asc") {
        source.context.as_str()
    } else {
        stem(&source.name)
    };
    sanitize_folder(fallback).unwrap_or_else(|| PathBuf::from("Board"))
}

fn same_content(existing: &Path, data: &Data) -> bool {
    let Ok(meta) = std::fs::metadata(existing) else { return false };
    let size = match data {
        Data::File(p) => std::fs::metadata(p).map(|m| m.len()).unwrap_or(u64::MAX),
        Data::Bytes(b) => b.len() as u64,
    };
    if meta.len() != size {
        return false;
    }
    let Ok(mine) = std::fs::read(existing) else { return false };
    match data {
        Data::File(p) => std::fs::read(p).is_ok_and(|theirs| theirs == mine),
        Data::Bytes(b) => *b == mine,
    }
}

fn free_name(dir: &Path, name: &str) -> PathBuf {
    let (base, ext) = name.rsplit_once('.').map_or((name, String::new()), |(b, e)| (b, format!(".{e}")));
    (2..)
        .map(|n| dir.join(format!("{base} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or_else(|| dir.join(name))
}

/// Moves library files into `folder` (a category path such as
/// `Sony/PlayStation/PS4`) inside the library root. Only files inside the
/// root are moved; clashing names are numbered; folders left empty are
/// removed. Returns the new paths.
pub fn move_into(root: &Path, paths: &[PathBuf], folder: &str) -> Result<Vec<PathBuf>, String> {
    let sub = sanitize_folder(folder).ok_or("no category given")?;
    let root = root.canonicalize().map_err(|e| format!("{}: {e}", root.display()))?;
    let target = root.join(sub);
    std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
    let mut moved = Vec::new();
    for path in paths {
        let real = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
        if !real.starts_with(&root) || !real.is_file() {
            return Err(format!("{}: only files in the Avero library can be sorted", path.display()));
        }
        let old_dir = real.parent().map(Path::to_path_buf);
        if old_dir.as_deref() == Some(target.as_path()) {
            moved.push(real);
            continue;
        }
        let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let plain = target.join(&name);
        let dest = if plain.exists() { free_name(&target, &name) } else { plain };
        std::fs::rename(&real, &dest).map_err(|e| format!("{}: {e}", real.display()))?;
        // Remove folders that are now empty, up to the library root.
        let mut dir = old_dir;
        while let Some(d) = dir {
            if d == root || !d.starts_with(&root) || std::fs::remove_dir(&d).is_err() {
                break;
            }
            dir = d.parent().map(Path::to_path_buf);
        }
        moved.push(dest);
    }
    Ok(moved)
}

pub fn import(root: &Path, paths: &[PathBuf], folder: Option<&str>) -> ImportResult {
    let mut result = ImportResult::default();
    let mut sources = Vec::new();
    for p in paths {
        collect(p, 0, &mut sources, &mut result);
    }
    let fixed = folder.and_then(sanitize_folder);

    for source in sources {
        let dir = root.join(fixed.clone().unwrap_or_else(|| board_folder(&source)));
        if let Err(e) = std::fs::create_dir_all(&dir) {
            result.errors.push(format!("{}: {e}", dir.display()));
            continue;
        }
        let mut target = dir.join(&source.name);
        if target.exists() {
            if same_content(&target, &source.data) {
                result.duplicates += 1;
                continue;
            }
            target = free_name(&dir, &source.name);
        }
        let written = match &source.data {
            Data::File(p) => std::fs::copy(p, &target).map(|_| ()),
            Data::Bytes(b) => std::fs::write(&target, b),
        };
        match written {
            Ok(()) => result.imported.push(target.to_string_lossy().into_owned()),
            Err(e) => result.errors.push(format!("{}: {e}", source.name)),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "avero-import-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn files_in(root: &Path) -> Vec<String> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
            for e in std::fs::read_dir(dir).unwrap().filter_map(Result::ok) {
                let p = e.path();
                if p.is_dir() {
                    walk(root, &p, out);
                } else {
                    out.push(p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
                }
            }
        }
        let mut out = Vec::new();
        walk(root, root, &mut out);
        out.sort();
        out
    }

    #[test]
    fn sorts_files_into_board_folders() {
        let src = temp("src");
        let lib = temp("lib");
        std::fs::write(src.join("820-02100.brd"), b"str_length:").unwrap();
        std::fs::write(src.join("J413 820-02100 schematic.pdf"), b"%PDF").unwrap();
        std::fs::write(src.join("readme.txt"), b"hi").unwrap();
        std::fs::write(src.join("other.pcb"), b"not an xzz file at all, just text").unwrap();
        let mut xzz = b"XZZPCB V1.0".to_vec();
        xzz.resize(0x40, 0);
        std::fs::write(src.join("A2338.pcb"), &xzz).unwrap();

        let paths: Vec<PathBuf> =
            ["820-02100.brd", "J413 820-02100 schematic.pdf", "readme.txt", "other.pcb", "A2338.pcb"]
                .iter()
                .map(|n| src.join(n))
                .collect();
        let r = import(&lib, &paths, None);
        assert_eq!(r.imported.len(), 3, "{r:?}");
        assert_eq!(r.skipped, 2);
        assert_eq!(
            files_in(&lib),
            ["820-02100/820-02100.brd", "820-02100/J413 820-02100 schematic.pdf", "A2338/A2338.pcb"]
        );

        // Importing again changes nothing; a different file with the same name is numbered.
        let again = import(&lib, &paths, None);
        assert_eq!((again.imported.len(), again.duplicates), (0, 3));
        std::fs::write(src.join("820-02100.brd"), b"str_length: changed").unwrap();
        let changed = import(&lib, &paths[..1], None);
        assert!(changed.imported[0].ends_with("820-02100 (2).brd"), "{changed:?}");

        std::fs::remove_dir_all(&src).unwrap();
        std::fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn moves_files_into_categories() {
        let lib = temp("move");
        let old = lib.join("820-02100");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("820-02100.brd"), b"x").unwrap();
        std::fs::write(lib.join("taken.pdf"), b"a").unwrap();
        let dest = lib.join("Apple/MacBook Pro");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("taken.pdf"), b"b").unwrap();
        let moved = move_into(&lib, &[old.join("820-02100.brd"), lib.join("taken.pdf")], "Apple/MacBook Pro")
            .unwrap();
        assert_eq!(
            files_in(&lib),
            [
                "Apple/MacBook Pro/820-02100.brd",
                "Apple/MacBook Pro/taken (2).pdf",
                "Apple/MacBook Pro/taken.pdf"
            ]
        );
        assert!(!old.exists(), "the emptied folder is removed");
        assert_eq!(moved.len(), 2);
        assert!(move_into(&lib, &[std::env::temp_dir().join("elsewhere.brd")], "X").is_err());
        assert!(move_into(&lib, &[dest.join("taken.pdf")], "../../escape")
            .is_ok_and(|p| p[0].starts_with(lib.canonicalize().unwrap())));
        std::fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn renames_files_safely() {
        let dir = temp("rename");
        std::fs::write(dir.join("download (3).pdf"), b"%PDF").unwrap();
        std::fs::write(dir.join("taken.pdf"), b"%PDF").unwrap();
        let renamed = rename_file(&dir.join("download (3).pdf"), "J413 820-02100").unwrap();
        assert_eq!(renamed.file_name().unwrap(), "J413 820-02100.pdf");
        assert!(rename_file(&renamed, "taken").is_err(), "never overwrites");
        assert!(rename_file(&renamed, "../escape").is_err());
        assert!(rename_file(&renamed, ".hidden").is_err());
        assert!(rename_file(&renamed, "  ").is_err());
        let same = rename_file(&renamed, "J413 820-02100.PDF").unwrap();
        assert_eq!(same.file_name().unwrap(), "J413 820-02100.PDF");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unpacks_7z_archives_with_bsdtar() {
        // Runs where bsdtar is installed (always on macOS).
        let Some(tool) = bsdtar() else { return };
        let src = temp("7z");
        let lib = temp("7zlib");
        let content = src.join("content");
        std::fs::create_dir_all(content.join("board")).unwrap();
        std::fs::write(content.join("board/820-02100.brd"), b"str_length:").unwrap();
        std::fs::write(content.join("J413 820-02100.pdf"), b"%PDF").unwrap();
        std::fs::write(content.join("readme.txt"), b"hi").unwrap();
        let archive = src.join("iPhone 13 Pro.7z");
        let made = Command::new(tool)
            .args(["--format", "7zip", "-c", "-f"])
            .arg(&archive)
            .arg("-C")
            .arg(&content)
            .arg(".")
            .status()
            .unwrap();
        assert!(made.success());

        let r = import(&lib, &[archive], None);
        assert!(r.errors.is_empty(), "{r:?}");
        assert_eq!(r.skipped, 1);
        assert_eq!(files_in(&lib), ["820-02100/820-02100.brd", "820-02100/J413 820-02100.pdf"]);
        std::fs::remove_dir_all(&src).unwrap();
        std::fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn unpacks_zip_archives_and_keeps_asc_sets_together() {
        let src = temp("zip");
        let lib = temp("ziplib");
        let zip_path = src.join("X1C6 NM-B481.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
        let opts =
            zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, data) in [
            ("boardview/format.asc", &b"0 0"[..]),
            ("boardview/pins.asc", b"Part U1 (T)"),
            ("boardview/nails.asc", b""),
            ("Schematic.pdf", b"%PDF"),
            ("__MACOSX/._Schematic.pdf", b"junk"),
            ("../../escape.brd", b"str_length:"),
            ("notes.txt", b"hi"),
        ] {
            zip.start_file(name, opts).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();

        let r = import(&lib, &[zip_path], Some("Lenovo/X1 Carbon 6"));
        assert!(r.errors.is_empty(), "{r:?}");
        assert_eq!(
            files_in(&lib),
            [
                "Lenovo/X1 Carbon 6/Schematic.pdf",
                "Lenovo/X1 Carbon 6/escape.brd",
                "Lenovo/X1 Carbon 6/format.asc",
                "Lenovo/X1 Carbon 6/nails.asc",
                "Lenovo/X1 Carbon 6/pins.asc",
            ]
        );
        std::fs::remove_dir_all(&src).unwrap();
        std::fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn keeps_typed_folders_inside_the_library() {
        assert_eq!(sanitize_folder("Apple/iPhone 13 Pro"), Some(PathBuf::from("Apple/iPhone 13 Pro")));
        assert_eq!(sanitize_folder("../../etc"), Some(PathBuf::from("etc")));
        assert_eq!(sanitize_folder("a:b/ c? "), Some(PathBuf::from("a_b/c_")));
        assert_eq!(sanitize_folder(" / .. / "), None);
    }
}
