/**
 * The system Avero runs on. macOS and Windows get the same app; what differs is how
 * keys and places are named (⌘F and Finder on the Mac, Strg+F and Explorer on Windows)
 * and which key is the command key (⌘ or Strg). Everything else is shared.
 */
export type Platform = "mac" | "windows";

function detect(): Platform {
  if (typeof navigator === "undefined") return "mac";
  return /^Win/i.test(navigator.platform || "") || /Windows/i.test(navigator.userAgent || "") ? "windows" : "mac";
}

export const platform: Platform = detect();
export const isMac = platform === "mac";

/** The command key is down: ⌘ on the Mac, Strg on Windows. */
export const commandKey = (e: { metaKey: boolean; ctrlKey: boolean }, os: Platform = platform): boolean =>
  os === "mac" ? e.metaKey : e.ctrlKey;

const NAMES = {
  de: { ctrl: "Strg", alt: "Alt", shift: "Umschalt", tab: "Tab" },
  en: { ctrl: "Ctrl", alt: "Alt", shift: "Shift", tab: "Tab" },
};

/**
 * Mac key glyphs as Windows writes them: "⇧⌘E" → "Strg+Umschalt+E", "⌃⇥" → "Strg+Tab",
 * "⌘-Klick" → "Strg-Klick". The order is Windows' own: Strg, Alt, Umschalt.
 */
export function windowsKeys(text: string, lang: string): string {
  const n = lang.startsWith("de") ? NAMES.de : NAMES.en;
  return text
    .replace(/([⌃⌥⇧⌘]+)(⇥|[^\s\-/⌃⌥⇧⌘]|\/(?![A-Za-zÄÖÜäöü]))?/g, (_, mods: string, key?: string) => {
      const names = [
        (mods.includes("⌘") || mods.includes("⌃")) && n.ctrl,
        mods.includes("⌥") && n.alt,
        mods.includes("⇧") && n.shift,
      ].filter(Boolean);
      const k = key === "⇥" ? n.tab : key;
      return k ? [...names, k].join("+") : names.join("+");
    })
    .replace(/\b(Strg|Ctrl)\/\1\b/g, "$1");
}

/** Mac words for Windows: places, settings, the computer itself. */
const WORDS: [RegExp, string][] = [
  // The Mac's German name of the File menu.
  [/^Ablage$/, "Datei"],
  [/\bFinder\b/g, "Explorer"],
  [/\bSystemeinstellungen\b/g, "Einstellungen"],
  [/\bSystem Settings\b/g, "Settings"],
  [/Datenschutz & Sicherheit/g, "Datenschutz und Sicherheit"],
  [/Privacy & Security/g, "Privacy & security"],
  [/\bthe Trash\b/g, "the Recycle Bin"],
  [/\bTrash\b/g, "Recycle Bin"],
  [/\bMac\b/g, "PC"],
];

/** A text of the interface as it reads on Windows. */
export function forWindows(text: string, lang: string): string {
  let out = windowsKeys(text, lang);
  for (const [from, to] of WORDS) out = out.replace(from, to);
  return out;
}

/** A text as it reads on this system. */
export function forPlatform(text: string, lang: string, os: Platform = platform): string {
  return os === "windows" ? forWindows(text, lang) : text;
}
