//! File selection → native conversion → validated GenCAD → own library.

use avero_formats::{convert::xzz_to_gencad, formats::parse_xzz_key, MAX_FILE_SIZE};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertedFile {
    pub path: String,
    pub duplicate: bool,
    pub parts: usize,
    pub pins: usize,
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
    let key = key
        .filter(|k| !k.trim().is_empty())
        .map(|k| parse_xzz_key(k).ok_or("Invalid XZZ key in settings."))
        .transpose()?;
    let stem = path.file_stem().and_then(|s| s.to_str()).ok_or("Invalid input file name.")?;
    let converted = xzz_to_gencad(&bytes, stem, key).map_err(|e| e.to_string())?;
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
    })
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
}
