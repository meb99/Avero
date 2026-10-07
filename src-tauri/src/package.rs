//! One board as a portable package (`.averopkg`, a ZIP): its notes (readings,
//! cases, references, matches, drawings), the photos they use, and on
//! request the board file and its PDFs. Paths of the Mac it was made on are
//! not needed to open it: photos are referred to inside the package and put
//! back into the photo folder of the Mac it is opened on, board and PDFs go
//! into the library under a name of their own.
//!
//! A device of several boards (see the device projects of the UI) packs as
//! one file too: its project (boards and the connectors between them) and,
//! for every board, a package of its own as above.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;

const MANIFEST: &str = "avero-package.json";
const NOTES: &str = "notes.json";
/// How a photo is referred to inside the package.
const PHOTO_REF: &str = "pkg:photos/";

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackedFile {
    pub name: String,
    /// Inside the package; none when the original was left out.
    pub file: Option<String>,
    /// Where it was on the Mac it was packed on (for the user's information only).
    pub original: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub app: String,
    pub created: String,
    /// The board's notes key.
    pub key: String,
    pub name: String,
    pub board: Option<PackedFile>,
    pub docs: Vec<PackedFile>,
    pub photos: usize,
    /// Attachments that were asked for but not found when packing.
    pub missing: Vec<String>,
    /// What the UI keeps besides the notes (camera calibration, view), as it handed it over.
    #[serde(default)]
    pub extra: serde_json::Value,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackRequest {
    pub key: String,
    pub name: String,
    pub notes: String,
    pub board: Option<String>,
    pub docs: Vec<String>,
    pub photos: Vec<String>,
    /// Put board file and PDFs in the package.
    pub originals: bool,
    #[serde(default)]
    pub extra: serde_json::Value,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackResult {
    pub files: usize,
    pub bytes: u64,
    pub missing: Vec<String>,
}

fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into())
}

/// A name not taken yet among `taken` ("photo.jpg", "photo (2).jpg" …).
fn unique(name: &str, taken: &mut std::collections::HashSet<String>) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut candidate = name.to_string();
    let mut n = 2;
    while !taken.insert(candidate.to_lowercase()) {
        candidate = format!("{stem} ({n}){ext}");
        n += 1;
    }
    candidate
}

/// Replaces a path as it appears in JSON text (quoted and escaped).
fn replace_json_string(text: &str, from: &str, to: &str) -> String {
    let (Ok(a), Ok(b)) = (serde_json::to_string(from), serde_json::to_string(to)) else {
        return text.to_string();
    };
    text.replace(&a, &b)
}

