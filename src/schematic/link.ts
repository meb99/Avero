import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The schematic can move into its own window (second monitor). Both windows
 * run this app; they talk through Tauri events:
 *
 *   schematic window → main: `ready` once listening, `pick` with a clicked name
 *   main → schematic window: `doc` (what to show), `focus` (board selection)
 *   Rust → main: `closed` when the schematic window is gone
 */
export const SCHEMATIC_WINDOW = "schematic";

export const LINK = {
  ready: "schematic:ready",
  doc: "schematic:doc",
  focus: "schematic:focus",
  pick: "schematic:pick",
  closed: "schematic:closed",
} as const;

/** The document the schematic window should show. */
export interface LinkedDoc {
  name: string;
  /** File on disk, read through the backend. */
  path?: string;
  /** Bundled file (the demo schematic). */
  url?: string;
  /** Upper-case part and net names of the board, to underline clickable words. */
  parts: string[];
  nets: string[];
}

/** True in the separate schematic window. */
export function isSchematicWindow(): boolean {
  try {
    return getCurrentWindow().label === SCHEMATIC_WINDOW;
  } catch {
    // Outside Tauri (browser preview) there is only one window.
    return false;
  }
}

export const openSchematicWindow = (title: string) => invoke<void>("open_schematic_window", { title });
export const closeSchematicWindow = () => invoke<void>("close_schematic_window");
