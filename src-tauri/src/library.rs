//! The board library: boardview files and schematics found in the user's
//! folders, grouped into one entry per board.
//!
//! Files are grouped when they share a board number (`820-02100`,
//! `nm-b481`), taken from the file name or, for generic names like
//! `pins.asc` or `schematic.pdf`, from the folder name. A lone board file in
//! a folder also collects the folder's PDFs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::id_tokens;

const MAX_FILES: usize = 100_000;
const MAX_DEPTH: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Board,
    Schematic,
    Unsupported,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Seconds since the Unix epoch.
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub key: String,
    pub title: String,
    /// Folder of the entry relative to its library root, `/`-separated.
    pub folder: String,
    pub root: String,
    pub boards: Vec<LibraryFile>,
    pub schematics: Vec<LibraryFile>,
    /// Boardview formats Avero recognizes but cannot read yet.
    pub unsupported: Vec<LibraryFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScan {
    pub entries: Vec<LibraryEntry>,
    pub files: usize,
    /// True when the file limit was reached and the scan stopped early.
    pub truncated: bool,
    /// Library folders that do not exist (anymore).
    pub missing: Vec<String>,
}

/// True for `.pcb` files that are XinZhiZao boardviews; other EDA tools use
/// the extension too.
pub(crate) fn is_xzz_head(head: &[u8]) -> bool {
    matches!(
        avero_formats::detect(head, None),
        avero_formats::Detected::Supported(avero_formats::FormatId::Xzz)
    )
}

fn read_head(path: &Path) -> Vec<u8> {
    use std::io::Read;
    let mut head = vec![0u8; 0x20];
    let n = std::fs::File::open(path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    head.truncate(n);
    head
}

/// What a file is, by name; `.pcb` files are checked by content.
fn classify(name: &str, head: impl FnOnce() -> Vec<u8>) -> Option<Kind> {
    let name = name.to_ascii_lowercase();
    let ext = name.rsplit_once('.')?.1;
    match ext {
        "pdf" => Some(Kind::Schematic),
        // An ASC board is three files; pins.asc stands for the set.
        "asc" => (name == "pins.asc").then_some(Kind::Board),
        "pcb" => is_xzz_head(&head()).then_some(Kind::Board),
        "tvw" => Some(Kind::Unsupported),
        // Altium saves text ("PCB ASCII") or an OLE compound file under the same name.
        "pcbdoc" => {
            Some(if head().starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) { Kind::Unsupported } else { Kind::Board })
        }
        _ if avero_formats::formats::extensions().contains(&ext) => Some(Kind::Board),
        _ => None,
    }
}

/// Files worth copying into the library: everything [`classify`] knows plus
/// the companion files of ASC sets.
pub(crate) fn is_importable(name: &str, head: impl FnOnce() -> Vec<u8>) -> bool {
    name.to_ascii_lowercase().ends_with(".asc") || classify(name, head).is_some()
}

fn kind_of(path: &Path) -> Option<Kind> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    classify(&name, || read_head(path))
}

struct Found {
    root: usize,
    dir: PathBuf,
    kind: Kind,
    file: LibraryFile,
    tokens: Vec<String>,
}

fn walk(root: &Path, dir: &Path, depth: usize, root_index: usize, out: &mut Vec<Found>) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return true };
    for entry in entries.filter_map(Result::ok) {
        if out.len() >= MAX_FILES {
            return false;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let path = entry.path();
        if ft.is_dir() {
            if depth < MAX_DEPTH && !walk(root, &path, depth + 1, root_index, out) {
                return false;
            }
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let Some(kind) = kind_of(&path) else { continue };
        let meta = entry.metadata().ok();
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let mut tokens = id_tokens(&stem);
        if tokens.is_empty() {
            let folder = dir.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
            tokens = id_tokens(&folder);
        }
        out.push(Found {
            root: root_index,
            dir: dir.strip_prefix(root).unwrap_or(dir).to_path_buf(),
            kind,
            file: LibraryFile {
                path: path.to_string_lossy().into_owned(),
                name,
                size: meta.as_ref().map_or(0, std::fs::Metadata::len),
                modified: meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs()),
            },
            tokens,
        });
    }
    true
}

/// Minimal union-find for grouping files.
struct Groups(Vec<usize>);

impl Groups {
    fn find(&mut self, i: usize) -> usize {
        let parent = self.0[i];
        if parent == i {
            return i;
        }
        let root = self.find(parent);
        self.0[i] = root;
        root
    }

    fn join(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.0[b] = a;
        }
    }
}

/// Every board, schematic and unsupported boardview file under `roots`.
pub fn files(roots: &[PathBuf]) -> Vec<LibraryFile> {
    let mut found = Vec::new();
    for (i, root) in roots.iter().enumerate() {
        if root.is_dir() && !walk(root, root, 0, i, &mut found) {
            break;
        }
    }
    found.into_iter().map(|f| f.file).collect()
}

