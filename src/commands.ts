/**
 * The command register: every fixed command once – its text in both languages, its key
 * (fixed, or the one set in the settings), its menu key equivalent, when it is possible and
 * what it does. The menu bar, the command palette and the keyboard read it; entries made
 * from data (layouts, bookmarks, tabs, recent files) are added by the palette itself.
 * See GLOSSARY.md: Befehl, Befehlsregister.
 */
import { matchCommands, type Command } from "./core/commands";
import type { Translate } from "./i18n";
import { bindings, keyLabel, type ShortcutAction, type Shortcuts } from "./shortcuts";
import type { UiLevel } from "./settings";
import type { DrawingKind } from "./workbench/notes";

/** What a command needs to know about the app to say whether it is possible now. */
export interface CommandState {
  lang: string;
  /** A board is open. */
  board: boolean;
  /** Notes are loaded (for the board or the last one). */
  notes: boolean;
  /** Notes of the open board. */
  boardNotes: boolean;
  schematic: boolean;
  detached: boolean;
  /** Something is selected on the board. */
  selected: boolean;
  /** Parts are hidden on this board. */
  hidden: boolean;
  /** A photo of the board side is stored. */
  photo: boolean;
  /** The board has an own origin. */
  origin: boolean;
  /** A second view sits beside the board (schematic, photo, datasheet …). */
  secondView: boolean;
  /** Another tab's board is shown for comparison. */
  comparing: boolean;
  isolated: boolean;
  bench: boolean;
  grid: boolean;
  uiLevel: UiLevel;
}

/** Everything the commands can trigger: the app hands in its current handlers. */
export interface CommandActions {
  open(): void;
  openRecent(path: string): void;
  clearRecent(): void;
  library(): void;
  importToLibrary(): void;
  editBoard(): void;
  newBoard(): void;
  openProjectFolder(): void;
  demo(): void;
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
  toggleUiLevel(): void;
  toggleRatsnest(): void;
  toggleGrid(): void;
  addPhoto(): void;
  togglePhoto(): void;
  photoPane(): void;
  photoFromPdf(): void;
  realignPhoto(): void;
  removePhoto(): void;
  compare(): void;
  stopCompare(): void;
  back(): void;
  forward(): void;
  bookmark(): void;
  /** Ruler on or off. */
  ruler(): void;
  /** A fresh ruler. */
  startRuler(): void;
  placeMarker(): void;
  padValues(): void;
  hideSelected(): void;
  showAllParts(): void;
  isolate(): void;
  enterValue(): void;
  toggleBench(): void;
  newCase(): void;
  originAtSelection(): void;
  clearOrigin(): void;
  draw(kind: DrawingKind): void;
  toggleBoard(): void;
  camera(): void;
  shortcuts(): void;
  checkUpdates(): void;
  /** Saves what is unsaved, then quits. */
  quit(): void;
  /** A built-in layout ("preset:repair") or an own one ("own:Name"). */
  layout(id: string): void;
  saveLayout(): void;
  website(): void;
}

/** A key that runs a command: `key` as the browser names it (lower case with ⌘), ⌘ and ⌥ as needed. */
export interface KeyMatch {
  key?: string;
  /** Physical key, where ⌥ changes the character (⌥⌘F types "ƒ"). */
  code?: string;
  mod?: true;
  alt?: true;
  /** Only with a board open. */
  board?: true;
}

