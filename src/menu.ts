import { Menu, type MenuItemOptions, type PredefinedMenuItemOptions, type SubmenuOptions } from "@tauri-apps/api/menu";
import { command, shortcutOf, type CommandActions } from "./commands";
import type { Translate } from "./i18n";
import type { Shortcuts } from "./shortcuts";

/** Everything the menu bar can trigger (see the command register). */
export type MenuActions = CommandActions;

type Item = MenuItemOptions | SubmenuOptions | PredefinedMenuItemOptions;

const SEP: PredefinedMenuItemOptions = { item: "Separator" };

/**
 * True once the native menu is installed. Its key equivalents then handle
 * their ⌘ shortcuts, so the web view must not handle those a second time.
 */
export let nativeMenuActive = false;

/**
 * Key equivalents of the native menu, as "shift alt ctrl:key". Each is kept
 * by physical key and by character: macOS matches the typed character, so
 * on a German keyboard ⌘Z is the key labelled Z. Owning a key too many only
 * leaves it to the menu; owning one too few would run it twice.
 */
const menuKeys = new Set<string>();

const ACCEL_CODES: Record<string, string> = { ",": "Comma", "-": "Minus", "/": "Slash", "=": "Equal" };

const keyId = (shift: boolean, alt: boolean, ctrl: boolean, key: string) => `${shift ? 1 : 0}${alt ? 1 : 0}${ctrl ? 1 : 0}:${key}`;

function remember(accelerator: string) {
  const parts = accelerator.split(/\+(?=.)/);
  const key = parts[parts.length - 1];
  const code = ACCEL_CODES[key] ?? (/^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);
  const [shift, alt, ctrl] = ["Shift", "Alt", "Ctrl"].map((m) => parts.includes(m));
  menuKeys.add(keyId(shift, alt, ctrl, code));
  menuKeys.add(keyId(shift, alt, ctrl, key.toLowerCase()));
}

// Key equivalents of the predefined items (Edit, Window, app menu).
for (const a of ["X", "C", "V", "A", "Q", "H", "Alt+H", "M", "Ctrl+F"]) remember(a);

/**
 * A ⌘ key the native menu handles itself. Every other ⌘ key (⌘[, ⌘D, a
 * custom bench key …) reaches only the web view, which must then act on it.
 */
export function menuOwnsKey(e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  if (!nativeMenuActive || !e.metaKey) return false;
  return menuKeys.has(keyId(e.shiftKey, e.altKey, e.ctrlKey, e.code)) || menuKeys.has(keyId(e.shiftKey, e.altKey, e.ctrlKey, e.key.toLowerCase()));
}


/**
 * Builds the macOS menu bar. Actions go through `actions()` so the menu
 * always calls the current handlers without being rebuilt on every render.
 */
export async function installMenu(
  t: Translate,
  actions: () => MenuActions,
  recent: string[],
  version: string,
  layouts: { presets: string[]; own: string[] } = { presets: [], own: [] },
  shortcuts?: Shortcuts,
  lang = "en",
): Promise<void> {
  const item = (id: string, text: string, run: (a: MenuActions) => void, accelerator?: string): MenuItemOptions => {
    if (accelerator) remember(accelerator.replace("CmdOrCtrl+", ""));
    return { id, text, accelerator, action: () => run(actions()) };
  };
  /** A command of the register: its text (with the key where the menu cannot take it), key equivalent and action. */
  const cmd = (id: string): MenuItemOptions => {
    const c = command(id);
    const label = c.menuLabel?.(t) ?? c.label(t, { lang } as Parameters<typeof c.label>[1]);
    const key = c.menuKey ? shortcutOf(c, shortcuts, lang) : undefined;
    return item(c.menuId ?? c.id, key ? `${label}  ${key}` : label, (a) => c.run(a), c.accelerator);
  };

  const recentItems: Item[] = recent.length
    ? [
        ...recent.map((path, i) => item(`recent-${i}`, path.split("/").pop() ?? path, (a) => a.openRecent(path))),
        SEP,
        item("recent-clear", t("menu.clearRecent"), (a) => a.clearRecent()),
      ]
    : [{ id: "recent-none", text: "—", enabled: false }];

  const items: Item[] = [
    {
      text: "Avero",
      items: [
        {
          item: {
            About: {
              name: "Avero",
              version,
              copyright: "© 2026 meb99 · MIT",
              comments: t("app.tagline"),
            },
          },
        },
        SEP,
        cmd("updates"),
        cmd("settings"),
        SEP,
        { item: "Services" },
        SEP,
        { item: "Hide" },
        { item: "HideOthers" },
        { item: "ShowAll" },
        SEP,
        // Not the predefined item: unsaved readings are written before the app ends.
        cmd("quit"),
      ],
    },
    {
      text: t("menu.file"),
      items: [
        cmd("new-tab"),
        cmd("open"),
        { text: t("menu.recent"), items: recentItems },
        SEP,
        cmd("library"),
        cmd("import"),
        cmd("project"),
        cmd("package-export"),
        SEP,
        cmd("export"),
        cmd("export-pdf"),
        {
          text: t("menu.exportCsv"),
          items: [
            cmd("csv-parts"),
            cmd("csv-nets"),
            cmd("csv-readings"),
            cmd("csv-annotations"),
          ],
        },
        SEP,
        cmd("close"),
      ],
    },
    {
      text: t("menu.edit"),
      items: [
        cmd("undo"),
        cmd("redo"),
        SEP,
        { item: "Cut" },
        { item: "Copy" },
        { item: "Paste" },
        { item: "SelectAll" },
        SEP,
        cmd("search"),
        cmd("schematic-search"),
        cmd("palette"),
      ],
    },
    {
      text: t("menu.view"),
      items: [
        cmd("flip"),
        cmd("rotate"),
        cmd("rotate-back"),
        SEP,
        cmd("fit"),
        cmd("zoom-in"),
        cmd("zoom-out"),
        SEP,
        cmd("ratsnest"),
        cmd("grid"),
        cmd("mechanical"),
        cmd("schematic"),
        cmd("schematic-window"),
        cmd("sidebar"),
        SEP,
        cmd("photo-add"),
        cmd("photo-toggle"),
        cmd("compare"),
        SEP,
        cmd("nav-back"),
        cmd("nav-forward"),
        cmd("bookmark-add"),
        cmd("ruler"),
        SEP,
        { item: "Fullscreen" },
      ],
    },
    {
      text: t("menu.window"),
      items: [
        { item: "Minimize" },
        { item: "Maximize" },
        SEP,
        cmd("next-tab"),
        cmd("prev-tab"),
        SEP,
        {
          text: t("layout.menu"),
          items: [
            ...layouts.presets.map((id) => item(`layout-${id}`, t(`layout.${id}` as Parameters<Translate>[0]), (a) => a.layout(`preset:${id}`))),
            ...(layouts.own.length ? [SEP, ...layouts.own.map((name, i) => item(`layout-own-${i}`, name, (a) => a.layout(`own:${name}`)))] : []),
            SEP,
            cmd("layout-save"),
          ],
        },
        SEP,
        { item: "BringAllToFront" },
      ],
    },
    {
      text: t("menu.help"),
      items: [
        cmd("shortcuts"),
        cmd("website"),
      ],
    },
  ];

  const menu = await Menu.new({ items });
  const previous = await menu.setAsAppMenu();
  nativeMenuActive = true;
  // The menu is rebuilt when the language or the recent files change.
  await previous?.close();
}
