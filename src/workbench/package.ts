/**
 * One board as a portable package: its notes (readings, cases, references,
 * matches, drawings, own entries), the photos they use, the camera
 * calibration and, on request, the board file and its PDFs. Opened on
 * another Mac it needs none of the paths of the first one.
 */
import { invoke } from "@tauri-apps/api/core";
import { loadCalibration, saveCalibration, type CameraCalibration } from "./cameraOverlay";
import { boardKey, mergeNotes, parseNotes, type BoardNotes } from "./notes";

export const PACKAGE_EXTENSION = "averopkg";

/** Every photo file the notes use: board photos, case photos, photos of notes. */
export function photosOf(notes: BoardNotes): string[] {
  const out = new Set<string>();
  for (const side of ["top", "bottom"] as const) {
    const f = notes.photos?.[side]?.file;
    if (f) out.add(f);
  }
  for (const c of notes.cases) for (const p of c.photos ?? []) out.add(p);
  for (const m of notes.markers ?? []) for (const p of m.photos ?? []) out.add(p);
  return [...out];
}

export interface PackResult {
  files: number;
  bytes: number;
  missing: string[];
}

export async function exportPackage(
  out: string,
  notes: BoardNotes,
  name: string,
  board: string | undefined,
  docs: string[],
  originals: boolean,
): Promise<PackResult> {
  const camera = loadCalibration(notes.key);
  return invoke<PackResult>("package_create", {
    path: out,
    created: new Date().toISOString(),
    request: {
      key: notes.key,
      name,
      notes: JSON.stringify(notes),
      board: board ?? null,
      docs,
      photos: photosOf(notes),
      originals,
      extra: camera ? { camera } : {},
    },
  });
}

interface Unpacked {
  manifest: { key: string; name: string; missing: string[]; extra?: { camera?: CameraCalibration }; board: { name: string; file: string | null } | null };
  notes: string;
  board: string | null;
  docs: string[];
  folder: string | null;
}

export interface Opened {
  name: string;
  board?: string;
  docs: string[];
  /** The board's notes were joined with notes already there. */
  merged: boolean;
  /** Board file left out of the package: notes kept under its key for when it is opened. */
  noBoard: boolean;
}

/**
 * Opens a package: photos and files into this Mac's folders, the notes
 * saved for the board (joined with any already there, nothing dropped), the
 * camera calibration put back.
 */
export async function openPackage(path: string): Promise<Opened> {
  const u = await invoke<Unpacked>("package_open", { path });
  const theirs = parseNotes(u.notes);
  if (!theirs) throw new Error("the package's notes cannot be read");
  // The key the board gets where it lies now (a new folder may give it another one).
  const key = u.board ? boardKey({ name: u.board.split(/[\\/]/).pop() ?? u.board, path: u.board }) : u.manifest.key;
  const incoming: BoardNotes = { ...theirs, key };
  const existing = parseNotes((await invoke<string | null>("load_notes", { key }).catch(() => null)) ?? "");
  const notes = existing ? mergeNotes(existing, incoming) : incoming;
  await invoke("save_notes", { key, data: JSON.stringify(notes, null, 2) });
  const camera = u.manifest.extra?.camera;
  if (camera && !loadCalibration(key)) saveCalibration(key, camera);
  return { name: u.manifest.name, ...(u.board && { board: u.board }), docs: u.docs, merged: !!existing, noBoard: !u.board };
}