export interface CommandSpec {
  id: string;
  /** The native menu's item id where it differs. */
  menuId?: string;
  label(t: Translate, s: CommandState): string;
  /** The menu's text where it differs from the palette's. */
  menuLabel?(t: Translate): string;
  /** A fixed key as shown, e.g. "⌘O". */
  key?: string;
  /** A key changeable in the settings; shown from there. */
  bench?: ShortcutAction;
  /**
   * The menu shows the key after its text: keys the menu cannot take itself (a bare letter,
   * Tab), or ones it would get wrong ([ ] are ⌥5 ⌥6 on a German keyboard, but menu keys
   * name physical US keys).
   */
  menuKey?: true;
  /** Native menu key equivalent. */
  accelerator?: string;
  /** Keys the web view handles for this command. */
  keys?: KeyMatch[];
  enabled?(s: CommandState): boolean;
  run(a: CommandActions): void;
  /** What the menu item and the key do where it differs from the palette. */
  menuRun?(a: CommandActions): void;
  /** Only in the menu bar. */
  menuOnly?: true;
}

const de = (s: CommandState) => s.lang.startsWith("de");

/** In the order the command palette lists them. */
export const COMMANDS: readonly CommandSpec[] = [
  { id: "open", label: (t) => t("menu.open"), key: "⌘O", accelerator: "CmdOrCtrl+O", keys: [{ mod: true, key: "o" }], run: (a) => a.open() },
  { id: "library", label: (t) => t("menu.library"), key: "⌘L", accelerator: "CmdOrCtrl+L", keys: [{ mod: true, key: "l" }], run: (a) => a.library() },
  { id: "board-edit", label: (_t, s) => (de(s) ? "Board bearbeiten" : "Edit board"), enabled: (s) => s.board, run: (a) => a.editBoard() },
  { id: "board-new", label: (_t, s) => (de(s) ? "Neues Board erstellen" : "Create board"), run: (a) => a.newBoard() },
  {
    id: "project-folder-open",
    label: (_t, s) => (de(s) ? "ODB++-/EasyEDA-Projektordner öffnen" : "Open ODB++ / EasyEDA project folder"),
    run: (a) => a.openProjectFolder(),
  },
  { id: "import", label: (t) => t("menu.import"), key: "⇧⌘I", accelerator: "CmdOrCtrl+Shift+I", run: (a) => a.importToLibrary() },
  { id: "demo", label: (t) => t("menu.demo"), run: (a) => a.demo() },
  { id: "flip", label: (t) => t("menu.flip"), bench: "flip", enabled: (s) => s.board, run: (a) => a.flip() },
  { id: "rotate", label: (t) => t("menu.rotate"), bench: "rotate", enabled: (s) => s.board, run: (a) => a.rotate() },
  { id: "rotate-back", label: (t) => t("menu.rotateBack"), key: "⇧R", keys: [{ key: "R" }], enabled: (s) => s.board, run: (a) => a.rotateBack() },
  { id: "fit", label: (t) => t("menu.fit"), bench: "fit", accelerator: "CmdOrCtrl+0", enabled: (s) => s.board, run: (a) => a.fit() },
  { id: "ratsnest", label: (t) => t("menu.ratsnest"), key: "⇧⌘R", accelerator: "CmdOrCtrl+Shift+R", enabled: (s) => s.board, run: (a) => a.toggleRatsnest() },
  { id: "schematic", label: (t) => t("menu.schematic"), key: "⌘E", accelerator: "CmdOrCtrl+E", keys: [{ mod: true, key: "e" }], run: (a) => a.toggleSchematic() },
  {
    id: "schematic-search",
    menuId: "search-schematic",
    label: (t) => t("menu.findSchematic"),
    key: "⌥⌘F",
    accelerator: "CmdOrCtrl+Alt+F",
    keys: [{ mod: true, alt: true, code: "KeyF" }],
    enabled: (s) => s.schematic,
    run: (a) => a.searchSchematic(),
  },
  { id: "schematic-window", label: (t) => t("menu.popOut"), enabled: (s) => s.schematic && !s.detached, run: (a) => a.popOutSchematic() },
  { id: "sidebar", label: (t) => t("menu.sidebar"), key: "⌘I", accelerator: "CmdOrCtrl+I", keys: [{ mod: true, key: "i" }], enabled: (s) => s.board, run: (a) => a.toggleSidebar() },
  { id: "ui-level", label: (t, s) => t(s.uiLevel === "view" ? "ui.toWorkshop" : "ui.toView"), run: (a) => a.toggleUiLevel() },
  { id: "export", menuId: "export-image", label: (t) => t("menu.exportImage"), key: "⇧⌘E", accelerator: "CmdOrCtrl+Shift+E", enabled: (s) => s.board, run: (a) => a.exportImage() },
  { id: "export-pdf", label: (t) => t("menu.exportPdf"), key: "⌥⌘E", accelerator: "CmdOrCtrl+Alt+E", enabled: (s) => s.board, run: (a) => a.exportPdf() },
  { id: "marker", label: (t) => t("marker.place"), bench: "marker", enabled: (s) => s.board && s.notes, run: (a) => a.placeMarker() },
  {
    id: "ruler",
    label: (t) => t("ruler.title"),
    key: "L",
    menuKey: true,
    keys: [{ key: "l", board: true }, { key: "L", board: true }],
    enabled: (s) => s.board,
    run: (a) => a.startRuler(),
    menuRun: (a) => a.ruler(),
  },
  { id: "pad-values", label: (t) => t("pad.command"), key: "V", keys: [{ key: "v", board: true }, { key: "V", board: true }], enabled: (s) => s.board, run: (a) => a.padValues() },
  { id: "hide-selected", label: (t) => t("hide.command"), key: "H", keys: [{ key: "h", board: true }], enabled: (s) => s.board && s.boardNotes, run: (a) => a.hideSelected() },
  { id: "isolate", label: (t, s) => t(s.isolated ? "isolate.end" : "isolate.command"), key: "I", keys: [{ key: "i", board: true }], enabled: (s) => s.board, run: (a) => a.isolate() },
  { id: "project", label: (t) => t("project.command"), run: (a) => a.project() },
  { id: "package-export", label: (t) => t("package.export"), enabled: (s) => s.board && s.boardNotes, run: (a) => a.exportPackage() },
  { id: "enter-value", label: (t) => t("keys.enterValue"), bench: "enterValue", enabled: (s) => s.board && s.selected, run: (a) => a.enterValue() },
  { id: "bench", label: (t, s) => t(s.bench ? "bench.close" : "bench.open"), bench: "benchMode", enabled: (s) => s.board && s.boardNotes, run: (a) => a.toggleBench() },
  { id: "case-new", label: (t) => t("measure.newCase"), enabled: (s) => s.board && s.boardNotes, run: (a) => a.newCase() },
  {
    id: "grid",
    label: (t, s) => t(s.grid ? "grid.off" : "grid.on"),
    menuLabel: (t) => t("menu.grid"),
    key: "G",
    menuKey: true,
    keys: [{ key: "g", board: true }],
    enabled: (s) => s.board,
    run: (a) => a.toggleGrid(),
  },
  { id: "origin-selection", label: (t) => t("origin.atSelection"), enabled: (s) => s.board && s.boardNotes && s.selected, run: (a) => a.originAtSelection() },
  { id: "origin-clear", label: (t) => t("origin.clear"), key: "⇧O", keys: [{ key: "O", board: true }], enabled: (s) => s.origin, run: (a) => a.clearOrigin() },
  { id: "layout-save", label: (t) => t("layout.save"), run: (a) => a.saveLayout() },
  { id: "show-all-parts", label: (t) => t("hide.showAllCommand"), enabled: (s) => s.hidden, run: (a) => a.showAllParts() },
  ...(
    [
      ["line", "draw.line"],
      ["area", "draw.area"],
      ["jumper", "draw.jumper"],
      ["arrow", "draw.arrow"],
      ["rect", "draw.rect"],
      ["circle", "draw.circle"],
      ["text", "draw.textTool"],
    ] as const
  ).map(
    ([kind, text]): CommandSpec => ({ id: `draw-${kind}`, label: (t) => t(text), enabled: (s) => s.board && s.notes, run: (a) => a.draw(kind) }),
  ),
  { id: "photo-add", label: (t) => t("photo.add"), enabled: (s) => s.board && s.notes, run: (a) => a.addPhoto() },
  { id: "photo-toggle", label: (t) => t("photo.toggle"), enabled: (s) => s.photo, run: (a) => a.togglePhoto() },
  { id: "photo-pane", label: (t) => t("photo.paneCommand"), enabled: (s) => s.board, run: (a) => a.photoPane() },
  { id: "csv-parts", label: (t) => t("csv.parts"), enabled: (s) => s.board, run: (a) => a.exportCsv("parts") },
  { id: "csv-nets", label: (t) => t("csv.nets"), enabled: (s) => s.board, run: (a) => a.exportCsv("nets") },
  { id: "csv-annotations", label: (t) => t("csv.annotations"), enabled: (s) => s.board && s.boardNotes, run: (a) => a.exportCsv("annotations") },
  { id: "csv-readings", label: (t) => t("csv.readings"), enabled: (s) => s.board && s.notes, run: (a) => a.exportCsv("readings") },
  { id: "nav-back", label: (t) => t("nav.back"), bench: "back", menuKey: true, enabled: (s) => s.board, run: (a) => a.back() },
  { id: "nav-forward", label: (t) => t("nav.forward"), bench: "forward", menuKey: true, enabled: (s) => s.board, run: (a) => a.forward() },
  { id: "bookmark-add", label: (t) => t("bookmark.add"), bench: "bookmark", menuKey: true, enabled: (s) => s.board && s.notes, run: (a) => a.bookmark() },
  { id: "board-hide", label: (t) => t("board.toggle"), enabled: (s) => s.secondView, run: (a) => a.toggleBoard() },
  { id: "camera", label: (t) => t("camera.command"), enabled: (s) => s.board, run: (a) => a.camera() },
  { id: "photo-pdf", label: (t) => t("photo.pdfCommand"), enabled: (s) => s.board && s.notes && s.schematic, run: (a) => a.photoFromPdf() },
  { id: "photo-realign", label: (t) => `${t("photo.title")}: ${t("photo.realign")}`, enabled: (s) => s.photo, run: (a) => a.realignPhoto() },
  { id: "photo-remove", label: (t) => `${t("photo.title")}: ${t("photo.remove")}`, enabled: (s) => s.photo, run: (a) => a.removePhoto() },
  { id: "new-tab", label: (t) => t("tabs.new"), key: "⌘T", accelerator: "CmdOrCtrl+T", run: (a) => a.newTab() },
  { id: "close", menuId: "close-tab", label: (t) => t("tabs.close"), key: "⌘W", accelerator: "CmdOrCtrl+W", enabled: (s) => s.board || s.schematic, run: (a) => a.closeBoard() },
  { id: "settings", label: (t) => t("menu.settings"), key: "⌘,", accelerator: "CmdOrCtrl+,", run: (a) => a.settings() },
  { id: "shortcuts", label: (t) => t("menu.shortcuts"), key: "⌘/", accelerator: "CmdOrCtrl+/", keys: [{ key: "?" }], run: (a) => a.shortcuts() },
  { id: "updates", menuId: "check-updates", label: (t) => t("menu.checkUpdates"), run: (a) => a.checkUpdates() },
  { id: "website", label: (t) => t("menu.website"), run: (a) => a.website() },
  { id: "compare-stop", label: (t) => t("compare.stop"), enabled: (s) => s.comparing, run: (a) => a.stopCompare() },

  // Only in the menu bar.
  { id: "quit", label: (t) => t("menu.quit"), accelerator: "CmdOrCtrl+Q", menuOnly: true, run: (a) => a.quit() },
  { id: "undo", label: (t) => t("menu.undo"), accelerator: "CmdOrCtrl+Z", menuOnly: true, run: (a) => a.undo() },
  { id: "redo", label: (t) => t("menu.redo"), accelerator: "CmdOrCtrl+Shift+Z", menuOnly: true, run: (a) => a.redo() },
  { id: "search", label: (t) => t("menu.find"), accelerator: "CmdOrCtrl+F", keys: [{ mod: true, key: "f" }], menuOnly: true, run: (a) => a.search() },
  { id: "palette", label: (t) => t("menu.palette"), accelerator: "CmdOrCtrl+K", keys: [{ mod: true, key: "k" }], menuOnly: true, run: (a) => a.palette() },
  // No accelerator: menu shortcuts name physical US keys, so ⌘+ would need ⌘⇧0 on a
  // German keyboard. The web view handles ⌘+ instead.
  { id: "zoom-in", label: (t) => t("menu.zoomIn"), menuOnly: true, run: (a) => a.zoomIn() },
  { id: "zoom-out", label: (t) => t("menu.zoomOut"), accelerator: "CmdOrCtrl+-", menuOnly: true, run: (a) => a.zoomOut() },
  { id: "compare", label: (t) => t("compare.menu"), menuOnly: true, run: (a) => a.compare() },
  // ⌃⇥ / ⌃⇧⇥ are handled by the web view; menus cannot take Tab.
  { id: "next-tab", label: (t) => t("tabs.next"), key: "⌃⇥", menuKey: true, menuOnly: true, run: (a) => a.nextTab() },
  { id: "prev-tab", label: (t) => t("tabs.prev"), key: "⌃⇧⇥", menuKey: true, menuOnly: true, run: (a) => a.prevTab() },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function command(id: string): CommandSpec {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown command ${id}`);
  return c;
}

/** The key a command is shown with: the one set in the settings, else its fixed one. */
export function shortcutOf(c: CommandSpec, shortcuts: Shortcuts | undefined, lang: string): string | undefined {
  if (!c.bench) return c.key;
  const first = bindings(shortcuts)[c.bench][0];
  return first ? keyLabel(first, lang) : undefined;
}

/** The command a key press runs, where the web view handles it. */
export function commandForKey(
  e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  board: boolean,
  phase: "mod" | "plain",
): CommandSpec | undefined {
  const mod = e.metaKey || e.ctrlKey;
  const key = phase === "mod" ? e.key.toLowerCase() : e.key;
  // The more particular match first: ⌥⌘F before ⌘F.
  const all = COMMANDS.flatMap((c) => (c.keys ?? []).map((k) => ({ c, k }))).sort((a, b) => Number(!!b.k.alt) - Number(!!a.k.alt));
  for (const { c, k } of all) {
    if (!!k.mod !== (phase === "mod") || (k.mod && !mod)) continue;
    if (k.alt && !e.altKey) continue;
    if (k.code ? e.code !== k.code : k.key !== key) continue;
    if (k.board && !board) continue;
    return c;
  }
  return undefined;
}

/** Entries the palette adds from data, after the command with the given id ("end": at the end). */
export type PaletteExtras = Partial<Record<string, Command[]>>;

/** The command palette's list: the register's commands as they stand, with the extras in their places. */
export function paletteCommands(
  t: Translate,
  s: CommandState,
  actions: () => CommandActions,
  shortcuts: Shortcuts | undefined,
  extras: PaletteExtras = {},
): Command[] {
  const out: Command[] = [];
  for (const c of COMMANDS) {
    if (c.menuOnly) continue;
    const shortcut = shortcutOf(c, shortcuts, s.lang);
    out.push({
      id: c.id,
      label: c.label(t, s),
      ...(shortcut && { shortcut }),
      ...(c.enabled && { enabled: c.enabled(s) }),
      run: () => c.run(actions()),
    });
    out.push(...(extras[c.id] ?? []));
  }
  out.push(...(extras.end ?? []));
  return out;
}

export { matchCommands };
