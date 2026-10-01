import type { Language } from "./i18n";

export interface Settings {
  /** Bumped when a default changes for everyone, see loadSettings. */
  revision?: number;
  language: Language | "auto";
  theme: "system" | "dark" | "light";
  units: "mm" | "mil";
  /** What two-finger scrolling / the mouse wheel does. Pinching always zooms. */
  scroll: "zoom" | "pan";
  ghostOtherSide: boolean;
  dimUnselected: boolean;
  showVias: boolean;
  /** Copper tracks, for formats that have them. */
  showTraces: boolean;
  partNames: boolean;
  pinNumbers: boolean;
  netNames: boolean;
  /** Connection lines between the pins of the highlighted net. */
  ratsnest: boolean;
  /** Look for a new release on GitHub once a day. */
  updateCheck: boolean;
  autoSchematic: boolean;
  showSidebar: boolean;
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
  dimUnselected: true,
  showVias: false,
  showTraces: true,
  partNames: true,
  pinNumbers: true,
  netNames: true,
  ratsnest: true,
  updateCheck: true,
  autoSchematic: true,
  showSidebar: true,
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
    if (raw) return migrate({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
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