pub fn scan(roots: &[PathBuf]) -> LibraryScan {
    let mut found = Vec::new();
    let mut missing = Vec::new();
    let mut truncated = false;
    for (i, root) in roots.iter().enumerate() {
        if !root.is_dir() {
            missing.push(root.to_string_lossy().into_owned());
            continue;
        }
        if !walk(root, root, 0, i, &mut found) {
            truncated = true;
            break;
        }
    }

    let mut groups = Groups((0..found.len()).collect());
    let mut by_token: HashMap<(usize, &str), usize> = HashMap::new();
    let mut by_stem: HashMap<(usize, &Path, String), usize> = HashMap::new();
    let mut boards_in_dir: HashMap<(usize, &Path), Vec<usize>> = HashMap::new();
    for (i, f) in found.iter().enumerate() {
        for t in &f.tokens {
            match by_token.get(&(f.root, t.as_str())) {
                Some(&j) => groups.join(j, i),
                None => {
                    by_token.insert((f.root, t.as_str()), i);
                }
            }
        }
        let stem = f.file.name.rsplit_once('.').map_or(f.file.name.as_str(), |(s, _)| s).to_lowercase();
        match by_stem.get(&(f.root, f.dir.as_path(), stem.clone())) {
            Some(&j) => groups.join(j, i),
            None => {
                by_stem.insert((f.root, f.dir.as_path(), stem), i);
            }
        }
        if f.kind == Kind::Board {
            boards_in_dir.entry((f.root, f.dir.as_path())).or_default().push(i);
        }
    }
    // A folder with exactly one board: its otherwise unmatched PDFs belong to it.
    for (i, f) in found.iter().enumerate() {
        if f.kind == Kind::Schematic && f.tokens.is_empty() {
            if let Some([board]) = boards_in_dir.get(&(f.root, f.dir.as_path())).map(Vec::as_slice) {
                groups.join(*board, i);
            }
        }
    }

    let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..found.len() {
        let g = groups.find(i);
        members.entry(g).or_default().push(i);
    }

    let mut entries: Vec<LibraryEntry> = members
        .into_values()
        .map(|mut idx| {
            idx.sort_by(|&a, &b| found[a].file.name.cmp(&found[b].file.name));
            let pick = |kind: Kind| -> Vec<LibraryFile> {
                idx.iter().filter(|&&i| found[i].kind == kind).map(|&i| found[i].file.clone()).collect()
            };
            // Title: the board number if there is one, else the first file name.
            let lead = idx
                .iter()
                .copied()
                .min_by_key(|&i| (found[i].kind != Kind::Board, found[i].tokens.is_empty()))
                .unwrap_or(idx[0]);
            let title = found[lead].tokens.first().map(|t| t.to_uppercase()).unwrap_or_else(|| {
                let name = &found[lead].file.name;
                name.rsplit_once('.').map_or(name.as_str(), |(s, _)| s).to_string()
            });
            let first = &found[lead];
            LibraryEntry {
                key: format!("{}:{}", first.root, first.file.path),
                title,
                folder: first.dir.to_string_lossy().replace('\\', "/"),
                root: roots[first.root].to_string_lossy().into_owned(),
                boards: pick(Kind::Board),
                schematics: pick(Kind::Schematic),
                unsupported: pick(Kind::Unsupported),
            }
        })
        .collect();
    entries.sort_by(|a, b| {
        (a.root.as_str(), a.folder.to_lowercase(), a.title.to_lowercase()).cmp(&(
            b.root.as_str(),
            b.folder.to_lowercase(),
            b.title.to_lowercase(),
        ))
    });

    LibraryScan { entries, files: found.len(), truncated, missing }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn altium_text_boards_are_boards_and_binary_ones_are_named() {
        let text = || b"|RECORD=Board|KIND=Protel_Advanced_PCB|".to_vec();
        assert_eq!(classify("Main.PcbDoc", text), Some(Kind::Board));
        let ole = || vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1];
        assert_eq!(classify("Main.PcbDoc", ole), Some(Kind::Unsupported));
    }

    fn tree(files: &[&str]) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "avero-lib-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        for f in files {
            let p = root.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, b"x").unwrap();
        }
        root
    }

    fn names(files: &[LibraryFile]) -> Vec<&str> {
        files.iter().map(|f| f.name.as_str()).collect()
    }

    #[test]
    fn groups_by_board_number_and_folder() {
        let root = tree(&[
            "Apple/iPhone 13 Pro/820-02100.brd",
            "Apple/iPhone 13 Pro/820-02100.fz",
            "Apple/iPhone 13 Pro/820-02100.tvw",
            "Apple/Schematics/J413 820-02100 schematic.pdf",
            "Lenovo/X1C6 NM-B481/pins.asc",
            "Lenovo/X1C6 NM-B481/format.asc",
            "Lenovo/X1C6 NM-B481/Schematic.PDF",
            "Misc/board.bdv",
            "Misc/notes.pdf",
            "Misc/readme.txt",
            ".hidden/secret.brd",
        ]);
        let scan = scan(std::slice::from_ref(&root));
        assert!(!scan.truncated);
        assert_eq!(scan.files, 8);

        let by_title: HashMap<&str, &LibraryEntry> =
            scan.entries.iter().map(|e| (e.title.as_str(), e)).collect();
        let apple = by_title["820-02100"];
        assert_eq!(names(&apple.boards), ["820-02100.brd", "820-02100.fz"]);
        assert_eq!(names(&apple.unsupported), ["820-02100.tvw"]);
        assert_eq!(names(&apple.schematics), ["J413 820-02100 schematic.pdf"]);
        assert_eq!(apple.folder, "Apple/iPhone 13 Pro");

        let lenovo = by_title["NM-B481"];
        assert_eq!(names(&lenovo.boards), ["pins.asc"]);
        assert_eq!(names(&lenovo.schematics), ["Schematic.PDF"]);

        // One board in the folder: the PDF next to it is its schematic.
        let misc = by_title["board"];
        assert_eq!(names(&misc.schematics), ["notes.pdf"]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn reports_missing_roots() {
        let scan = scan(&[PathBuf::from("/definitely/not/a/library")]);
        assert_eq!(scan.missing.len(), 1);
        assert!(scan.entries.is_empty());
    }
}