pub fn create(out: &Path, req: &PackRequest, app: &str, created: &str) -> Result<PackResult, String> {
    let tmp = out.with_extension("averopkg.part");
    let file = File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let stored =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
    let packed =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    let mut result = PackResult::default();
    let mut add =
        |zip: &mut zip::ZipWriter<File>, name: &str, source: &str, options| -> Result<bool, String> {
            let mut buf = Vec::new();
            match File::open(source).and_then(|mut f| f.read_to_end(&mut buf)) {
                Ok(_) => {
                    zip.start_file(name, options).map_err(|e| e.to_string())?;
                    zip.write_all(&buf).map_err(|e| e.to_string())?;
                    result.files += 1;
                    result.bytes += buf.len() as u64;
                    Ok(true)
                }
                Err(_) => Ok(false),
            }
        };

    let mut missing = Vec::new();
    // Photos, referred to by their name in the package.
    let mut notes = req.notes.clone();
    let mut photo_names = std::collections::HashSet::new();
    let mut photos = 0;
    for path in &req.photos {
        let name = unique(&file_name(path), &mut photo_names);
        if add(&mut zip, &format!("photos/{name}"), path, stored)? {
            notes = replace_json_string(&notes, path, &format!("{PHOTO_REF}{name}"));
            photos += 1;
        } else {
            missing.push(path.clone());
        }
    }

    let mut taken = std::collections::HashSet::new();
    let mut original =
        |zip: &mut zip::ZipWriter<File>, folder: &str, path: &str| -> Result<PackedFile, String> {
            let name = file_name(path);
            if !req.originals {
                return Ok(PackedFile { name, file: None, original: path.to_string() });
            }
            let inside = format!("{folder}/{}", unique(&name, &mut taken));
            if add(zip, &inside, path, stored)? {
                Ok(PackedFile { name, file: Some(inside), original: path.to_string() })
            } else {
                missing.push(path.to_string());
                Ok(PackedFile { name, file: None, original: path.to_string() })
            }
        };
    let board = req.board.as_deref().map(|p| original(&mut zip, "board", p)).transpose()?;
    let docs = req.docs.iter().map(|p| original(&mut zip, "docs", p)).collect::<Result<Vec<_>, _>>()?;

    zip.start_file(NOTES, packed).map_err(|e| e.to_string())?;
    zip.write_all(notes.as_bytes()).map_err(|e| e.to_string())?;
    let manifest = Manifest {
        version: 1,
        app: app.to_string(),
        created: created.to_string(),
        key: req.key.clone(),
        name: req.name.clone(),
        board,
        docs,
        photos,
        missing: missing.clone(),
        extra: req.extra.clone(),
    };
    zip.start_file(MANIFEST, packed).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, out).map_err(|e| format!("{}: {e}", out.display()))?;
    result.missing = missing;
    Ok(result)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Unpacked {
    pub manifest: Manifest,
    /// The notes with photo paths of this Mac.
    pub notes: String,
    pub board: Option<String>,
    pub docs: Vec<String>,
    /// The library folder the files went to.
    pub folder: Option<String>,
}

/// A file name from the package, only when it is a plain name in one of its folders.
fn inside<'a>(entry: &'a str, folder: &str) -> Option<&'a str> {
    let rest = entry.strip_prefix(folder)?.strip_prefix('/')?;
    let plain =
        !rest.is_empty() && !rest.contains('/') && !rest.contains('\\') && rest != "." && rest != "..";
    plain.then_some(rest)
}

/// A folder in `parent` named `name`, or "name (2)" … when it is taken.
fn free_folder(parent: &Path, name: &str) -> PathBuf {
    let clean: String = name.chars().map(|c| if "/\\:".contains(c) { '-' } else { c }).collect();
    let clean = if clean.trim().is_empty() { "Paket".to_string() } else { clean.trim().to_string() };
    let mut dir = parent.join(&clean);
    let mut n = 2;
    while dir.exists() {
        dir = parent.join(format!("{clean} ({n})"));
        n += 1;
    }
    dir
}

/// Opens a package: photos into `photos_dir`, board and PDFs into a folder of their own in `library_dir`.
pub fn open(path: &Path, library_dir: &Path, photos_dir: &Path, stamp: u128) -> Result<Unpacked, String> {
    open_into(path, &library_dir.join("Pakete"), photos_dir, stamp)
}

