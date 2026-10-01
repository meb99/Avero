//! Files that are in the library more than once with exactly the same
//! content, whatever their names.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use serde::Serialize;

use crate::library::LibraryFile;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub size: u64,
    /// Oldest first: the copy one would usually keep.
    pub files: Vec<LibraryFile>,
}

const CHUNK: usize = 1 << 20;

/// Bytes hashed from the start and the end of a file to pick candidates.
const SAMPLE: u64 = 64 * 1024;

/// FNV-1a over the first and last 64 KB: only sorts candidates into
/// buckets; equal files are confirmed byte for byte afterwards.
fn content_hash(path: &Path, size: u64) -> Option<u64> {
    use std::io::{Seek, SeekFrom};
    let mut file = File::open(path).ok()?;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for &b in bytes {
            hash ^= u64::from(b);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    };
    let mut buf = vec![0u8; SAMPLE as usize];
    let n = read_full(&mut file, &mut buf).ok()?;
    feed(&buf[..n]);
    if size > 2 * SAMPLE {
        file.seek(SeekFrom::End(-(SAMPLE as i64))).ok()?;
        let n = read_full(&mut file, &mut buf).ok()?;
        feed(&buf[..n]);
    }
    Some(hash)
}

/// Byte-for-byte comparison, so a hash collision never counts as a duplicate.
fn same_bytes(a: &Path, b: &Path) -> bool {
    let (Ok(fa), Ok(fb)) = (File::open(a), File::open(b)) else { return false };
    let (mut ra, mut rb) = (BufReader::with_capacity(CHUNK, fa), BufReader::with_capacity(CHUNK, fb));
    let (mut ba, mut bb) = (vec![0u8; CHUNK], vec![0u8; CHUNK]);
    loop {
        let Ok(na) = read_full(&mut ra, &mut ba) else { return false };
        let Ok(nb) = read_full(&mut rb, &mut bb) else { return false };
        if na != nb || ba[..na] != bb[..nb] {
            return false;
        }
        if na == 0 {
            return true;
        }
    }
}

fn read_full(r: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        let n = r.read(&mut buf[filled..])?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    Ok(filled)
}

/// Groups of identical files, largest first. Only files of equal size are
/// read at all.
pub fn find(files: Vec<LibraryFile>) -> Vec<DuplicateGroup> {
    // A folder linked twice (or inside the own library) lists its files twice.
    let mut seen = HashSet::new();
    let mut by_size: HashMap<u64, Vec<LibraryFile>> = HashMap::new();
    for f in files.into_iter().filter(|f| f.size > 0 && seen.insert(f.path.clone())) {
        by_size.entry(f.size).or_default().push(f);
    }
    let mut groups = Vec::new();
    for (size, same_size) in by_size {
        if same_size.len() < 2 {
            continue;
        }
        let mut by_hash: HashMap<u64, Vec<LibraryFile>> = HashMap::new();
        for f in same_size {
            if let Some(h) = content_hash(Path::new(&f.path), size) {
                by_hash.entry(h).or_default().push(f);
            }
        }
        for (_, mut candidates) in by_hash {
            // Split into sets of truly equal files.
            while candidates.len() >= 2 {
                let first = candidates.remove(0);
                let (equal, rest): (Vec<_>, Vec<_>) = candidates
                    .into_iter()
                    .partition(|f| same_bytes(Path::new(&first.path), Path::new(&f.path)));
                candidates = rest;
                if !equal.is_empty() {
                    let mut files = vec![first];
                    files.extend(equal);
                    files.sort_by(|a, b| a.modified.cmp(&b.modified).then_with(|| a.path.cmp(&b.path)));
                    groups.push(DuplicateGroup { size, files });
                }
            }
        }
    }
    groups.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.files[0].path.cmp(&b.files[0].path)));
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(dir: &Path, name: &str, data: &[u8]) -> LibraryFile {
        let path = dir.join(name);
        std::fs::write(&path, data).unwrap();
        LibraryFile {
            path: path.to_string_lossy().into_owned(),
            name: name.into(),
            size: data.len() as u64,
            modified: 0,
        }
    }

    #[test]
    fn groups_identical_files_only() {
        let dir = std::env::temp_dir().join(format!("avero-dupes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let files = vec![
            file(&dir, "a.brd", b"board one"),
            file(&dir, "a (2).brd", b"board one"),
            file(&dir, "copy.brd", b"board one"),
            // Same size, different content.
            file(&dir, "b.brd", b"board two"),
            file(&dir, "c.pdf", b"other"),
        ];
        let groups = find(files);
        assert_eq!(groups.len(), 1);
        let mut names: Vec<_> = groups[0].files.iter().map(|f| f.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["a (2).brd", "a.brd", "copy.brd"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn compares_files_larger_than_one_chunk() {
        let dir = std::env::temp_dir().join(format!("avero-dupes-big-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let big: Vec<u8> = (0..CHUNK * 2 + 17).map(|i| (i % 251) as u8).collect();
        let mut other = big.clone();
        *other.last_mut().unwrap() ^= 1;
        let a = file(&dir, "a.pdf", &big);
        let b = file(&dir, "b.pdf", &big);
        let c = file(&dir, "c.pdf", &other);
        assert!(same_bytes(Path::new(&a.path), Path::new(&b.path)));
        assert!(!same_bytes(Path::new(&a.path), Path::new(&c.path)));
        assert_eq!(find(vec![a.clone(), b, c]).len(), 1);
        // The same path listed twice is not a duplicate of itself.
        assert!(find(vec![a.clone(), a]).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
