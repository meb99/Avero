import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { Board, LoadError, LoadResult } from "./types";

/** Where a board came from, for the title bar and recent files. */
export interface BoardSource {
  name: string;
  path?: string;
}

export interface Loaded {
  result: LoadResult;
  source: BoardSource;
}

/** Extensions offered in the open dialog. Keep in sync with avero_formats::formats::SUPPORTED. */
export const BOARD_EXTENSIONS = ["brd", "bdv", "asc", "bvr", "bvr3", "cad", "gcd", "gencad", "cst", "pcb"];

async function load(command: string, args: Record<string, unknown>): Promise<LoadResult> {
  try {
    return { ok: true, board: await invoke<Board>(command, args) };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e) return { ok: false, error: e as LoadError };
    return { ok: false, error: { code: "io", message: String(e) } };
  }
}

/** Parses a file natively in Rust (which also resolves ASC companion files). */
export async function loadPath(path: string, xzzKey?: string): Promise<Loaded> {
  const name = path.split("/").pop() ?? path;
  return { result: await load("open_board", { path, xzzKey: xzzKey || null }), source: { name, path } };
}

export async function loadDemo(): Promise<Loaded> {
  return { result: await load("open_demo", {}), source: { name: "Avero Demo" } };
}

/** Native open panel. Resolves to `undefined` when cancelled. */
export async function pickPath(title: string, kind: "any" | "pdf"): Promise<string | undefined> {
  const filters =
    kind === "pdf"
      ? [{ name: "PDF", extensions: ["pdf"] }]
      : [
          { name: "Boardview / PDF", extensions: [...BOARD_EXTENSIONS, "pdf"] },
          { name: "Boardview", extensions: BOARD_EXTENSIONS },
          { name: "PDF", extensions: ["pdf"] },
        ];
  const picked = await open({ title, multiple: false, directory: false, filters });
  return typeof picked === "string" ? picked : undefined;
}

/** Raw bytes of a file, transferred as binary. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }));
}

/** Schematic PDFs in the board's folder, best match first. */
export function schematicsFor(boardPath: string): Promise<string[]> {
  return invoke<string[]>("schematics_for", { boardPath });
}

/** Files dropped onto the window. */
export function onFileDrop(handler: (paths: string[]) => void, hover: (over: boolean) => void): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") hover(true);
    else if (p.type === "leave") hover(false);
    else if (p.type === "drop") {
      hover(false);
      handler(p.paths);
    }
  });
}

/**
 * Files opened from Finder ("Open With", double-click, drop on the Dock
 * icon). Paths that arrived before the UI was ready are delivered first.
 */
export async function onFinderOpen(handler: (paths: string[]) => void): Promise<() => void> {
  const unlisten = await listen<string[]>("open-paths", (e) => handler(e.payload));
  const pending = await invoke<string[]>("take_pending_paths");
  if (pending.length > 0) handler(pending);
  return unlisten;
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  await getCurrentWindow().setTitle(title);
}