/// As `open`, with the board's folder made in `packages_dir`.
fn open_into(path: &Path, packages_dir: &Path, photos_dir: &Path, stamp: u128) -> Result<Unpacked, String> {
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("not an Avero package: {e}"))?;
    let read = |zip: &mut zip::ZipArchive<File>, name: &str| -> Result<Vec<u8>, String> {
        let mut f = zip.by_name(name).map_err(|_| format!("not an Avero package ({name} missing)"))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    };
    let manifest: Manifest =
        serde_json::from_slice(&read(&mut zip, MANIFEST)?).map_err(|e| format!("package manifest: {e}"))?;
    if manifest.version != 1 {
        return Err(format!("package version {} is newer than this Avero", manifest.version));
    }
    let mut notes = String::from_utf8(read(&mut zip, NOTES)?).map_err(|e| e.to_string())?;

    std::fs::create_dir_all(photos_dir).map_err(|e| e.to_string())?;
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    for entry in names.iter().filter_map(|n| inside(n, "photos")) {
        let target = photos_dir.join(format!("pkg-{stamp}-{entry}"));
        let data = read(&mut zip, &format!("photos/{entry}"))?;
        std::fs::write(&target, data).map_err(|e| format!("{}: {e}", target.display()))?;
        notes = replace_json_string(&notes, &format!("{PHOTO_REF}{entry}"), &target.to_string_lossy());
    }

    let has_files = manifest.board.as_ref().is_some_and(|b| b.file.is_some())
        || manifest.docs.iter().any(|d| d.file.is_some());
    let folder = has_files.then(|| free_folder(packages_dir, &manifest.name));
    let place =
        |zip: &mut zip::ZipArchive<File>, f: &PackedFile, dir: &str| -> Result<Option<String>, String> {
            let (Some(inner), Some(folder)) = (&f.file, &folder) else { return Ok(None) };
            let Some(plain) = inside(inner, dir) else { return Ok(None) };
            std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
            let target = folder.join(plain);
            std::fs::write(&target, read(zip, inner)?).map_err(|e| format!("{}: {e}", target.display()))?;
            Ok(Some(target.to_string_lossy().into_owned()))
        };
    let board = match &manifest.board {
        Some(b) => place(&mut zip, b, "board")?,
        None => None,
    };
    let mut docs = Vec::new();
    for d in &manifest.docs {
        if let Some(p) = place(&mut zip, d, "docs")? {
            docs.push(p);
        }
    }
    Ok(Unpacked { notes, board, docs, folder: folder.map(|f| f.to_string_lossy().into_owned()), manifest })
}

