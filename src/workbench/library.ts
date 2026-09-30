import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

// Mirrors src-tauri/src/library.rs.
export interface LibraryFile {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export interface LibraryEntry {
  key: string;
  title: string;
  folder: string;
  root: string;
  boards: LibraryFile[];
  schematics: LibraryFile[];
  unsupported: LibraryFile[];
}

export interface LibraryScan {
  entries: LibraryEntry[];
  files: number;
  truncated: boolean;
  missing: string[];
}

export interface LibraryState {
  folders: string[];
  scan: LibraryScan | null;
  scannedAt: string | null;
}

const KEY = "avero.library.v1";

export function loadLibrary(): LibraryState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<LibraryState>;
      return { folders: Array.isArray(d.folders) ? d.folders : [], scan: d.scan ?? null, scannedAt: d.scannedAt ?? null };
    }
  } catch {
    // Storage unavailable: start empty.
  }
  return { folders: [], scan: null, scannedAt: null };
}

export function saveLibrary(state: LibraryState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export interface ImportResult {
  imported: string[];
  duplicates: number;
  skipped: number;
  errors: string[];
}

/** Avero's own library folder (~/Documents/Avero/Bibliothek). */
export function libraryRoot(): Promise<string> {
  return invoke<string>("library_root");
}

/** Copies files, folders or ZIP archives into the library. */
export function importFiles(paths: string[], folder: string): Promise<ImportResult> {
  return invoke<ImportResult>("import_files", { paths, folder: folder.trim() || null });
}

export async function pickImport(title: string, extensions: string[]): Promise<string[]> {
  const picked = await open({
    title,
    multiple: true,
    directory: false,
    filters: [{ name: "Boardview / PDF / ZIP", extensions: [...extensions, "pdf", "zip", "fz", "tvw"] }],
  });
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
}

export function revealInFinder(path: string): Promise<void> {
  return revealItemInDir(path);
}

export function scanLibrary(folders: string[]): Promise<LibraryScan> {
  return invoke<LibraryScan>("scan_library", { folders });
}

export async function pickFolder(title: string): Promise<string | undefined> {
  const picked = await open({ title, directory: true, multiple: false });
  return typeof picked === "string" ? picked : undefined;
}

/**
 * Entries matching every word of the query in the title, folder path or any
 * file name, e.g. `iphone 13 pdf` or `820-02`.
 */
export function filterEntries(entries: LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((e) => {
    const hay = [e.title, e.folder, ...[...e.boards, ...e.schematics, ...e.unsupported].map((f) => f.name)].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Short format badge for a file name: BRD, PDF, PCB … */
export function badge(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return name.toLowerCase() === "pins.asc" ? "ASC" : ext.toUpperCase();
}
