import type { Language } from "./i18n";
import type { MeterSettings } from "./workbench/meter";
import type { OwnColors } from "./render/palette";
import type { Shortcuts } from "./shortcuts";

export interface Settings {
  /** Bumped when a default changes for everyone, see loadSettings. */
  revision?: number;
  language: Language | "auto";
  theme: "system" | "dark" | "light";
  units: "mm" | "mil";
  /** What two-finger scrolling / the mouse wheel does. Pinching always zooms. */
  scroll: "zoom" | "pan";
  ghostOtherSide: boolean;
  /** Top and bottom side at once, the bottom mirrored beside the top. */
  bothSides: boolean;
  /** Both sides in one view, or in two views side by side (zoomed on their own or in step). */
  bothSidesMode: "together" | "separate" | "synced";
  dimUnselected: boolean;
  showVias: boolean;
  /** Copper tracks, for formats that have them. */
  showTraces: boolean;
  partNames: boolean;
  pinNumbers: boolean;
  netNames: boolean;
  /** Connection lines between the pins of the highlighted net. */
  ratsnest: boolean;
  /** Small map of the whole board in a corner while zoomed in. */
  overview: boolean;
  /** Look for a new release on GitHub once a day. */
  updateCheck: boolean;
  autoSchematic: boolean;
  /** Reopen the boards, schematics and window of the last session on start. */
  restoreWorkspace: boolean;
  /** Points picked to align a board photo (2, 3 or 4; 4 for photos at an angle). */
  photoPoints: 2 | 3 | 4;
  /** Own board colours per theme (the colour editor). */
  colors?: { dark?: OwnColors; light?: OwnColors };
  /** Multimeter on a USB serial port; none until set up. */
  meter?: MeterSettings;
  /** Own key bindings over the defaults (see shortcuts.ts). */
  shortcuts: Shortcuts;
  showSidebar: boolean;
  /** Sidebar width in CSS pixels, dragged at its left edge. */
  sidebarWidth: number;
  /** Sidebar folded to a narrow strip of tabs. */
  sidebarCollapsed: boolean;
  /** Width of the schematic panel as a share of the space next to the sidebar. */
  schematicShare: number;
  /** Allowed relative deviation from reference readings (0.1 = 10 %). */
  tolerance: number;
  /** DES key for XinZhiZao .pcb files, as typed (hex). */
  xzzKey: string;
  /** Key for encrypted ASUS .fz files: 44 hex words, as typed. */
  fzKey: string;
}

/** Current settings revision. 2: sides are kept apart (no ghosting) by default. */
const REVISION = 2;

export const DEFAULT_SETTINGS: Settings = {
  revision: REVISION,
  language: "auto",
  theme: "system",
  units: "mm",
  scroll: "pan",
  ghostOtherSide: false,
  bothSides: false,
  bothSidesMode: "together",
  dimUnselected: true,
  showVias: false,
  showTraces: true,
  partNames: true,
  pinNumbers: true,
  netNames: true,
  ratsnest: true,
  overview: true,
  updateCheck: true,
  autoSchematic: true,
  restoreWorkspace: true,
  photoPoints: 2,
  shortcuts: {},
  showSidebar: true,
  sidebarWidth: 340,
  sidebarCollapsed: false,
  schematicShare: 0.5,
  tolerance: 0.1,
  xzzKey: "",
  fzKey: "",
};

const KEY = "avero.settings.v1";
const RECENT_KEY = "avero.recent.v1";
const MAX_RECENT = 10;

// Storage can be unavailable (private windows, locked-down webviews);
// settings then simply do not persist.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return fromStored(JSON.parse(raw) as Partial<Settings>);
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

/**
 * Settings as stored, completed with defaults. The stored revision (none for
 * settings older than revisions) decides the migrations, not the default's.
 */
export function fromStored(stored: Partial<Settings>): Settings {
  return migrate({ ...DEFAULT_SETTINGS, ...stored, revision: stored.revision });
}

/** Applies default changes to settings saved by older versions. */
export function migrate(s: Settings): Settings {
  const out = { ...s };
  if ((out.revision ?? 1) < 2) out.ghostOtherSide = false;
  out.revision = REVISION;
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** Recently opened file paths (desktop app only). */
export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecent(path: string): string[] {
  const list = [path, ...loadRecent().filter((p) => p !== path)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
  return list;
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}
