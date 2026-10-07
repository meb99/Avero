/**
 * One board as a portable package: its notes (readings, cases, references,
 * matches, drawings, own entries), the photos they use, the camera
 * calibration and, on request, the board file and its PDFs. Opened on
 * another Mac it needs none of the paths of the first one.
 */
import { invoke } from "@tauri-apps/api/core";
import { schematicsFor } from "../core/loader";
import { loadCalibration, saveCalibration, type CameraCalibration } from "./cameraOverlay";
import { boardKey, legacyBoardKey, mergeNotes, parseNotes, type BoardNotes } from "./notes";
import { newProjectId, type DeviceProject } from "./project";
import { loadNotes } from "./store";

export const PACKAGE_EXTENSION = "averopkg";

/** Every photo file the notes use: board photos, case photos and those of its work steps, photos of notes. */
export function photosOf(notes: BoardNotes): string[] {
  const out = new Set<string>();
  for (const side of ["top", "bottom"] as const) {
    const f = notes.photos?.[side]?.file;
    if (f) out.add(f);
  }
  for (const c of notes.cases) {
    for (const p of c.photos ?? []) out.add(p);
    for (const s of c.steps ?? []) for (const p of s.photos ?? []) out.add(p);
  }
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

/** A board's part of an opened package: its notes saved for where the board lies now. */
async function takeUnpacked(u: Unpacked): Promise<Opened> {
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

type AnyUnpacked =
  | ({ kind: "board" } & Unpacked)
  | { kind: "device"; name: string; project: string; folder: string; boards: { id: string; unpacked: Unpacked }[] };

export type OpenedAny =
  | ({ kind: "board" } & Opened)
  | {
      kind: "device";
      /** The device project, its boards where they lie now, under a new id. */
      project: DeviceProject;
      boards: (Opened & { id: string })[];
    };

/**
 * Opens a package: photos and files into this Mac's folders, the notes
 * saved for the board (joined with any already there, nothing dropped), the
 * camera calibration put back. A device package does so for each of its
 * boards and gives back its project with the boards where they lie now.
 */
export async function openPackage(path: string): Promise<OpenedAny> {
  const u = await invoke<AnyUnpacked>("package_open_any", { path });
  if (u.kind === "board") return { kind: "board", ...(await takeUnpacked(u)) };
  const boards: (Opened & { id: string })[] = [];
  for (const b of u.boards) boards.push({ id: b.id, ...(await takeUnpacked(b.unpacked)) });
  const project = JSON.parse(u.project) as DeviceProject;
  const pathOf = new Map(boards.map((b) => [b.id, b.board]));
  return {
    kind: "device",
    project: { ...project, id: newProjectId(), boards: project.boards.map((b) => ({ ...b, path: pathOf.get(b.id) ?? b.path })) },
    boards,
  };
}

/**
 * Packs a device: its project, and every board with its notes (the saved
 * ones; a board not open is read from its notes file), photos, camera
 * alignment and – with `originals` – its board file and PDFs (those open
 * with it, else the schematic found next to it).
 */
export async function exportDevicePackage(out: string, project: DeviceProject, docsOf: (path: string) => string[] | undefined, originals: boolean): Promise<PackResult> {
  const boards = [];
  for (const b of project.boards) {
    const source = { name: b.path.split(/[\\/]/).pop() ?? b.path, path: b.path };
    const { notes } = await loadNotes(boardKey(source), legacyBoardKey(source), source.name);
    const docs = docsOf(b.path) ?? (originals ? (await schematicsFor(b.path).catch(() => [] as string[])).slice(0, 1) : []);
    const camera = loadCalibration(notes.key);
    boards.push({
      id: b.id,
      request: {
        key: notes.key,
        name: `${project.name} – ${b.name}`,
        notes: JSON.stringify(notes),
        board: b.path,
        docs,
        photos: photosOf(notes),
        originals,
        extra: camera ? { camera } : {},
      },
    });
  }
  return invoke<PackResult>("device_package_create", {
    path: out,
    created: new Date().toISOString(),
    request: { name: project.name, project: JSON.stringify(project), boards },
  });
}