const DEVICE_MANIFEST: &str = "avero-device.json";

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceBoardRequest {
    /// The board's id in the project.
    pub id: String,
    pub request: PackRequest,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRequest {
    pub name: String,
    /// The device project as the UI keeps it (boards, connectors), as JSON.
    pub project: String,
    pub boards: Vec<DeviceBoardRequest>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceManifest {
    pub version: u32,
    pub app: String,
    pub created: String,
    pub name: String,
    pub project: String,
    /// Board id in the project → its package inside.
    pub boards: Vec<DeviceBoardEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceBoardEntry {
    pub id: String,
    pub name: String,
    pub file: String,
    pub missing: Vec<String>,
}

/// Packs a device: the project, and every board as a package of its own inside.
pub fn create_device(
    out: &Path,
    req: &DeviceRequest,
    app: &str,
    created: &str,
) -> Result<PackResult, String> {
    let tmp = out.with_extension("averopkg.part");
    let file = File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let stored =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
    let mut result = PackResult::default();
    let mut entries = Vec::new();
    for (i, b) in req.boards.iter().enumerate() {
        let inner = out.with_extension(format!("board{i}.part"));
        let r = create(&inner, &b.request, app, created);
        let data =
            r.as_ref().map_err(String::clone).and_then(|_| std::fs::read(&inner).map_err(|e| e.to_string()));
        let _ = std::fs::remove_file(&inner);
        let (r, data) = (r?, data?);
        let name = format!("boards/{i}.averopkg");
        zip.start_file(&name, stored).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
        result.files += r.files;
        result.bytes += r.bytes;
        result.missing.extend(r.missing.iter().cloned());
        entries.push(DeviceBoardEntry {
            id: b.id.clone(),
            name: b.request.name.clone(),
            file: name,
            missing: r.missing,
        });
    }
    let manifest = DeviceManifest {
        version: 1,
        app: app.to_string(),
        created: created.to_string(),
        name: req.name.clone(),
        project: req.project.clone(),
        boards: entries,
    };
    let packed =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    zip.start_file(DEVICE_MANIFEST, packed).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, out).map_err(|e| format!("{}: {e}", out.display()))?;
    Ok(result)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnpackedDeviceBoard {
    pub id: String,
    pub unpacked: Unpacked,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Opened {
    Board(Box<Unpacked>),
    Device { name: String, project: String, folder: String, boards: Vec<UnpackedDeviceBoard> },
}

/// Opens a board package or a device package. A device's boards go into one
/// folder of the device in the library, each in a folder of its own.
pub fn open_any(path: &Path, library_dir: &Path, photos_dir: &Path, stamp: u128) -> Result<Opened, String> {
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("not an Avero package: {e}"))?;
    let manifest: DeviceManifest = match zip.by_name(DEVICE_MANIFEST) {
        Err(_) => return open(path, library_dir, photos_dir, stamp).map(|u| Opened::Board(Box::new(u))),
        Ok(mut f) => {
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            serde_json::from_slice(&buf).map_err(|e| format!("device manifest: {e}"))?
        }
    };
    if manifest.version != 1 {
        return Err(format!("package version {} is newer than this Avero", manifest.version));
    }
    let device_dir = free_folder(&library_dir.join("Pakete"), &manifest.name);
    let mut boards = Vec::new();
    for (i, entry) in manifest.boards.iter().enumerate() {
        if inside(&entry.file, "boards").is_none() {
            return Err(format!("device package: unexpected entry {}", entry.file));
        }
        let mut data = Vec::new();
        zip.by_name(&entry.file)
            .map_err(|_| format!("device package: {} missing", entry.file))?
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        let inner = std::env::temp_dir().join(format!("avero-device-{stamp}-{i}.averopkg"));
        std::fs::write(&inner, data).map_err(|e| e.to_string())?;
        let opened = open_into(&inner, &device_dir, photos_dir, stamp + i as u128);
        let _ = std::fs::remove_file(&inner);
        boards.push(UnpackedDeviceBoard { id: entry.id.clone(), unpacked: opened? });
    }
    Ok(Opened::Device {
        name: manifest.name,
        project: manifest.project,
        folder: device_dir.to_string_lossy().into_owned(),
        boards,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("avero-pkg-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn packs_and_opens_without_the_old_paths() {
        let home = tmp("home");
        let board = home.join("PS5 EDM-010.brd");
        let pdf = home.join("schematic.pdf");
        let photo = home.join("photos/1700000000000-top.jpg");
        std::fs::create_dir_all(photo.parent().unwrap()).unwrap();
        std::fs::write(&board, b"BRDOUT").unwrap();
        std::fs::write(&pdf, b"%PDF-1.4").unwrap();
        std::fs::write(&photo, b"JPEG").unwrap();
        let photo_path = photo.to_string_lossy().into_owned();
        let notes = format!(
            r#"{{"version":1,"key":"EDM-010","photos":{{"top":{{"file":{}}}}}}}"#,
            serde_json::to_string(&photo_path).unwrap()
        );
        let out = home.join("ps5.averopkg");
        let req = PackRequest {
            key: "EDM-010".into(),
            name: "PS5 EDM-010".into(),
            notes,
            board: Some(board.to_string_lossy().into_owned()),
            docs: vec![
                pdf.to_string_lossy().into_owned(),
                home.join("gone.pdf").to_string_lossy().into_owned(),
            ],
            photos: vec![photo_path.clone()],
            originals: true,
            extra: serde_json::json!({ "camera": { "side": "top" } }),
        };
        let r = create(&out, &req, "0.9.26", "now").unwrap();
        assert_eq!(r.missing.len(), 1, "the missing PDF is named");

        // Another Mac: other folders.
        let there = tmp("there");
        let opened = open(&out, &there.join("library"), &there.join("photos"), 7).unwrap();
        assert!(!opened.notes.contains(&photo_path), "no path of the old Mac left");
        let new_photo = there.join("photos/pkg-7-1700000000000-top.jpg");
        assert!(opened.notes.contains(new_photo.to_string_lossy().as_ref()));
        assert_eq!(std::fs::read(&new_photo).unwrap(), b"JPEG");
        let b = opened.board.unwrap();
        assert!(b.starts_with(there.join("library/Pakete/PS5 EDM-010").to_string_lossy().as_ref()));
        assert_eq!(std::fs::read(&b).unwrap(), b"BRDOUT");
        assert_eq!(opened.docs.len(), 1);
        assert_eq!(opened.manifest.extra["camera"]["side"], "top");

        // Opened twice: a folder of its own, nothing overwritten.
        let again = open(&out, &there.join("library"), &there.join("photos"), 8).unwrap();
        assert!(again.folder.unwrap().ends_with("PS5 EDM-010 (2)"));
    }

    #[test]
    fn packs_and_opens_a_device_of_two_boards() {
        let home = tmp("device-home");
        let main = home.join("820-02016.brd");
        let io = home.join("820-02017.brd");
        let photo = home.join("io-top.jpg");
        std::fs::write(&main, b"MAIN").unwrap();
        std::fs::write(&io, b"IO").unwrap();
        std::fs::write(&photo, b"JPEG").unwrap();
        let photo_path = photo.to_string_lossy().into_owned();
        let board = |key: &str, name: &str, path: &Path, photos: Vec<String>| DeviceBoardRequest {
            id: key.to_lowercase(),
            request: PackRequest {
                key: key.into(),
                name: name.into(),
                notes: format!(
                    r#"{{"version":1,"key":"{key}","photo":{}}}"#,
                    serde_json::to_string(&photo_path).unwrap()
                ),
                board: Some(path.to_string_lossy().into_owned()),
                docs: vec![],
                photos,
                originals: true,
                extra: serde_json::Value::Null,
            },
        };
        let req = DeviceRequest {
            name: "MacBook A2338".into(),
            project: r#"{"id":"p1","name":"MacBook A2338","boards":[],"links":[]}"#.into(),
            boards: vec![
                board("820-02016", "Hauptplatine", &main, vec![]),
                board("820-02017", "IO-Platine", &io, vec![photo_path.clone()]),
            ],
        };
        let out = home.join("device.averopkg");
        let r = create_device(&out, &req, "0.9.30", "now").unwrap();
        assert!(r.missing.is_empty());
        let there = tmp("device-there");
        let Opened::Device { name, project, folder, boards } =
            open_any(&out, &there.join("library"), &there.join("photos"), 5).unwrap()
        else {
            panic!("a device")
        };
        assert_eq!(name, "MacBook A2338");
        assert!(project.contains("\"links\""));
        assert!(folder.ends_with("Pakete/MacBook A2338"));
        assert_eq!(boards.len(), 2);
        assert_eq!(boards[0].id, "820-02016");
        let b0 = boards[0].unpacked.board.clone().unwrap();
        let b1 = boards[1].unpacked.board.clone().unwrap();
        assert!(b0.starts_with(&folder) && b1.starts_with(&folder));
        assert_eq!(std::fs::read(&b0).unwrap(), b"MAIN");
        assert_eq!(std::fs::read(&b1).unwrap(), b"IO");
        assert!(!boards[1].unpacked.notes.contains(&photo_path), "no path of the old Mac left");
        // A single board package still opens as one.
        let single = home.join("single.averopkg");
        create(&single, &req.boards[0].request, "0.9.30", "now").unwrap();
        assert!(matches!(
            open_any(&single, &there.join("library"), &there.join("photos"), 9).unwrap(),
            Opened::Board(_)
        ));
    }

    #[test]
    fn only_plain_names_come_out() {
        assert_eq!(inside("photos/a.jpg", "photos"), Some("a.jpg"));
        assert_eq!(inside("photos/../../etc/passwd", "photos"), None);
        assert_eq!(inside("photos/sub/a.jpg", "photos"), None);
        assert_eq!(inside("photos/..", "photos"), None);
        assert_eq!(inside("board/x.brd", "photos"), None);
    }
}
