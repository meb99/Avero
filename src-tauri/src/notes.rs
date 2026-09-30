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

#[cfg(test)]
mod tests {
    use super::*;

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
