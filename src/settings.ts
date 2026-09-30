import type { Language } from "./i18n";

export interface Settings {
  language: Language | "auto";
  theme: "system" | "dark" | "light";
  units: "mm" | "mil";
  /** What two-finger scrolling / the mouse wheel does. Pinching always zooms. */
  scroll: "zoom" | "pan";
  ghostOtherSide: boolean;
  dimUnselected: boolean;
  showVias: boolean;
  partNames: boolean;
  pinNumbers: boolean;
  netNames: boolean;
  autoSchematic: boolean;
  showSidebar: boolean;
  /** Width of the schematic panel as a share of the space next to the sidebar. */
  schematicShare: number;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "auto",
  theme: "system",
  units: "mm",
  scroll: "pan",
  ghostOtherSide: true,
  dimUnselected: true,
  showVias: false,
  partNames: true,
  pinNumbers: true,
  netNames: true,
  autoSchematic: true,
  showSidebar: true,
  schematicShare: 0.5,
};

const KEY = "avero.settings.v1";
const RECENT_KEY = "avero.recent.v1";
const MAX_RECENT = 10;

// Storage can be unavailable (private windows, locked-down webviews);
// settings then simply do not persist.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
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
