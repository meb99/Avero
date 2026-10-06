import { Menu, type MenuItemOptions, type PredefinedMenuItemOptions, type SubmenuOptions } from "@tauri-apps/api/menu";
import type { Translate } from "./i18n";

/** Everything the menu bar can trigger. */
export interface MenuActions {
  open(): void;
  openRecent(path: string): void;
  clearRecent(): void;
  library(): void;
  importToLibrary(): void;
  /** The device project of the open board (several boards joined by connectors). */
  project(): void;
  /** The open board with everything as one package. */
  exportPackage(): void;
  closeBoard(): void;
  newTab(): void;
  nextTab(): void;
  prevTab(): void;
  exportImage(): void;
  exportPdf(): void;
  exportCsv(what: "parts" | "nets" | "readings" | "annotations"): void;
  settings(): void;
  search(): void;
  searchSchematic(): void;
  palette(): void;
  /** Undo in the text field being edited, otherwise of the last change to readings and notes. */
  undo(): void;
  redo(): void;
  flip(): void;
  rotate(): void;
  rotateBack(): void;
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  toggleSchematic(): void;
  popOutSchematic(): void;
  toggleSidebar(): void;
  toggleRatsnest(): void;
  toggleGrid(): void;
  addPhoto(): void;
  togglePhoto(): void;
  compare(): void;
  back(): void;
  forward(): void;
  bookmark(): void;
  ruler(): void;
  shortcuts(): void;
  checkUpdates(): void;
  /** Saves what is unsaved, then quits. */
  quit(): void;
  /** A built-in layout ("preset:repair") or an own one ("own:Name"). */
  layout(id: string): void;
  saveLayout(): void;
  website(): void;
}

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
export async function installMenu(t: Translate, actions: () => MenuActions, recent: string[], version: string, layouts: { presets: string[]; own: string[] } = { presets: [], own: [] }): Promise<void> {
  const item = (id: string, text: string, run: (a: MenuActions) => void, accelerator?: string): MenuItemOptions => {
    if (accelerator) remember(accelerator.replace("CmdOrCtrl+", ""));
    return { id, text, accelerator, action: () => run(actions()) };
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
        item("check-updates", t("menu.checkUpdates"), (a) => a.checkUpdates()),
        item("settings", t("menu.settings"), (a) => a.settings(), "CmdOrCtrl+,"),
        SEP,
        { item: "Services" },
        SEP,
        { item: "Hide" },
        { item: "HideOthers" },
        { item: "ShowAll" },
        SEP,
        // Not the predefined item: unsaved readings are written before the app ends.
        item("quit", t("menu.quit"), (a) => a.quit(), "CmdOrCtrl+Q"),
      ],
    },
    {
      text: t("menu.file"),
      items: [
        item("new-tab", t("tabs.new"), (a) => a.newTab(), "CmdOrCtrl+T"),
        item("open", t("menu.open"), (a) => a.open(), "CmdOrCtrl+O"),
        { text: t("menu.recent"), items: recentItems },
        SEP,
        item("library", t("menu.library"), (a) => a.library(), "CmdOrCtrl+L"),
        item("import", t("menu.import"), (a) => a.importToLibrary(), "CmdOrCtrl+Shift+I"),
        item("project", t("project.command"), (a) => a.project()),
        item("package-export", t("package.export"), (a) => a.exportPackage()),
        SEP,
        item("export-image", t("menu.exportImage"), (a) => a.exportImage(), "CmdOrCtrl+Shift+E"),
        item("export-pdf", t("menu.exportPdf"), (a) => a.exportPdf(), "CmdOrCtrl+Alt+E"),
        {
          text: t("menu.exportCsv"),
          items: [
            item("csv-parts", t("csv.parts"), (a) => a.exportCsv("parts")),
            item("csv-nets", t("csv.nets"), (a) => a.exportCsv("nets")),
            item("csv-readings", t("csv.readings"), (a) => a.exportCsv("readings")),
            item("csv-annotations", t("csv.annotations"), (a) => a.exportCsv("annotations")),
          ],
        },
        SEP,
        item("close-tab", t("tabs.close"), (a) => a.closeBoard(), "CmdOrCtrl+W"),
      ],
    },
    {
      text: t("menu.edit"),
      items: [
        item("undo", t("menu.undo"), (a) => a.undo(), "CmdOrCtrl+Z"),
        item("redo", t("menu.redo"), (a) => a.redo(), "CmdOrCtrl+Shift+Z"),
        SEP,
        { item: "Cut" },
        { item: "Copy" },
        { item: "Paste" },
        { item: "SelectAll" },
        SEP,
        item("search", t("menu.find"), (a) => a.search(), "CmdOrCtrl+F"),
        item("search-schematic", t("menu.findSchematic"), (a) => a.searchSchematic(), "CmdOrCtrl+Alt+F"),
        item("palette", t("menu.palette"), (a) => a.palette(), "CmdOrCtrl+K"),
      ],
    },
    {
      text: t("menu.view"),
      items: [
        item("flip", t("menu.flip"), (a) => a.flip()),
        item("rotate", t("menu.rotate"), (a) => a.rotate()),
        item("rotate-back", t("menu.rotateBack"), (a) => a.rotateBack()),
        SEP,
        item("fit", t("menu.fit"), (a) => a.fit(), "CmdOrCtrl+0"),
        // No accelerator: menu shortcuts name physical US keys, so ⌘+ would
        // need ⌘⇧0 on a German keyboard. The web view handles ⌘+ instead.
        item("zoom-in", t("menu.zoomIn"), (a) => a.zoomIn()),
        item("zoom-out", t("menu.zoomOut"), (a) => a.zoomOut(), "CmdOrCtrl+-"),
        SEP,
        item("ratsnest", t("menu.ratsnest"), (a) => a.toggleRatsnest(), "CmdOrCtrl+Shift+R"),
        // G is handled by the web view (a bare letter is no menu shortcut).
        item("grid", `${t("menu.grid")}  G`, (a) => a.toggleGrid()),
        item("schematic", t("menu.schematic"), (a) => a.toggleSchematic(), "CmdOrCtrl+E"),
        item("schematic-window", t("menu.popOut"), (a) => a.popOutSchematic()),
        item("sidebar", t("menu.sidebar"), (a) => a.toggleSidebar(), "CmdOrCtrl+I"),
        SEP,
        item("photo-add", t("photo.add"), (a) => a.addPhoto()),
        item("photo-toggle", t("photo.toggle"), (a) => a.togglePhoto()),
        item("compare", t("compare.menu"), (a) => a.compare()),
        SEP,
        // Handled by the web view: menu shortcuts name physical US keys, and
        // [ ] are ⌥5 ⌥6 on a German keyboard.
        item("nav-back", `${t("nav.back")}  ⌘[`, (a) => a.back()),
        item("nav-forward", `${t("nav.forward")}  ⌘]`, (a) => a.forward()),
        item("bookmark-add", `${t("bookmark.add")}  ⌘D`, (a) => a.bookmark()),
        item("ruler", `${t("ruler.title")}  L`, (a) => a.ruler()),
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
        // ⌃⇥ / ⌃⇧⇥ are handled by the web view; menus cannot take Tab.
        item("next-tab", `${t("tabs.next")}  ⌃⇥`, (a) => a.nextTab()),
        item("prev-tab", `${t("tabs.prev")}  ⌃⇧⇥`, (a) => a.prevTab()),
        SEP,
        {
          text: t("layout.menu"),
          items: [
            ...layouts.presets.map((id) => item(`layout-${id}`, t(`layout.${id}` as Parameters<Translate>[0]), (a) => a.layout(`preset:${id}`))),
            ...(layouts.own.length ? [SEP, ...layouts.own.map((name, i) => item(`layout-own-${i}`, name, (a) => a.layout(`own:${name}`)))] : []),
            SEP,
            item("layout-save", t("layout.save"), (a) => a.saveLayout()),
          ],
        },
        SEP,
        { item: "BringAllToFront" },
      ],
    },
    {
      text: t("menu.help"),
      items: [
        item("shortcuts", t("menu.shortcuts"), (a) => a.shortcuts(), "CmdOrCtrl+/"),
        item("website", t("menu.website"), (a) => a.website()),
      ],
    },
  ];

  const menu = await Menu.new({ items });
  const previous = await menu.setAsAppMenu();
  nativeMenuActive = true;
  // The menu is rebuilt when the language or the recent files change.
  await previous?.close();
}
