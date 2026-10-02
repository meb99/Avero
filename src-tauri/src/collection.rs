//! Import the console collection without flattening its manufacturer/model
//! structure. Read one ZIP member at a time; convert XZZ before storing it.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Read;
use std::path::Path;

const PREFIX: &str = "Konsolen-Sammlung/";
const MANIFEST: &str = "Konsolen-Sammlung/QUELLEN_UND_DATEIEN.json";

#[derive(Deserialize)]
struct Manifest {
    files: Vec<Source>,
}

#[derive(Deserialize)]
struct Source {
    path: String,
    manufacturer: String,
    family: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionResult {
    pub imported: Vec<String>,
    pub duplicates: usize,
    pub boards: usize,
    pub schematics: usize,
    pub converted: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionProgress {
    pub completed: usize,
    pub total: usize,
    pub name: String,
}

fn safe_path(path: &str) -> bool {
    !path.contains(['\\', ':'])
        && !path.chars().any(char::is_control)
        && path.split('/').all(|part| !part.is_empty() && !part.starts_with('.'))
}

fn revision(path: &str, prefixes: &[&str]) -> Option<String> {
    path.split(|c: char| !c.is_ascii_alphanumeric() && c != '-')
        .find(|token| prefixes.iter().any(|prefix| token.to_ascii_uppercase().starts_with(prefix)))
        .map(str::to_ascii_uppercase)
}

/// Align with Brand › Family › Model in Avero's existing catalog. Preserve
/// revision names and mark reconstructed layouts in the model label.
fn folder(source: &Source) -> String {
    let path = source.path.to_ascii_lowercase();
    let (family, mut model) = match source.family.as_str() {
        "Xbox Original" => ("Xbox", "Original · Revision 1.6".into()),
        "Xbox 360" => {
            let revision = ["Corona", "Falcon", "Jasper", "Trinity", "Xenon", "Zephyr"]
                .into_iter()
                .find(|r| path.contains(&r.to_ascii_lowercase()));
            ("Xbox", revision.map_or_else(|| "360".into(), |r| format!("360 · {r}")))
        }
        "Xbox One Original" => ("Xbox", "One".into()),
        "Xbox One S" => ("Xbox", "One S".into()),
        "Xbox One X" => ("Xbox", "One X".into()),
        "Xbox Series S" => ("Xbox", "Series S".into()),
        "Xbox Series X" => ("Xbox", "Series X".into()),
        "PlayStation 1" => ("PlayStation", "1".into()),
        "PlayStation 2" => ("PlayStation", "2".into()),
        "PlayStation 3" => ("PlayStation", "3".into()),
        "PSP" => ("PSP", "2000".into()),
        "Switch Familie" => {
            let model = if path.contains("bee-cpu") {
                "2"
            } else if path.contains("heg-cpu") {
                "OLED"
            } else if path.contains("hdh-cpu") {
                "Lite"
            } else {
                "Original"
            };
            ("Switch", model.into())
        }
        "DS DS Lite DSi" => (
            "DS",
            if path.contains("twl") {
                "DSi"
            } else if path.contains("usg") {
                "DS Lite"
            } else {
                "DS"
            }
            .into(),
        ),
        "Game Boy Advance" => ("Game Boy", "Advance".into()),
        "Game Boy Color" => ("Game Boy", "Color".into()),
        "Game Boy Familie" => (
            "Game Boy",
            if path.contains("ags-") {
                "Advance SP"
            } else if path.contains("mgb-") {
                "Pocket"
            } else if path.contains("mgl-") {
                "Light"
            } else if path.contains("sgb-") {
                "Super Game Boy"
            } else {
                "Original"
            }
            .into(),
        ),
        "NES SNES" => {
            if path.contains("/snes/") {
                ("SNES", "Schaltpläne".into())
            } else {
                ("NES", "Schaltpläne".into())
            }
        }
        "Famicom" => ("NES", "Famicom".into()),
        "Nintendo 64" => ("N64", "NUS-CPU-03-04".into()),
        "Wii" => ("Wii", "Wee Wii · Rekonstruktion".into()),
        other => (other, "Schaltpläne".into()),
    };
    if let Some(rev) = revision(
        &source.path,
        &[
            "HAC-", "HAD-", "HEG-", "HDH-", "BEE-", "HVC-", "C-NTR-", "C-TWL-", "C-USG-", "SCPH-", "COK-",
            "SEM-", "TA-",
        ],
    ) {
        model.push_str(&format!(" · {rev}"));
    }
    if path.contains("reverse_engineering") {
        model.push_str(" · Rekonstruktion");
    }
    format!("{}/{family}/{model}", source.manufacturer)
}

fn supported(source: &Source) -> bool {
    let ext = Path::new(&source.path).extension().and_then(|e| e.to_str()).unwrap_or("");
    ["pdf", "cad", "pcb", "brd", "kicad_pcb"].iter().any(|known| ext.eq_ignore_ascii_case(known))
}

pub fn import_collection(
    root: &Path,
    path: &Path,
    key: Option<&str>,
    mut progress: impl FnMut(CollectionProgress),
) -> Result<CollectionResult, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let manifest: Manifest = {
        let mut entry = archive
            .by_name(MANIFEST)
            .map_err(|_| "Choose the console collection ZIP containing QUELLEN_UND_DATEIEN.json.")?;
        if entry.size() > 4 * 1024 * 1024 {
            return Err("Collection manifest is too large.".into());
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        serde_json::from_slice(&data).map_err(|e| format!("Invalid collection manifest: {e}"))?
    };
    if manifest.files.is_empty() || manifest.files.len() > 10_000 {
        return Err("Invalid collection file count.".into());
    }
    let mut seen = HashSet::new();
    let mut total_bytes = 0u64;
    for source in &manifest.files {
        if !safe_path(&source.path)
            || !seen.insert(&source.path)
            || !["Sony", "Nintendo", "Microsoft"].contains(&source.manufacturer.as_str())
            || !safe_path(&source.family)
            || source.sha256.len() != 64
            || !source.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(format!("Invalid collection entry: {}", source.path));
        }
        total_bytes = total_bytes.checked_add(source.bytes).ok_or("Collection is too large.")?;
        if total_bytes > 4 * 1024 * 1024 * 1024 {
            return Err("Collection is too large.".into());
        }
    }
    let canonical_oled = manifest
        .files
        .iter()
        .any(|s| s.path.to_ascii_lowercase().ends_with("switch oled-heg-cpu-01-pcb layer.pcb"));
    let selected: Vec<_> = manifest
        .files
        .iter()
        .filter(|s| {
            supported(s)
                && !(canonical_oled
                    && s.path.to_ascii_lowercase().contains("heg-cpu-01")
                    && ["no xor", "_decrypted"]
                        .iter()
                        .any(|suffix| s.path.to_ascii_lowercase().contains(suffix)))
        })
        .collect();
    let mut result =
        CollectionResult { skipped: manifest.files.len() - selected.len(), ..Default::default() };
    progress(CollectionProgress { completed: 0, total: selected.len(), name: String::new() });
    for (index, source) in selected.iter().enumerate() {
        let name = source.path.rsplit('/').next().unwrap_or(&source.path);
        let mut process = || -> Result<(String, bool, bool, bool), String> {
            let mut entry =
                archive.by_name(&format!("{PREFIX}{}", source.path)).map_err(|e| e.to_string())?;
            if entry.is_dir()
                || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
                || entry.size() != source.bytes
                || source.bytes > avero_formats::MAX_FILE_SIZE as u64
            {
                return Err("Invalid collection file size or type.".into());
            }
            let mut data = Vec::with_capacity(source.bytes as usize);
            (&mut entry).take(source.bytes + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
            if data.len() as u64 != source.bytes
                || format!("{:x}", Sha256::digest(&data)) != source.sha256.to_ascii_lowercase()
            {
                return Err("Collection file failed its checksum.".into());
            }
            let category = folder(source);
            let pcb = name.to_ascii_lowercase().ends_with(".pcb");
            let pdf = name.to_ascii_lowercase().ends_with(".pdf");
            if pcb {
                let stem =
                    Path::new(name).file_stem().and_then(|s| s.to_str()).ok_or("Invalid input name.")?;
                let converted = crate::conversion::convert_bytes(root, &data, stem, Some(&category), key)?;
                Ok((converted.path, converted.duplicate, false, true))
            } else {
                if !pdf {
                    avero_formats::parse(&data, Some(name)).map_err(|e| e.to_string())?;
                }
                let (stored, duplicate) =
                    crate::import::import_generated(root, name.into(), data, Some(&category))?;
                Ok((stored.to_string_lossy().into_owned(), duplicate, pdf, false))
            }
        };
        match process() {
            Ok((stored, duplicate, pdf, converted)) => {
                if duplicate {
                    result.duplicates += 1;
                } else {
                    result.imported.push(stored);
                }
                if pdf {
                    result.schematics += 1;
                } else {
                    result.boards += 1;
                }
                if converted {
                    result.converted += 1;
                }
            }
            Err(error) => result.errors.push(format!("{name}: {error}")),
        }
        progress(CollectionProgress { completed: index + 1, total: selected.len(), name: name.into() });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(
        name: &str,
        files: &[(&str, &[u8])],
        invalid_hash: bool,
    ) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "avero-collection-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("collection.zip");
        let mut archive = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        let sources: Vec<_> = files.iter().enumerate().map(|(i, (path, data))| serde_json::json!({
            "path": path, "manufacturer": "Microsoft", "family": "Xbox One S", "bytes": data.len(),
            "sha256": if invalid_hash && i == 0 { "0".repeat(64) } else { format!("{:x}", Sha256::digest(data)) },
        })).collect();
        archive.start_file(MANIFEST, options).unwrap();
        archive
            .write_all(serde_json::to_string(&serde_json::json!({ "files": sources })).unwrap().as_bytes())
            .unwrap();
        for (name, data) in files {
            archive.start_file(format!("{PREFIX}{name}"), options).unwrap();
            archive.write_all(data).unwrap();
        }
        archive.finish().unwrap();
        (dir, path)
    }

    #[test]
    fn imports_into_catalog_and_repeated_import_skips_even_renamed_files() {
        let (dir, zip) =
            fixture("repeat", &[("Microsoft/Xbox_One_S/Kingston.pdf", b"%PDF-1.7 schematic")], false);
        let root = dir.join("library");
        let mut events = Vec::new();
        let first = import_collection(&root, &zip, None, |event| events.push(event)).unwrap();
        assert!(first.errors.is_empty());
        assert_eq!(first.schematics, 1);
        let file = Path::new(&first.imported[0]);
        assert_eq!(file.parent().unwrap(), root.join("Microsoft/Xbox/One S"));
        std::fs::rename(file, file.with_file_name("User name.pdf")).unwrap();
        let second = import_collection(&root, &zip, None, |_| {}).unwrap();
        assert!(second.imported.is_empty());
        assert_eq!(second.duplicates, 1);
        assert_eq!(events.first().unwrap().completed, 0);
        assert_eq!(events.last().unwrap().completed, 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_traversal_before_importing_anything() {
        let (dir, zip) = fixture("traversal", &[("../escape.pdf", b"%PDF")], false);
        let root = dir.join("library");
        assert!(import_collection(&root, &zip, None, |_| {}).is_err());
        assert!(!root.exists());
        assert!(!dir.join("escape.pdf").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn damaged_file_does_not_stop_other_files_or_add_broken_output() {
        let (dir, zip) = fixture(
            "checksum",
            &[("Microsoft/Xbox_One_S/bad.pdf", b"%PDF bad"), ("Microsoft/Xbox_One_S/good.pdf", b"%PDF good")],
            true,
        );
        let root = dir.join("library");
        let result = import_collection(&root, &zip, None, |_| {}).unwrap();
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.imported.len(), 1);
        assert!(result.imported[0].ends_with("good.pdf"));
        assert!(!root.join("Microsoft/Xbox/One S/bad.pdf").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
