use avero_formats::{project::Files, ParseError};
use std::{collections::BTreeMap, path::Path};
fn error(s: impl Into<String>) -> super::LoadError {
    super::LoadError { code: "invalid", message: s.into(), format: Some("PCB project") }
}
fn walk(root: &Path, at: &Path, files: &mut Files, total: &mut usize) -> Result<(), super::LoadError> {
    if at.components().count().saturating_sub(root.components().count()) > 16 {
        return Err(error("Project folder is nested too deeply"));
    }
    for entry in std::fs::read_dir(at).map_err(|e| error(e.to_string()))? {
        let entry = entry.map_err(|e| error(e.to_string()))?;
        let kind = entry.file_type().map_err(|e| error(e.to_string()))?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            walk(root, &entry.path(), files, total)?;
        } else if kind.is_file() {
            if files.len() >= 100_000 {
                return Err(error("Too many project files"));
            }
            let size = entry.metadata().map_err(|e| error(e.to_string()))?.len();
            if size > 128 * 1024 * 1024 {
                return Err(ParseError::TooLarge.into());
            }
            *total = total.checked_add(size as usize).ok_or(ParseError::TooLarge)?;
            if *total > avero_formats::MAX_FILE_SIZE {
                return Err(ParseError::TooLarge.into());
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|e| error(e.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            files.insert(relative, super::read(&path)?);
        }
    }
    Ok(())
}
pub fn files(path: &Path) -> Result<Files, super::LoadError> {
    if path.is_dir() {
        let mut files = BTreeMap::new();
        walk(path, path, &mut files, &mut 0)?;
        return Ok(files);
    }
    if path.extension().is_some_and(|s| s.eq_ignore_ascii_case("epcb")) {
        let parent = path.parent().unwrap_or(Path::new("."));
        let root = if parent.file_name().is_some_and(|s| s.eq_ignore_ascii_case("PCB")) {
            parent.parent().unwrap_or(parent)
        } else {
            parent
        };
        if root.join("project.json").is_file() {
            let mut files = BTreeMap::new();
            walk(root, root, &mut files, &mut 0)?;
            return Ok(files);
        }
        return Ok(Files::from([("PCB/board.epcb".into(), super::read(path)?)]));
    }
    Ok(avero_formats::project::archive(&super::read(path)?)?)
}
#[tauri::command]
pub async fn project_members(
    path: String,
) -> Result<Vec<avero_formats::project::ProjectMember>, super::LoadError> {
    Ok(avero_formats::project::members(&files(Path::new(&path))?))
}
