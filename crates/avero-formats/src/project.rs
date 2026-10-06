//! Bounded in-memory project archives; no extraction, external links or network.
use crate::{Board, FormatId, ParseError};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
};
pub type Files = BTreeMap<String, Vec<u8>>;
const LIMIT: usize = 512 * 1024 * 1024;
fn invalid(s: impl Into<String>) -> ParseError {
    ParseError::invalid(FormatId::Odb, s)
}
fn path(s: &str) -> Result<String, ParseError> {
    let s = s.replace('\\', "/");
    if s.starts_with('/') || s.split('/').any(|p| p == ".." || p.contains(':')) {
        return Err(invalid("Unsafe project path"));
    }
    Ok(s.split('/').filter(|p| !p.is_empty() && *p != ".").collect::<Vec<_>>().join("/"))
}
fn insert(files: &mut Files, name: &str, reader: impl Read, total: &mut usize) -> Result<(), ParseError> {
    if files.len() >= 100_000 {
        return Err(invalid("Too many project files"));
    }
    let name = path(name)?;
    let mut data = Vec::new();
    reader
        .take((LIMIT.saturating_sub(*total) + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|e| invalid(e.to_string()))?;
    *total += data.len();
    if *total > LIMIT {
        return Err(ParseError::TooLarge);
    }
    if files.insert(name.clone(), data).is_some() {
        return Err(invalid(format!("Duplicate project entry: {name}")));
    }
    Ok(())
}
pub fn archive(bytes: &[u8]) -> Result<Files, ParseError> {
    let mut files = Files::new();
    let mut total = 0;
    if bytes.starts_with(b"PK\x03\x04") {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| invalid(e.to_string()))?;
        if zip.len() > 100_000 {
            return Err(invalid("Too many project files"));
        }
        for i in 0..zip.len() {
            let entry = zip.by_index(i).map_err(|e| invalid(e.to_string()))?;
            if entry.is_dir() {
                continue;
            }
            if entry.is_symlink() {
                return Err(invalid("Project links are not followed"));
            }
            let name = entry.name().to_owned();
            insert(&mut files, &name, entry, &mut total)?;
        }
    } else {
        let reader: Box<dyn Read + '_> = if bytes.starts_with(&[0x1f, 0x8b]) {
            Box::new(flate2::read::GzDecoder::new(bytes))
        } else {
            Box::new(Cursor::new(bytes))
        };
        let mut tar = tar::Archive::new(reader);
        let entries = tar.entries().map_err(|e| invalid(e.to_string()))?;
        for entry in entries {
            let entry = entry.map_err(|e| invalid(e.to_string()))?;
            if entry.header().entry_type().is_dir() {
                continue;
            }
            if !entry.header().entry_type().is_file() {
                return Err(invalid("Only ordinary project files are supported"));
            }
            let name = entry.path().map_err(|e| invalid(e.to_string()))?.to_string_lossy().into_owned();
            insert(&mut files, &name, entry, &mut total)?;
        }
    }
    Ok(files)
}
pub fn content<'a>(files: &'a Files, name: &str) -> Result<Option<std::borrow::Cow<'a, [u8]>>, ParseError> {
    if let Some(bytes) = files.get(name) {
        return Ok(Some(std::borrow::Cow::Borrowed(bytes)));
    }
    if let Some(bytes) = files.get(&format!("{name}.gz")) {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&bytes[..])
            .take((128 * 1024 * 1024 + 1) as u64)
            .read_to_end(&mut out)
            .map_err(|e| invalid(e.to_string()))?;
        if out.len() > 128 * 1024 * 1024 {
            return Err(ParseError::TooLarge);
        }
        return Ok(Some(std::borrow::Cow::Owned(out)));
    }
    Ok(None)
}
#[derive(Debug, Clone, Serialize)]
pub struct ProjectMember {
    pub id: String,
    pub name: String,
    pub format: &'static str,
}
pub fn members(files: &Files) -> Vec<ProjectMember> {
    let mut out = Vec::new();
    for name in files.keys() {
        if name.to_ascii_lowercase().ends_with(".epcb") {
            let mut label = name.rsplit('/').next().unwrap_or(name).to_owned();
            if let Some((prefix, _)) = name.rsplit_once("PCB/") {
                if let Some(json) = files.get(&format!("{prefix}project.json")) {
                    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(json) {
                        let id = label.trim_end_matches(".epcb");
                        if let Some(title) = value["pcbs"][id].as_str() {
                            label = title.to_owned();
                        }
                    }
                }
            }
            out.push(ProjectMember { id: name.clone(), name: label, format: "EasyEDA Pro" });
        }
        let plain = name.trim_end_matches(".gz");
        if plain.ends_with("/eda/data") && plain.contains("/steps/")
            || plain.starts_with("steps/") && plain.ends_with("/eda/data")
        {
            let id = plain.trim_end_matches("/eda/data").to_owned();
            let label = id.rsplit('/').next().unwrap_or(&id).to_owned();
            out.push(ProjectMember { id, name: label, format: "ODB++" });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    out
}
pub fn parse_member(files: &Files, id: Option<&str>) -> Result<Board, ParseError> {
    let list = members(files);
    let chosen = match id {
        Some(id) => {
            list.iter().find(|b| b.id == id).ok_or_else(|| invalid("Board is not in this project"))?
        }
        None if list.len() == 1 => &list[0],
        None if list.is_empty() => {
            return Err(invalid("No assembly board found; ODB++ needs EDA data and component placement"))
        }
        None => {
            return Err(invalid(
                "This project contains multiple boards; choose a board in Avero's open dialog",
            ))
        }
    };
    let raw = if chosen.format == "EasyEDA Pro" {
        crate::formats::easyeda::parse(files, &chosen.id)?
    } else {
        crate::formats::odb::parse(files, &chosen.id)?
    };
    crate::finish(raw)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_paths_cannot_escape_or_duplicate() {
        assert!(path("../../board").is_err());
        assert!(path("C:/board").is_err());
        assert_eq!(path("./job/steps/a").unwrap(), "job/steps/a");
        let mut f = Files::new();
        let mut total = 0;
        insert(&mut f, "board", &b"a"[..], &mut total).unwrap();
        assert!(insert(&mut f, "board", &b"b"[..], &mut total).is_err());
    }
    #[test]
    fn multiple_boards_require_a_choice() {
        let f = Files::from([("PCB/a.epcb".into(), vec![]), ("PCB/b.epcb".into(), vec![])]);
        assert_eq!(members(&f).len(), 2);
        assert!(parse_member(&f, None).unwrap_err().to_string().contains("multiple"));
    }
}
