import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BoardView, type BoardViewHandle, type ViewState } from "./components/BoardView";
import { CommandPalette } from "./components/CommandPalette";
import { HelpDialog, SettingsDialog } from "./components/Dialogs";
import { LibraryDialog, type LibraryDrop } from "./components/Library";
import { CloseIcon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { Splitter } from "./components/Splitter";
import { StatusBar } from "./components/StatusBar";
import { TabBar, type TabInfo } from "./components/TabBar";
import { Toolbar } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";
import { BoardModel, type ViewSide } from "./core/board";
import type { Command } from "./core/commands";
import {
  BOARD_EXTENSIONS,
  loadDemo,
  loadPath,
  onFileDrop,
  onFinderOpen,
  pickPath,
  readFileBytes,
  saveBytes,
  schematicsFor,
  setWindowTitle,
  type BoardSource,
  type Loaded,
} from "./core/loader";
import type { LoadError, Selection, Side } from "./core/types";
import { emitTo, listen } from "@tauri-apps/api/event";
import { I18nContext, systemLanguage, translator, type MessageKey } from "./i18n";
import { installMenu, nativeMenuActive, type MenuActions } from "./menu";
import { closeSchematicWindow, LINK, openSchematicWindow, type LinkedDoc } from "./schematic/link";
import { DARK, LIGHT } from "./render/palette";
import type { SchematicDocument } from "./schematic/document";
import { SchematicView, type SchematicFocus, type SchematicViewHandle, type WordTarget } from "./schematic/SchematicView";
import type { Word } from "./schematic/textIndex";
import { clearRecent, loadRecent, loadSettings, rememberRecent, saveSettings, type Settings } from "./settings";
import { useTheme } from "./theme";
import { dailyCheck, fetchUpdate, type Update } from "./updates";
import { pickImport, type LibraryEntry } from "./workbench/library";
import { netStatuses, type NetStatus } from "./workbench/notes";
import { useBoardNotes } from "./workbench/store";

const NONE: Selection = { kind: "none" };
const DEMO_SCHEMATIC = `${import.meta.env.BASE_URL}demo/avero-demo-schematic.pdf`;
const WEBSITE = "https://github.com/meb99/Avero";
const TOAST_MS = 4000;

/** Everything that belongs to one tab. */
interface Tab {
  id: number;
  model: BoardModel | null;
  source: BoardSource | null;
  side: ViewSide;
  rotation: number;
  selection: Selection;
  schematic: SchematicDocument | null;
  schematicVisible: boolean;
  view?: ViewState;
}

const emptyTab = (id: number): Tab => ({
  id,
  model: null,
  source: null,
  side: "top",
  rotation: 0,
  selection: NONE,
  schematic: null,
  schematicVisible: true,
});

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

const isPdf = (path: string) => /\.pdf$/i.test(path);
const fileName = (path: string) => path.split("/").pop() ?? path;

/** The text the schematic should find for a board selection. */
function focusText(model: BoardModel, sel: Selection): string | undefined {
  switch (sel.kind) {
    case "part":
      return model.parts[sel.part].name;
    case "pin":
      return model.parts[model.pins[sel.pin].part].name;
    case "net":
    case "testPoint": {
      const net = model.selectedNet(sel);
      return net === undefined ? undefined : model.nets[net].name;
    }
    case "none":
      return undefined;
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [model, setModel] = useState<BoardModel | null>(null);
  const [source, setSource] = useState<BoardSource | null>(null);
  const [side, setSide] = useState<ViewSide>("top");
  const [rotation, setRotation] = useState(0);
  const [selection, setSelection] = useState<Selection>(NONE);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<{ name: string; path?: string; error: LoadError } | null>(null);
  // A file that failed for lack of an XZZ key, reopened once the key is set.
  const retryPath = useRef<string | null>(null);
  const [dialog, setDialog] = useState<"settings" | "help" | "library" | "palette" | null>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const [libraryDrop, setLibraryDrop] = useState<LibraryDrop | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [toast, setToast] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [schematic, setSchematic] = useState<SchematicDocument | null>(null);
  const [schematicVisible, setSchematicVisible] = useState(true);
  // The schematic is shown in its own window instead of the split view.
  const [detached, setDetached] = useState(false);
  const [focus, setFocus] = useState<SchematicFocus | null>(null);
  // The active tab lives in the states above; `tabs` keeps the other tabs as
  // they were left (its entry for the active tab is stale).
  const [tabs, setTabs] = useState<Tab[]>(() => [emptyTab(0)]);
  const [activeTab, setActiveTab] = useState(0);
  const [initialView, setInitialView] = useState<ViewState | undefined>(undefined);
  const nextTabId = useRef(1);
  const live = useRef<Tab>(emptyTab(0));
  live.current = { id: activeTab, model, source, side, rotation, selection, schematic, schematicVisible };
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const viewRef = useRef<BoardViewHandle>(null);
  const schematicViewRef = useRef<SchematicViewHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workAreaRef = useRef<HTMLDivElement>(null);
  const focusNonce = useRef(0);
  // Set while a click in the schematic changes the board selection, so the
  // schematic highlights the word without jumping away from it.
  const pickedInSchematic = useRef(false);

  const lang = settings.language === "auto" ? systemLanguage() : settings.language;
  const i18n = useMemo(() => ({ t: translator(lang), lang }), [lang]);
  const { t } = i18n;
  const theme = useTheme(settings);
  const palette = theme === "dark" ? DARK : LIGHT;
  const showSchematic = schematic !== null && schematicVisible && !detached;
  const { notes, update: updateNotes, error: notesError } = useBoardNotes(source);

  // Measurement state by net index for the board overlay.
  const measured = useMemo(() => {
    const out = new Map<number, NetStatus>();
    if (!model || !notes) return out;
    for (const [name, status] of netStatuses(notes, settings.tolerance)) {
      const net = model.findNet(name);
      if (net !== undefined) out.set(net, status);
    }
    return out;
  }, [model, notes, settings.tolerance]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [theme, lang]);

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    const name = source?.name ?? schematic?.name;
    void setWindowTitle(name ? `${name} — Avero` : "Avero");
  }, [source, schematic]);

  // --- opening files -------------------------------------------------------

  const openSchematicBytes = useCallback(async (bytes: Uint8Array, name: string, path?: string) => {
    try {
      // pdf.js is large; load it only once a schematic is actually opened.
      const { SchematicDocument } = await import("./schematic/document");
      const doc = await SchematicDocument.open(bytes, name, path);
      setSchematic((old) => {
        old?.destroy();
        return doc;
      });
      setSchematicVisible(true);
    } catch (e) {
      setError({ name, error: { code: "schematic", message: e instanceof Error ? e.message : String(e) } });
    }
  }, []);

  const openSchematicPath = useCallback(
    async (path: string) => {
      try {
        await openSchematicBytes(await readFileBytes(path), fileName(path), path);
      } catch (e) {
        const err = e && typeof e === "object" && "code" in e ? (e as LoadError) : { code: "io" as const, message: String(e) };
        setError({ name: fileName(path), error: err });
      }
    },
    [openSchematicBytes],
  );

  const finishLoad = useCallback((loaded: Loaded): boolean => {
    setLoading(null);
    const { result, source } = loaded;
    if (!result.ok) {
      setError({ name: source.name, path: source.path, error: result.error });
      return false;
    }
    setError(null);
    setModel(new BoardModel(result.board));
    setSource(source);
    setSelection(NONE);
    setSide("top");
    setRotation(0);
    setInitialView(undefined);
    if (source.path) setRecent(rememberRecent(source.path));
    return true;
  }, []);

  // --- tabs ----------------------------------------------------------------
  // These only use refs and state setters, so any render's copy works.

  const restoreTab = (tab: Tab) => {
    setActiveTab(tab.id);
    setModel(tab.model);
    setSource(tab.source);
    setSide(tab.side);
    setRotation(tab.rotation);
    setSelection(tab.selection);
    setSchematic(tab.schematic);
    setSchematicVisible(tab.schematicVisible);
    setInitialView(tab.view);
    setError(null);
  };

  const saveActiveTab = (): Tab => {
    const saved = { ...live.current, view: viewRef.current?.viewState() };
    setTabs((ts) => ts.map((t) => (t.id === saved.id ? saved : t)));
    return saved;
  };

  const switchTab = (id: number) => {
    const target = tabsRef.current.find((t) => t.id === id);
    if (!target || id === live.current.id) return;
    saveActiveTab();
    restoreTab(target);
  };

  const cycleTab = (step: number) => {
    const list = tabsRef.current;
    const i = list.findIndex((t) => t.id === live.current.id);
    if (list.length > 1) switchTab(list[(i + step + list.length) % list.length].id);
  };

  const newTab = () => {
    saveActiveTab();
    const tab = emptyTab(nextTabId.current++);
    setTabs((ts) => [...ts, tab]);
    restoreTab(tab);
  };

  const closeTab = (id: number) => {
    const all = tabsRef.current;
    const index = all.findIndex((t) => t.id === id);
    if (index < 0) return;
    const active = id === live.current.id;
    (active ? live.current : all[index]).schematic?.destroy();
    const rest = all.filter((t) => t.id !== id);
    if (!active) {
      setTabs(rest);
      return;
    }
    const next = rest[Math.min(index, rest.length - 1)] ?? emptyTab(nextTabId.current++);
    setTabs(rest.length > 0 ? rest : [next]);
    restoreTab(next);
  };

  /** Opens a board or PDF. `schematicPath` overrides the automatic schematic lookup. */
  const openPath = useCallback(
    async (path: string, schematicPath?: string) => {
      if (isPdf(path)) {
        await openSchematicPath(path);
        return;
      }
      // Already open in a tab: show that tab.
      const openIn = tabsRef.current.find((t) => (t.id === live.current.id ? live.current : t).source?.path === path);
      if (openIn) {
        switchTab(openIn.id);
        return;
      }
      setLoading(fileName(path));
      const loaded = await loadPath(path, settings.xzzKey);
      // An open board stays; the new one gets its own tab.
      const inNewTab = loaded.result.ok && live.current.model !== null;
      const shownSchematic = inNewTab ? undefined : live.current.schematic?.path;
      if (inNewTab) newTab();
      if (!finishLoad(loaded)) return;
      const wanted = schematicPath ?? (settings.autoSchematic ? (await schematicsFor(path).catch(() => []))[0] : undefined);
      if (wanted && wanted !== shownSchematic) await openSchematicPath(wanted);
    },
    // switchTab and newTab only use refs and setters.
    [finishLoad, openSchematicPath, settings.autoSchematic, settings.xzzKey],
  );

  const openDialog = useCallback(async () => {
    const path = await pickPath(t("welcome.open"), "any");
    if (path) await openPath(path);
  }, [openPath, t]);

  const openLibraryEntry = useCallback(
    (entry: LibraryEntry) => {
      setDialog(null);
      const board = entry.boards[0]?.path;
      const pdf = entry.schematics[0]?.path;
      if (board) void openPath(board, pdf);
      else if (pdf) void openSchematicPath(pdf);
    },
    [openPath, openSchematicPath],
  );

  const openDemo = useCallback(async () => {
    setLoading("Avero Demo");
    const loaded = await loadDemo();
    if (loaded.result.ok && live.current.model !== null) newTab();
    if (!finishLoad(loaded)) return;
    try {
      const response = await fetch(DEMO_SCHEMATIC);
      if (response.ok) await openSchematicBytes(new Uint8Array(await response.arrayBuffer()), "Avero Demo.pdf");
    } catch {
      // The demo board works without its schematic.
    }
  }, [finishLoad, openSchematicBytes]);

  const closeBoard = () => closeTab(live.current.id);

  const closeSchematic = useCallback(() => {
    setSchematic((old) => {
      old?.destroy();
      return null;
    });
  }, []);

  const toggleSchematic = useCallback(async () => {
    if (detached) {
      await closeSchematicWindow();
      return;
    }
    if (schematic) {
      setSchematicVisible((v) => !v);
      return;
    }
    const path = await pickPath(t("schematic.open"), "pdf");
    if (path) await openSchematicPath(path);
  }, [detached, schematic, openSchematicPath, t]);

  // --- selection -----------------------------------------------------------

  const select = useCallback(
    (sel: Selection, zoom: boolean) => {
      setSelection(sel);
      if (!model) return;
      // Jump to the side the selected thing is on.
      let where: Side | undefined;
      if (sel.kind === "part") where = model.parts[sel.part].side;
      else if (sel.kind === "pin") where = model.pins[sel.pin].side;
      else if (sel.kind === "testPoint") where = model.testPoints[sel.testPoint].side;
      if (where && where !== "both") setSide(where);
      if (zoom) {
        const bounds = model.selectionBounds(sel);
        if (bounds) viewRef.current?.zoomTo(bounds);
      }
    },
    [model],
  );

  // Board selection -> schematic.
  useEffect(() => {
    const jump = !pickedInSchematic.current;
    pickedInSchematic.current = false;
    const text = model ? focusText(model, selection) : undefined;
    setFocus(text ? { text, jump, nonce: ++focusNonce.current } : null);
  }, [model, selection]);

  // Schematic -> board.
  const classifyWord = useCallback(
    (word: Word): WordTarget => {
      if (!model) return null;
      if (model.findPart(word.key) !== undefined) return "part";
      const net = model.findNet(word.key);
      return net !== undefined && model.nets[net].kind !== "unconnected" ? "net" : null;
    },
    [model],
  );

  const pickName = useCallback(
    (name: string) => {
      if (!model) return;
      const part = model.findPart(name);
      const net = model.findNet(name);
      pickedInSchematic.current = true;
      if (part !== undefined) select({ kind: "part", part }, true);
      else if (net !== undefined) select({ kind: "net", net }, true);
      else pickedInSchematic.current = false;
    },
    [model, select],
  );
  const pickWord = useCallback((word: Word) => pickName(word.key), [pickName]);

  // --- schematic window ----------------------------------------------------

  const linkedDoc = useMemo((): LinkedDoc | null => {
    if (!schematic) return null;
    return {
      name: schematic.name,
      path: schematic.path,
      // Only the demo schematic comes without a path.
      url: schematic.path ? undefined : DEMO_SCHEMATIC,
      parts: model ? model.parts.map((p) => p.name.toUpperCase()) : [],
      nets: model ? model.nets.filter((n) => n.kind !== "unconnected").map((n) => n.name.toUpperCase()) : [],
    };
  }, [schematic, model]);
  const linkRef = useRef({ linkedDoc, focus, pickName });
  linkRef.current = { linkedDoc, focus, pickName };

  const sendToWindow = (event: string, payload: unknown) => void emitTo("schematic", event, payload).catch(() => {});

  useEffect(() => {
    const subscriptions = [
      listen(LINK.ready, () => {
        sendToWindow(LINK.doc, linkRef.current.linkedDoc);
        sendToWindow(LINK.focus, linkRef.current.focus);
      }),
      listen<string>(LINK.pick, (e) => linkRef.current.pickName(e.payload)),
      listen(LINK.closed, () => setDetached(false)),
    ];
    return () => {
      for (const s of subscriptions) void s.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (detached) sendToWindow(LINK.doc, linkedDoc);
  }, [detached, linkedDoc]);

  useEffect(() => {
    if (detached) sendToWindow(LINK.focus, focus);
  }, [detached, focus]);

  const popOutSchematic = useCallback(async () => {
    if (!schematic) return;
    try {
      await openSchematicWindow(`${schematic.name} — Avero`);
      setDetached(true);
    } catch (e) {
      setToast(String(e));
    }
  }, [schematic]);

  // Files dropped on the window or opened from Finder.
  useEffect(() => {
    const open = (paths: string[]) => {
      // With the library open, drops are imported into it.
      if (dialogRef.current === "library") {
        setLibraryDrop((d) => ({ paths, nonce: (d?.nonce ?? 0) + 1 }));
        return;
      }
      // A board and its schematic dropped together: open both.
      const board = paths.find((p) => !isPdf(p));
      const pdf = paths.find(isPdf);
      if (board) void openPath(board, pdf);
      else if (pdf) void openPath(pdf);
    };
    const subscriptions = [onFileDrop(open, setDragOver), onFinderOpen(open)];
    return () => {
      for (const s of subscriptions) void s.then((unlisten) => unlisten());
    };
  }, [openPath]);

  // --- app actions: menu bar, command palette ------------------------------

  const tabInfos: TabInfo[] = tabs.map((tab) => {
    const shown = tab.id === activeTab ? live.current : tab;
    return { id: tab.id, title: shown.source?.name ?? shown.schematic?.name ?? t("tabs.empty"), detail: shown.source?.path };
  });

  const exportImage = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !source) return;
    try {
      const blob = await view.snapshot();
      const base = source.name.replace(/\.[^.]+$/, "");
      const path = await saveBytes(new Uint8Array(await blob.arrayBuffer()), t("menu.exportImage"), `${base}-${side}.png`, {
        name: "PNG",
        extensions: ["png"],
      });
      if (path) setToast(t("export.saved", { name: fileName(path) }));
    } catch (e) {
      setToast(t("export.failed", { message: e instanceof Error ? e.message : String(e) }));
    }
  }, [source, side, t]);

  const checkUpdates = useCallback(
    async (manual: boolean) => {
      try {
        const found = await (manual ? fetchUpdate(__APP_VERSION__) : dailyCheck(__APP_VERSION__));
        setUpdate(found);
        if (manual && !found) setToast(t("update.none", { version: __APP_VERSION__ }));
      } catch (e) {
        if (manual) setToast(t("update.failed", { message: e instanceof Error ? e.message : String(e) }));
      }
    },
    [t],
  );

  const importToLibrary = useCallback(async () => {
    setDialog("library");
    const paths = await pickImport(t("library.import"), BOARD_EXTENSIONS);
    if (paths.length > 0) setLibraryDrop((d) => ({ paths, nonce: (d?.nonce ?? 0) + 1 }));
  }, [t]);

  const openExternal = (url: string) => void openUrl(url).catch(() => window.open(url, "_blank"));

  const actions: MenuActions = {
    open: () => void openDialog(),
    openRecent: (path) => void openPath(path),
    clearRecent: () => {
      clearRecent();
      setRecent([]);
    },
    library: () => setDialog((d) => (d === "library" ? null : "library")),
    importToLibrary: () => void importToLibrary(),
    closeBoard,
    newTab,
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    exportImage: () => void exportImage(),
    settings: () => setDialog("settings"),
    search: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    searchSchematic: () => {
      if (schematic && !schematicVisible) setSchematicVisible(true);
      // After the pane is shown.
      requestAnimationFrame(() => schematicViewRef.current?.focusSearch());
    },
    palette: () => setDialog((d) => (d === "palette" ? null : d ?? "palette")),
    flip: () => setSide((s) => (s === "top" ? "bottom" : "top")),
    rotate: () => setRotation((r) => (r + 1) & 3),
    rotateBack: () => setRotation((r) => (r + 3) & 3),
    fit: () => viewRef.current?.fit(),
    zoomIn: () => viewRef.current?.zoomBy(1.5),
    zoomOut: () => viewRef.current?.zoomBy(1 / 1.5),
    toggleSchematic: () => void toggleSchematic(),
    popOutSchematic: () => void popOutSchematic(),
    toggleSidebar: () => setSettings((s) => ({ ...s, showSidebar: !s.showSidebar })),
    toggleRatsnest: () => setSettings((s) => ({ ...s, ratsnest: !s.ratsnest })),
    shortcuts: () => setDialog("help"),
    checkUpdates: () => void checkUpdates(true),
    website: () => openExternal(WEBSITE),
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // The menu calls through actionsRef, so it is rebuilt only for new texts.
  useEffect(() => {
    installMenu(t, () => actionsRef.current, recent, __APP_VERSION__).catch(() => {
      // No native menu outside the desktop app (browser preview, tests).
    });
  }, [t, recent]);

  // Once per start; dailyCheck itself limits the requests to one a day.
  useEffect(() => {
    if (settings.updateCheck) void checkUpdates(false);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const paletteCommands = (): Command[] => {
    const a = actions;
    const board = model !== null;
    return [
      { id: "open", label: t("menu.open"), shortcut: "⌘O", run: a.open },
      { id: "library", label: t("menu.library"), shortcut: "⌘L", run: a.library },
      { id: "import", label: t("menu.import"), shortcut: "⇧⌘I", run: a.importToLibrary },
      { id: "demo", label: t("menu.demo"), run: () => void openDemo() },
      { id: "flip", label: t("menu.flip"), shortcut: "Space", enabled: board, run: a.flip },
      { id: "rotate", label: t("menu.rotate"), shortcut: "R", enabled: board, run: a.rotate },
      { id: "rotate-back", label: t("menu.rotateBack"), shortcut: "⇧R", enabled: board, run: a.rotateBack },
      { id: "fit", label: t("menu.fit"), shortcut: "F", enabled: board, run: a.fit },
      { id: "ratsnest", label: t("menu.ratsnest"), shortcut: "⇧⌘R", enabled: board, run: a.toggleRatsnest },
      { id: "schematic", label: t("menu.schematic"), shortcut: "⌘E", run: a.toggleSchematic },
      { id: "schematic-search", label: t("menu.findSchematic"), shortcut: "⌥⌘F", enabled: schematic !== null, run: a.searchSchematic },
      { id: "schematic-window", label: t("menu.popOut"), enabled: schematic !== null && !detached, run: a.popOutSchematic },
      { id: "sidebar", label: t("menu.sidebar"), shortcut: "⌘I", enabled: board, run: a.toggleSidebar },
      { id: "export", label: t("menu.exportImage"), shortcut: "⇧⌘E", enabled: board, run: a.exportImage },
      { id: "new-tab", label: t("tabs.new"), shortcut: "⌘T", run: a.newTab },
      { id: "close", label: t("tabs.close"), shortcut: "⌘W", enabled: board || schematic !== null, run: a.closeBoard },
      { id: "settings", label: t("menu.settings"), shortcut: "⌘,", run: a.settings },
      { id: "shortcuts", label: t("menu.shortcuts"), shortcut: "⌘/", run: a.shortcuts },
      { id: "updates", label: t("menu.checkUpdates"), run: a.checkUpdates },
      { id: "website", label: t("menu.website"), run: a.website },
      ...tabInfos
        .filter((tab) => tab.id !== activeTab)
        .map((tab) => ({ id: `tab-${tab.id}`, label: `${t("tabs.tab")}: ${tab.title}`, run: () => switchTab(tab.id) })),
      ...recent.map((path, i) => ({ id: `recent-${i}`, label: `${t("menu.recent")}: ${fileName(path)}`, run: () => a.openRecent(path) })),
    ];
  };

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Tabs: ⌃⇥ / ⌃⇧⇥ and ⌘1 … ⌘9 (⌘9 is the last tab), as in browsers.
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const list = tabsRef.current;
        const target = e.key === "9" ? list[list.length - 1] : list[Number(e.key) - 1];
        if (target) switchTab(target.id);
        return;
      }
      if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        viewRef.current?.zoomBy(1.5);
        return;
      }
      // With the native menu bar, its key equivalents handle ⌘ shortcuts.
      if (mod && nativeMenuActive) return;
      if (mod && key === "k") {
        e.preventDefault();
        actionsRef.current.palette();
        return;
      }
      if (mod && key === "o") {
        e.preventDefault();
        void openDialog();
        return;
      }
      if (mod && e.altKey && e.code === "KeyF") {
        e.preventDefault();
        actionsRef.current.searchSchematic();
        return;
      }
      if (mod && key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (mod && key === "e") {
        e.preventDefault();
        void toggleSchematic();
        return;
      }
      if (mod && key === "l") {
        e.preventDefault();
        setDialog((d) => (d === "library" ? null : "library"));
        return;
      }
      if (mod && key === "i") {
        e.preventDefault();
        setSettings((s) => ({ ...s, showSidebar: !s.showSidebar }));
        return;
      }
      if (isTyping(e.target) || dialog || mod || e.altKey) return;
      const view = viewRef.current;
      const sheet = schematicViewRef.current;
      switch (e.key) {
        case "?":
          setDialog("help");
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "Escape":
          setSelection(NONE);
          break;
        case " ":
          e.preventDefault();
          setSide((s) => (s === "top" ? "bottom" : "top"));
          break;
        case "r":
          setRotation((r) => (r + 1) & 3);
          break;
        case "R":
          setRotation((r) => (r + 3) & 3);
          break;
        case "f":
        case "F":
        case "Home":
          view?.fit();
          break;
        case "+":
        case "=":
          view?.zoomBy(1.5);
          break;
        case "-":
        case "_":
          view?.zoomBy(1 / 1.5);
          break;
        case "Enter": {
          const bounds = model?.selectionBounds(selection);
          if (bounds) view?.zoomTo(bounds);
          break;
        }
        case "ArrowLeft":
          view?.panBy(80, 0);
          break;
        case "ArrowRight":
          view?.panBy(-80, 0);
          break;
        case "ArrowUp":
          view?.panBy(0, 80);
          break;
        case "ArrowDown":
          view?.panBy(0, -80);
          break;
        case "PageDown":
          e.preventDefault();
          sheet?.nextPage();
          break;
        case "PageUp":
          e.preventDefault();
          sheet?.prevPage();
          break;
        case "]":
          sheet?.nextHit();
          break;
        case "[":
          sheet?.prevHit();
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, model, selection, openDialog, toggleSchematic]);

  // --- layout --------------------------------------------------------------

  const [share, setShare] = useState(settings.schematicShare);
  useEffect(() => setShare(settings.schematicShare), [settings.schematicShare]);

  const errorText = error
    ? t(`error.${error.error.code}` as MessageKey, { format: error.error.format ?? "", message: error.error.message })
    : "";

  const welcome = !model && !schematic;

  return (
    <I18nContext.Provider value={i18n}>
      <div className={`app${tabs.length > 1 ? " has-tabs" : ""}`}>
        <Toolbar
          model={model}
          side={side}
          hasSchematic={schematic !== null}
          schematicVisible={showSchematic}
          sidebarVisible={settings.showSidebar}
          onOpen={() => void openDialog()}
          onClose={closeBoard}
          onSide={setSide}
          onRotate={() => setRotation((r) => (r + 1) & 3)}
          onFit={() => viewRef.current?.fit()}
          onZoom={(f) => viewRef.current?.zoomBy(f)}
          onSchematic={() => void toggleSchematic()}
          onLibrary={() => setDialog("library")}
          onSidebar={() => setSettings((s) => ({ ...s, showSidebar: !s.showSidebar }))}
          onSettings={() => setDialog("settings")}
          onHelp={() => setDialog("help")}
          onPick={(sel) => select(sel, true)}
          searchRef={searchRef}
        />

        {tabs.length > 1 && <TabBar tabs={tabInfos} active={activeTab} onSwitch={switchTab} onClose={closeTab} onNew={newTab} />}

        <main className="workspace">
          {welcome ? (
            <Welcome
              recent={recent}
              onOpen={() => void openDialog()}
              onDemo={() => void openDemo()}
              onLibrary={() => setDialog("library")}
              onOpenRecent={(p) => void openPath(p)}
              onClearRecent={() => {
                clearRecent();
                setRecent([]);
              }}
            />
          ) : (
            <>
              <div className="work-area" ref={workAreaRef}>
                {model ? (
                  <BoardView
                    ref={viewRef}
                    model={model}
                    side={side}
                    rotation={rotation}
                    selection={selection}
                    settings={settings}
                    palette={palette}
                    measured={measured}
                    initialView={initialView}
                    onSelect={select}
                  />
                ) : (
                  !showSchematic && <div className="board-placeholder">{t("welcome.open")}</div>
                )}
                {schematic && showSchematic && (
                  <>
                    {model && (
                      <Splitter
                        container={workAreaRef}
                        share={share}
                        onDrag={setShare}
                        onDone={(s) => setSettings((old) => ({ ...old, schematicShare: s }))}
                      />
                    )}
                    <div className="schematic-pane" style={model ? { width: `${share * 100}%` } : { flex: 1 }}>
                      <SchematicView
                        ref={schematicViewRef}
                        doc={schematic}
                        focus={focus}
                        scroll={settings.scroll}
                        classify={classifyWord}
                        onPick={pickWord}
                        onClose={closeSchematic}
                        onPopOut={() => void popOutSchematic()}
                      />
                    </div>
                  </>
                )}
              </div>
              {model && settings.showSidebar && (
                <Sidebar
                  model={model}
                  selection={selection}
                  side={side}
                  settings={settings}
                  notes={notes}
                  notesError={notesError}
                  updateNotes={updateNotes}
                  onTolerance={(tolerance) => setSettings((s) => ({ ...s, tolerance }))}
                  onSelect={select}
                />
              )}
            </>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>{t("error.title", { name: error.name })}</strong>
                <p>{errorText}</p>
                {(error.error.code === "needs-key" || error.error.code === "invalid-key") && (
                  <button
                    className="small"
                    onClick={() => {
                      retryPath.current = error.path ?? null;
                      setError(null);
                      setDialog("settings");
                    }}
                  >
                    {t("error.openSettings")}
                  </button>
                )}
              </div>
              <button className="tool icon-only" onClick={() => setError(null)} aria-label={t("error.dismiss")}>
                <CloseIcon />
              </button>
            </div>
          )}

          {update && (
            <div className="update-banner" role="status">
              <span>{t("update.available", { version: update.version })}</span>
              <button
                className="small primary"
                onClick={() => {
                  openExternal(update.url);
                  setUpdate(null);
                }}
              >
                {t("update.download")}
              </button>
              <button className="small" onClick={() => setUpdate(null)}>
                {t("update.later")}
              </button>
            </div>
          )}
          {toast && (
            <div className="toast" role="status">
              {toast}
            </div>
          )}

          {dragOver && <div className="drop-overlay">{t(dialog === "library" ? "library.dropHere" : "drop.hint")}</div>}
        </main>

        <StatusBar model={model} source={source} schematic={schematic} loading={loading} settings={settings} />

        {dialog === "settings" && (
          <SettingsDialog
            settings={settings}
            onChange={setSettings}
            onClose={() => {
              setDialog(null);
              const retry = retryPath.current;
              retryPath.current = null;
              if (retry && settings.xzzKey) void openPath(retry);
            }}
          />
        )}
        {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
        {dialog === "palette" && (
          <CommandPalette commands={paletteCommands()} model={model} onPick={(sel) => select(sel, true)} onClose={() => setDialog(null)} />
        )}
        {dialog === "library" && <LibraryDialog drop={libraryDrop} onOpen={openLibraryEntry} onClose={() => setDialog(null)} />}
      </div>
    </I18nContext.Provider>
  );
}
