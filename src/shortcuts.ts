/**
 * Keys for the bench: what to press to save a reading and go to the next
 * point, flip the board and so on, changeable in the settings. A foot pedal
 * shows up on the Mac as a keyboard, so its key is bound here like any other.
 */

export type ShortcutAction =
  | "nextPoint"
  | "commitNext"
  | "flip"
  | "bothSides"
  | "fit"
  | "zoomIn"
  | "zoomOut"
  | "pinNet"
  | "marker"
  | "rotate"
  | "back"
  | "forward"
  | "bookmark"
  | "nextPin"
  | "prevPin";

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  "nextPoint",
  "commitNext",
  "flip",
  "bothSides",
  "fit",
  "zoomIn",
  "zoomOut",
  "pinNet",
  "marker",
  "rotate",
  "back",
  "forward",
  "bookmark",
  "nextPin",
  "prevPin",
];

/** Key names as `keyName` gives them; several keys may share an action. */
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  nextPoint: ["n"],
  commitNext: ["F13"],
  flip: ["Space"],
  bothSides: ["b"],
  fit: ["f", "Home"],
  zoomIn: ["+", "="],
  zoomOut: ["-", "_"],
  pinNet: ["p"],
  marker: ["m"],
  rotate: ["r"],
  // ⌘[ / ⌘] as in Finder and browsers; ⌥← / ⌥→ for keyboards where [ needs ⌥.
  // (On a German layout [ is ⌥5, so ⌘⌥5 arrives as Cmd+Alt+[.)
  back: ["Cmd+[", "Cmd+Alt+[", "Alt+ArrowLeft"],
  forward: ["Cmd+]", "Cmd+Alt+]", "Alt+ArrowRight"],
  bookmark: ["Cmd+d"],
  // Probing a chip pin by pin.
  nextPin: ["."],
  prevPin: [","],
};

export type Shortcuts = Partial<Record<ShortcutAction, string[]>>;

interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * A key as stored: printable keys as the character they type ("n", "+"),
 * others by name ("PageDown", "F13", "Space"), with modifiers in front
 * where they matter ("Alt+F5"; Shift only for keys that are no characters).
 */
export function keyName(e: KeyLike): string {
  const base = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const printable = e.key.length === 1;
  const mods = [e.ctrlKey && "Ctrl", e.metaKey && "Cmd", e.altKey && "Alt", e.shiftKey && !printable && "Shift"].filter(Boolean);
  return [...mods, base].join("+");
}

/** Keys a pedal or remote typically sends: they work even while typing in a value field. */
export function worksWhileTyping(name: string): boolean {
  return /^(F(1[3-9]|2[0-4])|PageUp|PageDown|Media\w*|Audio\w*|Launch\w*)$/.test(name.replace(/^(\w+\+)*/, ""));
}

/** Modifier keys alone are no shortcut. */
export function isModifierOnly(e: KeyLike): boolean {
  return ["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"].includes(e.key);
}

export function bindings(custom: Shortcuts | undefined): Record<ShortcutAction, string[]> {
  return { ...DEFAULT_SHORTCUTS, ...custom };
}

export function actionFor(all: Record<ShortcutAction, string[]>, name: string): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find((a) => all[a].includes(name));
}

/** Binds `name` to `action` alone and takes it away from any other action. */
export function rebind(custom: Shortcuts | undefined, action: ShortcutAction, name: string): Shortcuts {
  const all = bindings(custom);
  const out: Shortcuts = { ...custom };
  for (const a of SHORTCUT_ACTIONS) if (a !== action && all[a].includes(name)) out[a] = all[a].filter((k) => k !== name);
  out[action] = [name];
  return out;
}

/** "⌥F5", "Leertaste", "Bild ↓" for display. */
export function keyLabel(name: string, lang: string): string {
  const de = lang.startsWith("de");
  const words: Record<string, string> = {
    Space: de ? "Leertaste" : "Space",
    PageDown: de ? "Bild ↓" : "Page Down",
    PageUp: de ? "Bild ↑" : "Page Up",
    Home: de ? "Pos1" : "Home",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
  };
  return name
    .split("+")
    .map((p) => ({ Ctrl: "⌃", Cmd: "⌘", Alt: "⌥", Shift: "⇧" })[p] ?? words[p] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join("");
}
