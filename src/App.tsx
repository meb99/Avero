import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { BoardView, type BoardViewHandle, type PhotoLayer, type ViewState } from "./components/BoardView";
import { PhotoBoardHint, PhotoPointDialog } from "./components/PhotoAlign";
import { PhotoPane } from "./components/PhotoPane";
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
import { mapSelection } from "./core/compare";
import { search } from "./core/search";
import {
  BOARD_EXTENSIONS,
  loadDemo,
  loadPath,
  onFileDrop,
  onFinderOpen,
  pickImage,
  pickPath,
  readFileBytes,
  saveBytes,
  schematicsFor,
  setWindowTitle,
  type BoardSource,
  type Loaded,
} from "./core/loader";
import type { LoadError, Point, Selection, Side } from "./core/types";
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
import { pickImport, type LibraryEntry, type LibraryFile } from "./workbench/library";
import {
  addMarker,
  boardKey,
  idTokens,
  netStatuses,
  newMarkerId,
  removeMarker,
  renameNet,
  setPhoto,
  updateMarker,
  type NetStatus,
} from "./workbench/notes";
import { MarkerEditor, PinnedLegend } from "./components/Markers";
import { KnowledgePanel } from "./components/KnowledgePanel";
import {
  EMPTY_EXPORT,
  EMPTY_KNOWLEDGE,
  loadKnowledge,
  mergeKnowledge,
  pagesForBoard,
  pickKnowledgeFiles,
  saveKnowledge,
  type KnowledgeBase,
  withBuiltin,
  obdataFor,
} from "./knowledge/store";
import { linkObdata } from "./workbench/notes";
import { BUILTIN_PAGES } from "./knowledge/builtin";
import { guessCategory } from "./workbench/catalog";
import { PIN_COLORS } from "./render/palette";
import { alignPhoto } from "./workbench/photo";
import { loadPhotoImage } from "./workbench/photoImage";
import { useBoardNotes } from "./workbench/store";

const NONE: Selection = { kind: "none" };
const NO_NETS: number[] = [];
const DEMO_SCHEMATIC = `${import.meta.env.BASE_URL}demo/avero-demo-schematic.pdf`;
const WEBSITE = "https://github.com/meb99/Avero";
const TOAST_MS = 4000;

