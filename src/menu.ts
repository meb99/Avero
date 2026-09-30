import { Menu, type MenuItemOptions, type PredefinedMenuItemOptions, type SubmenuOptions } from "@tauri-apps/api/menu";
import type { Translate } from "./i18n";

/** Everything the menu bar can trigger. */
export interface MenuActions {
  open(): void;
  openRecent(path: string): void;
  clearRecent(): void;
  library(): void;
  importToLibrary(): void;
  closeBoard(): void;
  newTab(): void;
  nextTab(): void;
  prevTab(): void;
  exportImage(): void;
  settings(): void;
  search(): void;
  searchSchematic(): void;
  palette(): void;
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
  addPhoto(): void;
  togglePhoto(): void;
  compare(): void;
  shortcuts(): void;
  checkUpdates(): void;
  website(): void;
}

type Item = MenuItemOptions | SubmenuOptions | PredefinedMenuItemOptions;

const SEP: PredefinedMenuItemOptions = { item: "Separator" };

/**
 * True once the native menu is installed. Its key equivalents then handle
 * ⌘ shortcuts, so the web view must not handle them a second time.
 */
export let nativeMenuActive = false;

/**
 * Builds the macOS menu bar. Actions go through `actions()` so the menu
 * always calls the current handlers without being rebuilt on every render.
 */
export async function installMenu(t: Translate, actions: () => MenuActions, recent: string[], version: string): Promise<void> {
  const item = (id: string, text: string, run: (a: MenuActions) => void, accelerator?: string): MenuItemOptions => ({
    id,
    text,
    accelerator,
    action: () => run(actions()),
  });

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
        { item: "Quit" },
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
        SEP,
        item("export-image", t("menu.exportImage"), (a) => a.exportImage(), "CmdOrCtrl+Shift+E"),
        SEP,
        item("close-tab", t("tabs.close"), (a) => a.closeBoard(), "CmdOrCtrl+W"),
      ],
    },
    {
      text: t("menu.edit"),
      items: [
        { item: "Undo" },
        { item: "Redo" },
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
        item("schematic", t("menu.schematic"), (a) => a.toggleSchematic(), "CmdOrCtrl+E"),
        item("schematic-window", t("menu.popOut"), (a) => a.popOutSchematic()),
        item("sidebar", t("menu.sidebar"), (a) => a.toggleSidebar(), "CmdOrCtrl+I"),
        SEP,
        item("photo-add", t("photo.add"), (a) => a.addPhoto()),
        item("photo-toggle", t("photo.toggle"), (a) => a.togglePhoto()),
        item("compare", t("compare.menu"), (a) => a.compare()),
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
