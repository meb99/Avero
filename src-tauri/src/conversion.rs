//! File selection → native conversion → validated GenCAD → own library.

use avero_formats::{
    convert::{xzz_to_gencad, ConversionReport},
    formats::parse_xzz_key,
    MAX_FILE_SIZE,
};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertedFile {
    pub path: String,
    pub duplicate: bool,
    pub parts: usize,
    pub pins: usize,
    pub report: ConversionReport,
}

pub fn convert_file(
    root: &Path,
    path: &Path,
    folder: Option<&str>,
    key: Option<&str>,
) -> Result<ConvertedFile, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE as u64 {
        return Err("The file is too large to convert.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let stem = path.file_stem().and_then(|s| s.to_str()).ok_or("Invalid input file name.")?;
    convert_bytes(root, &bytes, stem, folder, key)
}

pub(crate) fn convert_bytes(
    root: &Path,
    bytes: &[u8],
    stem: &str,
    folder: Option<&str>,
    key: Option<&str>,
) -> Result<ConvertedFile, String> {
    let key = key
        .filter(|k| !k.trim().is_empty())
        .map(|k| parse_xzz_key(k).ok_or("Invalid XZZ key in settings."))
        .transpose()?;
    let converted = xzz_to_gencad(bytes, stem, key).map_err(|e| e.to_string())?;
    // Use the very same reader that opens the stored file in Avero. No empty or
    // unparseable output is added to the library on a conversion failure.
    let board = avero_formats::parse(&converted.cad, Some("converted.cad")).map_err(|e| e.to_string())?;
    if board.pins.len() < converted.pins {
        return Err("Some component pins were lost in conversion.".into());
    }
    let (stored, duplicate) =
        crate::import::import_generated(root, format!("{stem}.cad"), converted.cad, folder)?;
    Ok(ConvertedFile {
        path: stored.to_string_lossy().into_owned(),
        duplicate,
        parts: converted.parts,
        pins: converted.pins,
        report: converted.report,
    })
}

pub fn restore_source(path: &Path, output: &Path) -> Result<(), String> {
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_FILE_SIZE as u64 {
        return Err("The file is too large.".into());
    }
    if path.canonicalize().ok() == output.canonicalize().ok() {
        return Err("Choose a different file for the original XZZ.".into());
    }
    let cad = std::fs::read(path).map_err(|e| e.to_string())?;
    let source = avero_formats::convert::original_xzz(&cad)
        .map_err(|e| e.to_string())?
        .ok_or("This CAD file has no embedded XZZ original.")?;
    std::fs::write(output, source).map_err(|e| e.to_string())
}

/// Deterministic, bounded folder traversal. Symlinks are not followed.
pub fn find_files(path: &Path) -> Result<Vec<String>, String> {
    fn walk(path: &Path, depth: usize, out: &mut Vec<String>) -> Result<(), String> {
        use std::io::Read;
        let metadata = std::fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Ok(());
        }
        if metadata.is_dir() {
            if depth >= 16 {
                return Err("Too many nested folders.".into());
            }
            for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if !entry.file_name().to_string_lossy().starts_with('.') {
                    walk(&entry.path(), depth + 1, out)?;
                }
            }
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pcb")) {
            let mut head = [0u8; 32];
            let n =
                std::fs::File::open(path).and_then(|mut f| f.read(&mut head)).map_err(|e| e.to_string())?;
            if crate::library::is_xzz_head(&head[..n]) {
                if out.len() >= 10_000 {
                    return Err("Too many XZZ files in this folder.".into());
                }
                out.push(path.to_string_lossy().into_owned());
            }
        }
        Ok(())
    }
    if !path.is_dir() {
        return Err("Choose a folder containing XZZ files.".into());
    }
    let mut files = Vec::new();
    walk(path, 0, &mut files)?;
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_input_does_not_add_any_library_file() {
        let dir = std::env::temp_dir().join(format!("avero-convert-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("broken.pcb");
        std::fs::write(&source, b"not a PCB").unwrap();
        let root = dir.join("library");
        assert!(convert_file(&root, &source, None, None).is_err());
        assert!(!root.exists());
        assert_eq!(std::fs::read(&source).unwrap(), b"not a PCB");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn finds_xzz_in_subfolders_and_ignores_other_pcb_formats_and_symlinks() {
        let dir = std::env::temp_dir().join(format!("avero-xzz-folder-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        let mut head = [0u8; 32];
        head[..6].copy_from_slice(b"XZZPCB");
        std::fs::write(dir.join("nested/board.PCB"), head).unwrap();
        std::fs::write(dir.join("other.pcb"), b"foreign EDA format").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&dir, dir.join("nested/loop")).unwrap();
        assert_eq!(
            find_files(&dir).unwrap(),
            vec![dir.join("nested/board.PCB").to_string_lossy().into_owned()]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