/** A photo being aligned: two points on the photo, then the same two on the board. */
interface PhotoAlignment {
  side: ViewSide;
  file: string;
  image: HTMLCanvasElement;
  /** True for a photo imported for this alignment (deleted when cancelled). */
  fresh: boolean;
  photoPoints: Point[];
  boardPoints: Point[];
}

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
  // Trace layers switched off, for the board they were chosen on.
  const [layerChoice, setLayerChoice] = useState<{ model: BoardModel | null; hidden: ReadonlySet<number> }>({
    model: null,
    hidden: new Set(),
  });
  const hiddenLayers = useMemo(
    () => (layerChoice.model === model ? layerChoice.hidden : new Set<number>()),
    [layerChoice, model],
  );
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
  // The "parts are encrypted" notice, dismissed per board.
  const [lockedDismissed, setLockedDismissed] = useState<BoardModel | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [schematic, setSchematic] = useState<SchematicDocument | null>(null);
  const [schematicVisible, setSchematicVisible] = useState(true);
  // The schematic is shown in its own window instead of the split view.
  const [detached, setDetached] = useState(false);
  const [focus, setFocus] = useState<SchematicFocus | null>(null);
  // Text searched in the schematic on request (library full-text search);
  // the next selection on the board replaces it.
  const [textQuery, setTextQuery] = useState<string | null>(null);
  // The active tab lives in the states above; `tabs` keeps the other tabs as
  // they were left (its entry for the active tab is stale).
  const [tabs, setTabs] = useState<Tab[]>(() => [emptyTab(0)]);
  const [activeTab, setActiveTab] = useState(0);
  const [initialView, setInitialView] = useState<ViewState | undefined>(undefined);
  // Another tab's board shown next to this one for comparison.
  const [compareTab, setCompareTab] = useState<number | null>(null);
  const compareViewRef = useRef<BoardViewHandle>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
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
  const compared = compareTab !== null && compareTab !== activeTab ? tabs.find((t) => t.id === compareTab) : undefined;
  const compareModel = compared?.model ?? null;
  const showSchematic = schematic !== null && schematicVisible && !detached && !compareModel;
  const compareSelection = useMemo(
    () => (model && compareModel ? mapSelection(model, compareModel, selection) : NONE),
    [model, compareModel, selection],
  );
  const { notes, update: updateNotes, error: notesError } = useBoardNotes(source);

  // Own net names (Net10 -> GND) live in the board notes and are applied to
  // the model in place; the revision makes name-sorted views refresh.
  const [namesRevision, setNamesRevision] = useState(0);
  const notesForModel = notes && source && notes.key === boardKey(source) ? notes : null;
  const netNames = notesForModel?.netNames;
  useEffect(() => {
    if (model && notesForModel && model.applyNetNames(netNames ?? {})) setNamesRevision((r) => r + 1);
    // notesForModel only matters as "the notes of this board have loaded".
  }, [model, netNames, notesForModel !== null]);

  // --- board photos ----------------------------------------------------------

  const [aligning, setAligning] = useState<PhotoAlignment | null>(null);
  const aligningRef = useRef(aligning);
  aligningRef.current = aligning;
  const [showPhoto, setShowPhoto] = useState(true);
  // The aligned photo beside the board: click a part on it to select it.
  const [photoPane, setPhotoPane] = useState(false);
  const storedPhoto = notes?.photos?.[side];
  const [photoImage, setPhotoImage] = useState<{ file: string; image: HTMLCanvasElement } | null>(null);
  const photoFile = storedPhoto?.file;
  useEffect(() => {
    if (!photoFile) return;
    let cancelled = false;
    loadPhotoImage(photoFile).then(
      (image) => !cancelled && setPhotoImage({ file: photoFile, image }),
      (e) => !cancelled && setToast(translator(lang)("photo.failed", { message: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      cancelled = true;
    };
  }, [photoFile, lang]);
  const photoLayer: PhotoLayer | undefined =
    storedPhoto && showPhoto && !aligning && photoImage?.file === storedPhoto.file
      ? { image: photoImage.image, matrix: storedPhoto.matrix, opacity: storedPhoto.opacity }
      : undefined;

  const startAlignment = async (file: string, fresh: boolean) => {
    try {
      const image = await loadPhotoImage(file);
      setAligning({ side, file, image, fresh, photoPoints: [], boardPoints: [] });
    } catch (e) {
      setToast(t("photo.failed", { message: e instanceof Error ? e.message : String(e) }));
      if (fresh) void invoke("remove_photo", { path: file }).catch(() => {});
    }
  };

  const addPhoto = async () => {
    if (!model || !notes) return;
    const path = await pickImage(t("photo.add"));
    if (!path) return;
    try {
      const file = await invoke<string>("import_photo", { key: notes.key, side, path });
      await startAlignment(file, true);
    } catch (e) {
      setToast(t("photo.failed", { message: String(e) }));
    }
  };

  const cancelAlignment = () => {
    const a = aligningRef.current;
    if (a?.fresh) void invoke("remove_photo", { path: a.file }).catch(() => {});
    setAligning(null);
  };

  const pickBoardPoint = (p: Point) => {
    const a = aligningRef.current;
    if (!a || a.photoPoints.length < 2) return;
    const boardPoints = [...a.boardPoints, p];
    if (boardPoints.length < 2) {
      setAligning({ ...a, boardPoints });
      return;
    }
    const matrix = alignPhoto(a.side, [a.photoPoints[0], a.photoPoints[1]], [boardPoints[0], boardPoints[1]]);
    if (!matrix) {
      setToast(t("photo.samePoints"));
      setAligning({ ...a, boardPoints: [] });
      return;
    }
    const previous = notes?.photos?.[a.side];
    updateNotes((n) => setPhoto(n, a.side, { file: a.file, matrix, opacity: previous?.opacity ?? 0.8 }));
    if (previous && previous.file !== a.file) void invoke("remove_photo", { path: previous.file }).catch(() => {});
    setAligning(null);
    setShowPhoto(true);
  };

  const removePhoto = () => {
    if (!storedPhoto) return;
    updateNotes((n) => setPhoto(n, side, undefined));
    void invoke("remove_photo", { path: storedPhoto.file }).catch(() => {});
  };

  // Measurement state by net index for the board overlay.
  const measured = useMemo(() => {
    const out = new Map<number, NetStatus>();
    if (!model || !notes) return out;
    for (const [name, status] of netStatuses(notes, settings.tolerance)) {
      const net = model.findNet(name);
      if (net !== undefined) out.set(net, status);
    }
    return out;
  }, [model, notes, settings.tolerance, namesRevision]);

  const renameModelNet = useCallback(
    (net: number, name: string): string | null => {
      if (!model || !notesForModel) return null;
      const target = name.trim() || model.fileNetName(net);
      const other = model.findNet(target);
      if (other !== undefined && other !== net) return t("details.nameTaken", { name: target });
      updateNotes((n) => renameNet(n, model.fileNetName(net), model.nets[net].name, target));
      return null;
    },
    [model, notesForModel, updateNotes, t],
  );

  // Nets pinned in their own colors, for the board they were pinned on.
  const [pinChoice, setPinChoice] = useState<{ model: BoardModel | null; nets: number[] }>({ model: null, nets: [] });
  const pinnedList = pinChoice.model === model ? pinChoice.nets : NO_NETS;
  const pinnedNets = useMemo(
    () => new Map(pinnedList.map((net, i) => [net, PIN_COLORS[i % PIN_COLORS.length]] as const)),
    [pinnedList],
  );
  const togglePinned = useCallback(
    (net: number) =>
      setPinChoice((c) => {
        const nets = c.model === model ? c.nets : [];
        return { model, nets: nets.includes(net) ? nets.filter((n) => n !== net) : [...nets, net] };
      }),
    [model],
  );

  // Notes pinned to spots on the board.
  const [placingMarker, setPlacingMarker] = useState(false);
  const [editingMarker, setEditingMarker] = useState<{ id: string; at: Point } | null>(null);
  const boardMarkers = notesForModel?.markers;
  const markerMarks = useMemo(() => boardMarkers ?? [], [boardMarkers]);
  const editedMarker = editingMarker ? boardMarkers?.find((m) => m.id === editingMarker.id) : undefined;
  const openMarker = useCallback((id: string) => {
    const m = boardMarkers?.find((x) => x.id === id);
    const at = m && viewRef.current?.toScreen(m);
    if (at) setEditingMarker({ id, at });
  }, [boardMarkers]);
  const placeMarker = useCallback(
    (point: Point) => {
      setPlacingMarker(false);
      if (!notesForModel) return;
      const id = newMarkerId();
      updateNotes((n) => addMarker(n, { id, x: point.x, y: point.y, side, text: "" }));
      const at = viewRef.current?.toScreen(point);
      if (at) setEditingMarker({ id, at });
    },
    [notesForModel, updateNotes, side],
  );
  const closeMarker = useCallback(() => {
    // A new marker left without text is not worth keeping.
    if (editedMarker && !editedMarker.text) updateNotes((n) => removeMarker(n, editedMarker.id));
    setEditingMarker(null);
  }, [editedMarker, updateNotes]);
  const showMarker = useCallback(
    (id: string) => {
      const m = boardMarkers?.find((x) => x.id === id);
      if (!m) return;
      setSide(m.side);
      viewRef.current?.zoomTo({ minX: m.x - 150, minY: m.y - 150, maxX: m.x + 150, maxY: m.y + 150 });
      // Open the note once the view has flown there.
      window.setTimeout(() => {
        const at = viewRef.current?.toScreen(m);
        if (at) setEditingMarker({ id, at });
      }, 360);
    },
    [boardMarkers],
  );

  const placingMarkerRef = useRef(placingMarker);
  placingMarkerRef.current = placingMarker;
  const togglePinnedRef = useRef(togglePinned);
  togglePinnedRef.current = togglePinned;

  // Repair knowledge (imported wiki pages), for the device in view.
  const [knowledge, setKnowledge] = useState<KnowledgeBase>(EMPTY_KNOWLEDGE);
  // What the panel shows: imported pages and Avero's reference pages.
  const knowledgeView = useMemo(() => withBuiltin(knowledge, BUILTIN_PAGES), [knowledge]);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState<string | null>(null);
  useEffect(() => {
    loadKnowledge()
      .then(setKnowledge)
      .catch(() => {
        // Outside the desktop app there is nothing stored.
      });
  }, []);
  const boardDevice = useMemo(() => guessCategory([source?.path ?? source?.name ?? ""]), [source]);
  const boardNumbers = useMemo(() => {
    const name = (source?.path ?? source?.name ?? "").split("/").slice(-2).join(" ");
    return idTokens(name.replace(/\.[^.]+$/, ""));
  }, [source]);
  const knowledgeForBoard = useMemo(
    () => pagesForBoard(knowledgeView, boardDevice, boardNumbers).length,
    [knowledgeView, boardDevice, boardNumbers],
  );
  // OpenBoardData for this board: chosen by hand, or matched by board number.
  const boardObdata = useMemo(
    () => obdataFor(knowledgeView, boardNumbers, notes?.obdata),
    [knowledgeView, boardNumbers, notes?.obdata],
  );
  const importKnowledge = useCallback(async () => {
    setKnowledgeBusy(true);
    setKnowledgeMessage(null);
    try {
      const picked = await pickKnowledgeFiles(t("kb.import"));
      const pages = picked.pages;
      const errors = picked.errors.map((e) => (e.endsWith(EMPTY_EXPORT) ? `${e.split(":")[0]}: ${t("kb.emptyExport")}` : e));
      if (pages.length) {
        const next = mergeKnowledge(knowledge, pages);
        await saveKnowledge(next);
        setKnowledge(next);
      }
      if (pages.length || errors.length)
        setKnowledgeMessage([pages.length ? t("kb.imported", { n: pages.length }) : "", ...errors].filter(Boolean).join(" · "));
    } catch (e) {
      setKnowledgeMessage(String(e));
    } finally {
      setKnowledgeBusy(false);
    }
  }, [knowledge, t]);

  // A page in the occurrence list: show the schematic there.
  const jumpInSchematic = useCallback((text: string, hit: number) => {
    setSchematicVisible(true);
    setFocus({ text, jump: true, hit, nonce: ++focusNonce.current });
  }, []);

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
    setTextQuery(null);
    setCompareTab(null);
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
      // Already open in a tab: show that tab (with the requested schematic).
      const openIn = tabsRef.current.find((t) => (t.id === live.current.id ? live.current : t).source?.path === path);
      if (openIn) {
        const shown = (openIn.id === live.current.id ? live.current : openIn).schematic?.path;
        switchTab(openIn.id);
        if (schematicPath && schematicPath !== shown) await openSchematicPath(schematicPath);
        return;
      }
      setLoading(fileName(path));
      const loaded = await loadPath(path, { xzzKey: settings.xzzKey, fzKey: settings.fzKey });
      // An open board stays; the new one gets its own tab.
      const inNewTab = loaded.result.ok && live.current.model !== null;
      const shownSchematic = inNewTab ? undefined : live.current.schematic?.path;
      if (inNewTab) newTab();
      if (!finishLoad(loaded)) return;
      const wanted = schematicPath ?? (settings.autoSchematic ? (await schematicsFor(path).catch(() => []))[0] : undefined);
      if (wanted && wanted !== shownSchematic) await openSchematicPath(wanted);
    },
    // switchTab and newTab only use refs and setters.
    [finishLoad, openSchematicPath, settings.autoSchematic, settings.xzzKey, settings.fzKey],
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

  // Selects the first part, net or pin matching this text once the board is shown.
  const pendingBoardSearch = useRef<string | null>(null);

  const openLibraryText = useCallback(
    async (entry: LibraryEntry, file: LibraryFile, query: string) => {
      setDialog(null);
      // A hit in a boardview: open it and select the part or net.
      if (!/\.pdf$/i.test(file.name)) {
        pendingBoardSearch.current = query;
        await openPath(file.path, entry.schematics[0]?.path);
        return;
      }
      const board = entry.boards[0]?.path;
      if (board) await openPath(board, file.path);
      else await openSchematicPath(file.path);
      setSchematicVisible(true);
      setTextQuery(query);
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
      setTextQuery(null);
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

  // A pending hit from the library search, once its board is shown.
  useEffect(() => {
    const q = pendingBoardSearch.current;
    if (!model || !q) return;
    pendingBoardSearch.current = null;
    const [hit] = search(model, q, 1);
    if (hit) select(hit.selection, true);
  }, [model, select]);

  // Board selection -> schematic.
  useEffect(() => {
    const jump = !pickedInSchematic.current;
    pickedInSchematic.current = false;
    if (textQuery) {
      setFocus({ text: textQuery, jump: true, partial: true, nonce: ++focusNonce.current });
      return;
    }
    const text = model ? focusText(model, selection) : undefined;
    setFocus(text ? { text, jump, nonce: ++focusNonce.current } : null);
  }, [model, selection, textQuery]);

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
    // namesRevision: own net names change the model's names in place.
  }, [schematic, model, namesRevision]);
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

  // --- comparison ----------------------------------------------------------

  // The compared board follows the selection.
  useEffect(() => {
    const bounds = compareModel?.selectionBounds(compareSelection);
    if (bounds) compareViewRef.current?.zoomTo(bounds);
  }, [compareModel, compareSelection]);

  const comparable = tabs.filter((t) => t.id !== activeTab && t.model !== null);

  const toggleCompare = () => {
    if (compareModel) setCompareTab(null);
    else if (comparable.length === 1) setCompareTab(comparable[0].id);
    else if (comparable.length > 1) {
      setPaletteQuery(t("compare.prefix"));
      setDialog("palette");
    } else setToast(t("compare.needsTabs"));
  };

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

  const exportPdf = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !source) return;
    try {
      const [{ viewPdf }, blob] = await Promise.all([import("./workbench/viewPdf"), view.snapshot()]);
      const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date());
      const sideText = t(side === "top" ? "side.top" : "side.bottom");
      const notesOnBoard = (boardMarkers ?? [])
        .filter((m) => m.text)
        .map((m) => `${t(m.side === "top" ? "side.top" : "side.bottom")}: ${m.text}`);
      const bytes = await viewPdf({
        image: new Uint8Array(await blob.arrayBuffer()),
        title: source.name,
        subtitle: `${sideText} · ${date}`,
        notesTitle: t("marker.list"),
        notes: notesOnBoard,
        footer: t("report.footer"),
        legend: model ? [...pinnedNets].map(([net, color]) => ({ name: model.nets[net].name, color })) : [],
      });
      const base = source.name.replace(/\.[^.]+$/, "");
      const path = await saveBytes(bytes, t("menu.exportPdf"), `${base}-${side}.pdf`, { name: "PDF", extensions: ["pdf"] });
      if (path) setToast(t("export.saved", { name: fileName(path) }));
    } catch (e) {
      setToast(t("export.failed", { message: e instanceof Error ? e.message : String(e) }));
    }
  }, [source, side, t, lang, boardMarkers, model, pinnedNets]);

  // Set below, once installUpdate exists; checkUpdates only calls it later.
  const installUpdateRef = useRef<(found: Update) => Promise<void>>(async () => {});
  const checkUpdates = useCallback(
    async (manual: boolean) => {
      if (!manual) {
        setUpdate(await dailyCheck(__APP_VERSION__));
        return;
      }
      // A manual check always answers with a native dialog.
      setToast(t("update.checking"));
      const { ask, message } = await import("@tauri-apps/plugin-dialog");
      try {
        const found = await fetchUpdate(__APP_VERSION__);
        setToast(null);
        if (!found) {
          await message(t("update.none", { version: __APP_VERSION__ }), { title: "Avero", kind: "info" });
          return;
        }
        setUpdate(found);
        const yes = await ask(t("update.ask", { version: found.version, current: __APP_VERSION__ }), {
          title: "Avero",
          kind: "info",
          okLabel: t("update.install"),
          cancelLabel: t("update.later"),
        });
        if (yes) await installUpdateRef.current(found);
      } catch (e) {
        setToast(null);
        const text = t("update.failed", { message: e instanceof Error ? e.message : String(e) });
        await message(text, { title: "Avero", kind: "warning" }).catch(() => setToast(text));
      }
    },
    [t],
  );

  const importToLibrary = useCallback(async () => {
    setDialog("library");
    const paths = await pickImport(t("library.import"), BOARD_EXTENSIONS);
    if (paths.length > 0) setLibraryDrop((d) => ({ paths, nonce: (d?.nonce ?? 0) + 1 }));
  }, [t]);

  // Downloads the release, replaces the app and restarts it (see updater.rs).
  const installUpdate = async (found: Update) => {
    setInstalling(true);
    try {
      await invoke("install_update", { version: found.version });
    } catch (e) {
      setInstalling(false);
      setToast(t("update.failedInstall", { message: String(e) }));
      openExternal(found.url);
    }
  };

  installUpdateRef.current = installUpdate;

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
    exportPdf: () => void exportPdf(),
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
    addPhoto: () => void addPhoto(),
    togglePhoto: () => setShowPhoto((v) => !v),
    compare: toggleCompare,
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
      { id: "export-pdf", label: t("menu.exportPdf"), shortcut: "⌥⌘E", enabled: board, run: a.exportPdf },
      { id: "marker", label: t("marker.place"), shortcut: "M", enabled: board && notes !== null, run: () => setPlacingMarker(true) },
      { id: "photo-add", label: t("photo.add"), enabled: board && notes !== null, run: a.addPhoto },
      { id: "photo-toggle", label: t("photo.toggle"), enabled: !!storedPhoto, run: a.togglePhoto },
      { id: "photo-pane", label: t("photo.paneCommand"), enabled: !!model, run: () => setPhotoPane((v) => !v) },
      { id: "photo-realign", label: `${t("photo.title")}: ${t("photo.realign")}`, enabled: !!storedPhoto, run: () => storedPhoto && void startAlignment(storedPhoto.file, false) },
      { id: "photo-remove", label: `${t("photo.title")}: ${t("photo.remove")}`, enabled: !!storedPhoto, run: removePhoto },
      { id: "new-tab", label: t("tabs.new"), shortcut: "⌘T", run: a.newTab },
      { id: "close", label: t("tabs.close"), shortcut: "⌘W", enabled: board || schematic !== null, run: a.closeBoard },
      { id: "settings", label: t("menu.settings"), shortcut: "⌘,", run: a.settings },
      { id: "shortcuts", label: t("menu.shortcuts"), shortcut: "⌘/", run: a.shortcuts },
      { id: "updates", label: t("menu.checkUpdates"), run: a.checkUpdates },
      { id: "website", label: t("menu.website"), run: a.website },
      ...(compareModel ? [{ id: "compare-stop", label: t("compare.stop"), run: () => setCompareTab(null) }] : []),
      ...comparable.map((tab) => ({
        id: `compare-${tab.id}`,
        label: `${t("compare.prefix")} ${tabInfos.find((i) => i.id === tab.id)?.title ?? ""}`,
        run: () => setCompareTab(tab.id),
      })),
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
          if (aligningRef.current) cancelAlignment();
          else if (placingMarkerRef.current) setPlacingMarker(false);
          else setSelection(NONE);
          break;
        case "m":
        case "M":
          if (model) setPlacingMarker((v) => !v);
          break;
        case "p":
        case "P": {
          const net = model?.selectedNet(selection);
          if (net !== undefined) togglePinnedRef.current(net);
          break;
        }
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
          placingMarker={placingMarker}
          onMarker={() => setPlacingMarker((v) => !v)}
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
                    hiddenLayers={hiddenLayers}
                    namesRevision={namesRevision}
                    pinnedNets={pinnedNets}
                    markers={markerMarks}
                    activeMarker={editingMarker?.id ?? null}
                    onMarkerClick={openMarker}
                    measured={measured}
                    initialView={initialView}
                    photo={photoLayer}
                    onPointPick={
                      placingMarker ? placeMarker : aligning && aligning.photoPoints.length >= 2 ? pickBoardPoint : undefined
                    }
                    onSelect={select}
                  >
                    {placingMarker && <div className="placing-hint">{t("marker.placing")}</div>}
                    <PinnedLegend
                      model={model}
                      pinned={pinnedNets}
                      onSelect={(net) => select({ kind: "net", net }, true)}
                      onUnpin={togglePinned}
                    />
                    {editingMarker && editedMarker && (
                      <MarkerEditor
                        marker={editedMarker}
                        at={editingMarker.at}
                        onSave={(text) => {
                          updateNotes((n) => (text ? updateMarker(n, editedMarker.id, text) : removeMarker(n, editedMarker.id)));
                          setEditingMarker(null);
                        }}
                        onDelete={() => {
                          updateNotes((n) => removeMarker(n, editedMarker.id));
                          setEditingMarker(null);
                        }}
                        onClose={closeMarker}
                      />
                    )}
                  </BoardView>
                ) : (
                  !showSchematic && <div className="board-placeholder">{t("welcome.open")}</div>
                )}
                {model && compareModel && compared && (
                  <>
                    <Splitter
                      container={workAreaRef}
                      share={share}
                      onDrag={setShare}
                      onDone={(s) => setSettings((old) => ({ ...old, schematicShare: s }))}
                    />
                    <div className="compare-pane" style={{ width: `${share * 100}%` }}>
                      <header className="compare-bar">
                        <span className="compare-name" title={compared.source?.path}>
                          {t("compare.title")}: <strong>{compared.source?.name}</strong>
                        </span>
                        {selection.kind !== "none" && compareSelection.kind === "none" && (
                          <span className="muted">{t("compare.missing")}</span>
                        )}
                        <span className="schematic-spacer" />
                        <button className="tool icon-only" onClick={() => setCompareTab(null)} aria-label={t("compare.stop")} title={t("compare.stop")}>
                          <CloseIcon />
                        </button>
                      </header>
                      <BoardView
                        ref={compareViewRef}
                        model={compareModel}
                        side={side}
                        rotation={rotation}
                        selection={compareSelection}
                        settings={settings}
                        palette={palette}
                        initialView={compared.view}
                        onSelect={(sel, zoom) => select(mapSelection(compareModel, model, sel), zoom)}
                      />
                    </div>
                  </>
                )}
                {model && photoPane && !aligning && (
                  <>
                    <Splitter
                      container={workAreaRef}
                      share={share}
                      onDrag={setShare}
                      onDone={(s) => setSettings((old) => ({ ...old, schematicShare: s }))}
                    />
                    <div className="compare-pane" style={{ width: `${share * 100}%` }}>
                      {storedPhoto && photoImage?.file === storedPhoto.file ? (
                        <PhotoPane
                          image={photoImage.image}
                          matrix={storedPhoto.matrix}
                          model={model}
                          side={side}
                          selection={selection}
                          onSelect={select}
                          onClose={() => setPhotoPane(false)}
                        />
                      ) : (
                        <div className="photo-pane-empty">
                          <p>{t(side === "top" ? "photo.noneTop" : "photo.noneBottom")}</p>
                          <div className="photo-pane-actions">
                            {notes && (
                              <button className="small primary" onClick={() => void addPhoto()}>
                                {t("photo.add")}
                              </button>
                            )}
                            <button className="small" onClick={() => setPhotoPane(false)}>
                              {t("photo.paneClose")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
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
                  palette={palette}
                  hiddenLayers={hiddenLayers}
                  onHiddenLayers={(hidden) => setLayerChoice({ model, hidden })}
                  schematic={schematic}
                  onSchematicJump={jumpInSchematic}
                  onRenameNet={renameModelNet}
                  namesRevision={namesRevision}
                  pinnedNets={pinnedNets}
                  onTogglePin={togglePinned}
                  onShowMarker={showMarker}
                  obdata={boardObdata?.obdata ?? null}
                  knowledgeCount={knowledgeForBoard}
                  knowledge={
                    <KnowledgePanel
                      model={model}
                      base={knowledgeView}
                      device={boardDevice}
                      boardNumbers={boardNumbers}
                      busy={knowledgeBusy}
                      message={knowledgeMessage}
                      onImport={() => void importKnowledge()}
                      onRemove={(page) => {
                        const next = { ...knowledge, pages: knowledge.pages.filter((x) => x !== page) };
                        setKnowledge(next);
                        void saveKnowledge(next).catch((e) => setKnowledgeMessage(String(e)));
                      }}
                      onOpenUrl={(url) => openExternal(url)}
                      onSelect={select}
                      boardObdata={boardObdata?.obdata?.id ?? null}
                      chosenObdata={notes?.obdata ?? null}
                      onChooseObdata={notes ? (id) => updateNotes((n) => linkObdata(n, id)) : undefined}
                    />
                  }
                />
              )}
            </>
          )}

          {!error && model && (model.board.lockedParts ?? 0) > 0 && lockedDismissed !== model && (
            <div className="error-banner info-banner" role="status">
              <div>
                <strong>{t("locked.title", { n: model.board.lockedParts ?? 0 })}</strong>
                <p>{t("locked.text")}</p>
                <button className="small" onClick={() => setDialog("settings")}>
                  {t("error.openSettings")}
                </button>
              </div>
              <button className="tool icon-only" onClick={() => setLockedDismissed(model)} aria-label={t("error.dismiss")}>
                <CloseIcon />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>{t("error.title", { name: error.name })}</strong>
                <p>{errorText}</p>
                {["needs-key", "invalid-key", "needs-fz-key", "invalid-fz-key", "xzz-all-locked"].includes(error.error.code) && (
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

          {aligning && aligning.photoPoints.length >= 2 && (
            <PhotoBoardHint
              image={aligning.image}
              point={aligning.photoPoints[aligning.boardPoints.length]}
              index={aligning.boardPoints.length}
              onCancel={cancelAlignment}
            />
          )}
          {model && storedPhoto && !aligning && (
            <div className="photo-bar">
              <span>{t("photo.title")}</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={storedPhoto.opacity}
                aria-label={t("photo.opacity")}
                disabled={!showPhoto}
                onChange={(e) => {
                  const opacity = Number(e.target.value);
                  updateNotes((n) => (n.photos?.[side] ? setPhoto(n, side, { ...n.photos[side], opacity }) : n));
                }}
              />
              <button className="small" onClick={() => setShowPhoto((v) => !v)}>
                {showPhoto ? t("photo.hide") : t("photo.show")}
              </button>
              <button className={photoPane ? "small on" : "small"} onClick={() => setPhotoPane((v) => !v)} title={t("photo.paneHint")}>
                {t("photo.pane")}
              </button>
              <button className="small" onClick={() => void startAlignment(storedPhoto.file, false)}>
                {t("photo.realign")}
              </button>
              <button className="small" onClick={removePhoto}>
                {t("photo.remove")}
              </button>
            </div>
          )}
          {update && (
            <div className="update-banner" role="status">
              <span>{installing ? t("update.installing", { version: update.version }) : t("update.available", { version: update.version })}</span>
              {!installing && (
                <>
                  <button className="small primary" onClick={() => void installUpdate(update)}>
                    {t("update.install")}
                  </button>
                  <button className="small" onClick={() => setUpdate(null)}>
                    {t("update.later")}
                  </button>
                </>
              )}
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
            onCheckUpdates={() => void checkUpdates(true)}
            onClose={() => {
              setDialog(null);
              const retry = retryPath.current;
              retryPath.current = null;
              if (retry && (settings.xzzKey || settings.fzKey)) void openPath(retry);
            }}
          />
        )}
        {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
        {aligning && aligning.photoPoints.length < 2 && (
          <PhotoPointDialog
            image={aligning.image}
            points={aligning.photoPoints}
            onPoint={(p) => setAligning((a) => a && { ...a, photoPoints: [...a.photoPoints, p] })}
            onCancel={cancelAlignment}
          />
        )}
        {dialog === "palette" && (
          <CommandPalette
            commands={paletteCommands()}
            model={model}
            initialQuery={paletteQuery}
            onPick={(sel) => select(sel, true)}
            onClose={() => {
              setDialog(null);
              setPaletteQuery("");
            }}
          />
        )}
        {dialog === "library" && <LibraryDialog drop={libraryDrop} onOpen={openLibraryEntry} onOpenText={(e, f, q) => void openLibraryText(e, f, q)} onClose={() => setDialog(null)} />}
      </div>
    </I18nContext.Provider>
  );
}
