import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AskHost, askText } from "./components/Ask";
import { copyText } from "./core/clipboard";
import { netsCsv, partsCsv, readingsCsv } from "./workbench/csvExport";
import { answerMcp, type McpContext } from "./workbench/mcpTools";
import { MCP_DEFAULT_PORT } from "./workbench/mcp";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { BoardView, type BoardViewHandle, type PhotoLayer, type ViewState } from "./components/BoardView";
import { PhotoBoardHint, PhotoPointDialog } from "./components/PhotoAlign";
import { PhotoPane } from "./components/PhotoPane";
import { ImportReport } from "./components/ImportReport";
import { BgaView } from "./components/BgaView";
import { DiffView } from "./components/DiffView";
import { DonorView } from "./components/DonorView";
import { DatasheetPane } from "./components/DatasheetPane";
import { CameraPane } from "./components/CameraPane";
import { connectMeter, meterState, METER_VALUE_EVENT, readMeter } from "./workbench/meter";
import type { Quantity } from "./workbench/measure";
import { newDatasheetId, parseDatasheets, partNumbers, type Datasheet } from "./workbench/datasheets";
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
import { BoardModel, netSides, type ViewSide } from "./core/board";
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
import { installMenu, menuOwnsKey, type MenuActions } from "./menu";
import { closeSchematicWindow, LINK, openSchematicWindow, type LinkedDoc } from "./schematic/link";
import { DARK, LIGHT, withColors } from "./render/palette";
import { setPdfPasswordPrompt, type SchematicDocument } from "./schematic/document";
import { readSchematicFacts, type SchematicFacts } from "./schematic/partInfo";
import { SchematicView, type SchematicFocus, type SchematicViewHandle, type WordTarget } from "./schematic/SchematicView";
import type { Word } from "./schematic/textIndex";
import { clearRecent, loadRecent, loadSettings, rememberRecent, saveSettings, type Settings } from "./settings";
import { useTheme } from "./theme";
import { dailyCheck, fetchUpdate, type Update } from "./updates";
import { pickImport, type LibraryEntry, type LibraryFile } from "./workbench/library";
import {
  activeCase,
  addBookmark,
  addCase,
  addDrawing,
  addMarker,
  boardKey,
  idTokens,
  netStatuses,
  newMarkerId,
  removeMarker,
  renameNet,
  setPhoto,
  updateCase,
  updateMarker,
  type Bookmark,
  type DrawingKind,
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
import { linkObdata, listProgress } from "./workbench/notes";
import { actionFor, bindings, isModifierOnly, keyName, worksWhileTyping, type ShortcutAction } from "./shortcuts";
import { loadStore, saveStore } from "./workbench/appStore";
import { parseWorkspace, type Workspace, type WorkspaceTab } from "./workbench/workspace";
import { BUILTIN_PAGES } from "./knowledge/builtin";
import { guessCategory } from "./workbench/catalog";
import { PIN_COLORS } from "./render/palette";
import { alignFromPoints, fitToBounds } from "./workbench/photo";
import { boardInPicture, loadPhotoImage, renderPageImage } from "./workbench/photoImage";
import { useBoardNotes } from "./workbench/store";

const NONE: Selection = { kind: "none" };
const NO_NETS: number[] = [];
const DEMO_SCHEMATIC = `${import.meta.env.BASE_URL}demo/avero-demo-schematic.pdf`;
const WEBSITE = "https://github.com/meb99/Avero";
const TOAST_MS = 4000;

/** Focus is in a text field: undo belongs to its text. */
function editingText(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** A photo being aligned: two points on the photo, then the same two on the board. */
interface PhotoAlignment {
  side: ViewSide;
  file: string;
  image: HTMLCanvasElement;
  /** True for a photo imported for this alignment (deleted when cancelled). */
  fresh: boolean;
  /** Points to pick: 2 (straight photo), 3 (slightly squashed), 4 (taken at an angle). */
  count: 2 | 3 | 4;
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

const sameSelection = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

/** A selection as text the search understands ("U3000", "U3000.21", "PP3V3"), for bookmarks and copying. */
function selectionText(model: BoardModel, sel: Selection): string | undefined {
  switch (sel.kind) {
    case "part":
      return model.parts[sel.part].name;
    case "pin": {
      const pin = model.pins[sel.pin];
      return `${model.parts[pin.part].name}.${pin.number}`;
    }
    case "net":
      return model.nets[sel.net].name;
    case "testPoint": {
      const tp = model.testPoints[sel.testPoint];
      return tp.name ?? model.nets[tp.net]?.name;
    }
    default:
      return undefined;
  }
}

/** Back and forward through what was selected, per board. */
interface NavHistory {
  items: Selection[];
  at: number;
}

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
  const bothSides = settings.bothSides;
  const splitViews = bothSides && settings.bothSidesMode !== "together";
  const splitViewsRef = useRef(splitViews);
  splitViewsRef.current = splitViews;
  const setBothSides = (on: boolean) => setSettings((old) => (old.bothSides === on ? old : { ...old, bothSides: on }));
  /** Oben / Unten are switched on and off on their own; at least one stays on. */
  const toggleSide = (clicked: ViewSide) => {
    if (bothSides) {
      setBothSides(false);
      setSide(clicked === "top" ? "bottom" : "top");
    } else if (side !== clicked) setBothSides(true);
  };
  /** The other side alone. */
  const flipSide = () => {
    setBothSides(false);
    setSide((s) => (s === "top" ? "bottom" : "top"));
  };
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
  const [dialog, setDialog] = useState<"settings" | "help" | "library" | "palette" | "report" | null>(null);
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
  // The aligned photo beside the board (click a part on it to select it);
  // it takes the schematic's place, two panes would squeeze the board.
  const [photoPane, setPhotoPane] = useState(false);
  // A datasheet beside the board, in the schematic's place as well.
  const [sheetPane, setSheetPane] = useState<{ doc: SchematicDocument; sheet: Datasheet; page: number } | null>(null);
  // Live picture of a USB microscope or camera, in the same place.
  const [cameraPane, setCameraPane] = useState(false);
  // The board view put away while a second view (schematic, photo, other
  // board, datasheet, camera) takes the whole width.
  const [boardHidden, setBoardHidden] = useState(false);
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
  // The bottom side's own view when both sides are shown in two views.
  const viewRef2 = useRef<BoardViewHandle>(null);
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
  const ownColors = settings.colors?.[theme];
  const palette = useMemo(() => withColors(theme === "dark" ? DARK : LIGHT, ownColors), [theme, ownColors]);
  const compared = compareTab !== null && compareTab !== activeTab ? tabs.find((t) => t.id === compareTab) : undefined;
  const compareModel = compared?.model ?? null;
  const showSchematic = schematic !== null && schematicVisible && !detached && !compareModel && !photoPane && !sheetPane && !cameraPane;
  const compareSelection = useMemo(
    () => (model && compareModel ? mapSelection(model, compareModel, selection) : NONE),
    [model, compareModel, selection],
  );
  const { notes, update: updateNotes, undo: undoNotes, redo: redoNotes, error: notesError } = useBoardNotes(source);

  // Own net names (Net10 -> GND) live in the board notes and are applied to
  // the model in place; the revision makes name-sorted views refresh.
  const [namesRevision, setNamesRevision] = useState(0);
  const notesForModel = notes && source && notes.key === boardKey(source) ? notes : null;
  const netNames = notesForModel?.netNames;
  useEffect(() => {
    if (model && notesForModel && model.applyNetNames(netNames ?? {})) setNamesRevision((r) => r + 1);
    // notesForModel only matters as "the notes of this board have loaded".
  }, [model, netNames, notesForModel !== null]);

  // --- facts from the schematic's text ---------------------------------------
  // Values, part numbers and net voltages, read once the schematic is indexed.
  const [schematicFacts, setSchematicFacts] = useState<SchematicFacts | null>(null);
  useEffect(() => {
    setSchematicFacts(null);
    if (!schematic || !model) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const parts = new Set(model.parts.map((p) => p.name.toUpperCase()));
      const nets = new Set<string>();
      model.nets.forEach((n, i) => {
        nets.add(n.name.toUpperCase());
        nets.add(model.fileNetName(i).toUpperCase());
      });
      // After the current frame: a big schematic takes a moment.
      window.setTimeout(() => !cancelled && setSchematicFacts(readSchematicFacts(schematic.index, parts, nets)), 0);
    };
    if (schematic.indexComplete) run();
    const off = schematic.subscribe(() => {
      if (schematic.indexComplete) run();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [schematic, model]);
  /** Value shown under a part's name on the board: the schematic's when it has one. */
  const partValues = useMemo(() => {
    const out = new Map<number, string>();
    if (!schematicFacts || !model) return out;
    model.parts.forEach((p, i) => {
      const f = schematicFacts.parts.get(p.name.toUpperCase());
      const text = [f?.value ?? f?.partNumber, f?.value && f.rating].filter(Boolean).join(" ");
      if (text) out.set(i, text);
    });
    return out;
  }, [schematicFacts, model]);

  // --- board photos ----------------------------------------------------------

  const [aligning, setAligning] = useState<PhotoAlignment | null>(null);
  const aligningRef = useRef(aligning);
  aligningRef.current = aligning;
  const [showPhoto, setShowPhoto] = useState(true);
  const storedPhoto = notes?.photos?.[side];
  // Something next to the board that can have the whole width.
  const secondView = model !== null && (showSchematic || !!compareModel || sheetPane !== null || cameraPane || (photoPane && !aligning));
  const boardAway = boardHidden && secondView;
  // Back to normal once nothing is beside the board any more.
  useEffect(() => {
    if (boardHidden && !secondView) setBoardHidden(false);
  }, [boardHidden, secondView]);
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
      ? { image: photoImage.image, matrix: storedPhoto.matrix, perspective: storedPhoto.perspective, opacity: storedPhoto.opacity }
      : undefined;

  const startAlignment = async (file: string, fresh: boolean) => {
    try {
      const image = await loadPhotoImage(file);
      setAligning({ side, file, image, fresh, count: settings.photoPoints ?? 2, photoPoints: [], boardPoints: [] });
    } catch (e) {
      setToast(t("photo.failed", { message: e instanceof Error ? e.message : String(e) }));
      if (fresh) void invoke("remove_photo", { path: file }).catch(() => {});
    }
  };

  /** Deletes a stored photo unless the other side still shows it. */
  const dropPhotoFile = (file: string, keep: (string | undefined)[]) => {
    if (!keep.includes(file)) void invoke("remove_photo", { path: file }).catch(() => {});
  };

  /**
   * The board picture in the open PDF (some boardviews come with one) as
   * the photo of both sides: laid onto the board outline right away when
   * the shapes match, otherwise aligned by hand.
   */
  const photoFromPdf = async () => {
    if (!model || !notes || !schematic) return;
    try {
      const page = schematicViewRef.current?.currentPage() ?? 0;
      const { canvas, png } = await renderPageImage(schematic, page);
      const file = await invoke<string>("store_photo_png", png, {
        headers: { "x-key": encodeURIComponent(notes.key), "x-side": "top" },
      });
      const box = boardInPicture(canvas);
      const matrix = box && fitToBounds(box, canvas.width, model.board.bounds);
      if (!matrix) {
        setToast(t("photo.pdfManual"));
        await startAlignment(file, true);
        return;
      }
      const old = notes.photos ?? {};
      const opacity = old.top?.opacity ?? old.bottom?.opacity ?? 0.8;
      updateNotes((n) => setPhoto(setPhoto(n, "top", { file, matrix, opacity }), "bottom", { file, matrix, opacity }));
      for (const previous of [old.top?.file, old.bottom?.file]) if (previous) dropPhotoFile(previous, [file]);
      setShowPhoto(true);
      setPhotoPane(true);
      setToast(t("photo.pdfDone"));
    } catch (e) {
      setToast(t("photo.failed", { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  const addPhoto = async () => {
    // Never fail silently: say why nothing can happen.
    if (!model) return setToast(t("photo.noBoard"));
    if (!notes) return setToast(t("photo.notesLoading"));
    try {
      if (schematic) {
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const usePdf = await ask(t("photo.pdfAsk", { name: schematic.name }), {
          title: t("photo.add"),
          kind: "info",
          okLabel: t("photo.pdfUse"),
          cancelLabel: t("photo.pickFile"),
        });
        if (usePdf) return void (await photoFromPdf());
      }
      const folder = source?.path?.replace(/\/[^/]*$/, "");
      const path = await pickImage(t("photo.add"), folder);
      if (!path) return;
      const file = await invoke<string>("import_photo", { key: notes.key, side, path });
      await startAlignment(file, true);
    } catch (e) {
      setToast(t("photo.failed", { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  const cancelAlignment = () => {
    const a = aligningRef.current;
    if (a?.fresh) void invoke("remove_photo", { path: a.file }).catch(() => {});
    setAligning(null);
  };

  const pickBoardPoint = (p: Point) => {
    const a = aligningRef.current;
    if (!a || a.photoPoints.length < a.count) return;
    const boardPoints = [...a.boardPoints, p];
    if (boardPoints.length < a.count) {
      setAligning({ ...a, boardPoints });
      return;
    }
    const alignment = alignFromPoints(a.side, a.photoPoints, boardPoints);
    if (!alignment) {
      setToast(t("photo.samePoints"));
      setAligning({ ...a, boardPoints: [] });
      return;
    }
    const previous = notes?.photos?.[a.side];
    updateNotes((n) => setPhoto(n, a.side, { file: a.file, ...alignment, opacity: previous?.opacity ?? 0.8 }));
    if (previous && previous.file !== a.file) dropPhotoFile(previous.file, [notes?.photos?.[a.side === "top" ? "bottom" : "top"]?.file]);
    setAligning(null);
    setShowPhoto(true);
  };

  const removePhoto = () => {
    if (!storedPhoto) return;
    updateNotes((n) => setPhoto(n, side, undefined));
    dropPhotoFile(storedPhoto.file, [notes?.photos?.[side === "top" ? "bottom" : "top"]?.file]);
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
    (point: Point, clicked: ViewSide = side) => {
      setPlacingMarker(false);
      if (!notesForModel) return;
      const id = newMarkerId();
      updateNotes((n) => addMarker(n, { id, x: point.x, y: point.y, side: clicked, text: "" }));
      const at = viewRef.current?.toScreen(point, clicked);
      if (at) setEditingMarker({ id, at });
    },
    [notesForModel, updateNotes, side],
  );

  // --- drawings: lines, areas, jumpers ---------------------------------------
  const [drawing, setDrawing] = useState<{ kind: DrawingKind; side: ViewSide; points: Point[]; ends: string[] } | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  /** "U7.3 · PP3V3" for a point on a pin, else "". */
  const pointLabel = (p: Point): string => {
    if (!model) return "";
    let label = "";
    model.pinIndex.query({ minX: p.x - 0.5, minY: p.y - 0.5, maxX: p.x + 0.5, maxY: p.y + 0.5 }, (i) => {
      const pin = model.pins[i];
      if (!label && Math.abs(pin.x - p.x) < 0.5 && Math.abs(pin.y - p.y) < 0.5) label = `${model.pinLabel(i)} · ${model.nets[pin.net].name}`;
    });
    return label;
  };
  const finishDrawing = useCallback(
    (d: { kind: DrawingKind; side: ViewSide; points: Point[]; ends: string[] }) => {
      setDrawing(null);
      if (d.points.length < (d.kind === "area" ? 3 : 2)) return;
      updateNotes((n) =>
        addDrawing(n, {
          kind: d.kind,
          side: d.side,
          points: d.points,
          ...(d.kind === "jumper" && { from: d.ends[0] || undefined, to: d.ends[1] || undefined }),
        }),
      );
    },
    [updateNotes],
  );
  const pickDrawPoint = (point: Point, clicked: ViewSide) => {
    const d = drawingRef.current;
    if (!d) return;
    const next = { ...d, side: d.points.length ? d.side : clicked, points: [...d.points, point], ends: [...d.ends, pointLabel(point)] };
    if (next.kind !== "area" && next.points.length >= 2) finishDrawing(next);
    else setDrawing(next);
  };
  const startDrawing = (kind: DrawingKind) => {
    setPlacingMarker(false);
    setDrawing({ kind, side, points: [], ends: [] });
  };
  // The ruler: two points, their distance; nothing is stored.
  const [ruler, setRuler] = useState<{ side: ViewSide; points: Point[] } | null>(null);
  const rulerRef = useRef(ruler);
  rulerRef.current = ruler;
  const pickRulerPoint = (point: Point, clicked: ViewSide) =>
    setRuler((r) => (!r ? r : r.points.length >= 2 ? { side: clicked, points: [point] } : { side: r.points.length ? r.side : clicked, points: [...r.points, point] }));
  const rulerText = useMemo(() => {
    if (!ruler || ruler.points.length < 2) return null;
    const [a, b] = ruler.points;
    const mm = (v: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format((v * 25.4) / 1000);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      label: `${mm(d)} mm`,
      detail: t("ruler.result", { mm: mm(d), mil: Math.round(d), dx: mm(Math.abs(b.x - a.x)), dy: mm(Math.abs(b.y - a.y)) }),
    };
  }, [ruler, lang, t]);
  // The ruler's line with its length, beside the stored drawings.
  const rulerMark =
    ruler && ruler.points.length === 2 && rulerText ? { id: "ruler", kind: "line" as const, side: ruler.side, points: ruler.points, text: rulerText.label } : null;
  const drawingMarks = useMemo(
    () => (notesForModel?.drawings ?? []).map((d) => ({ id: d.id, kind: d.kind, side: d.side, points: d.points, text: d.text ?? (d.kind === "jumper" ? undefined : undefined) })),
    [notesForModel?.drawings],
  );
  const boardDrawings = useMemo(() => (rulerMark ? [...drawingMarks, rulerMark] : drawingMarks), [drawingMarks, rulerMark?.text, rulerMark?.points]);
  const showDrawing = useCallback(
    (id: string) => {
      const d = notesForModel?.drawings?.find((x) => x.id === id);
      if (!d) return;
      setSide(d.side);
      const xs = d.points.map((p) => p.x);
      const ys = d.points.map((p) => p.y);
      viewRef.current?.zoomTo({ minX: Math.min(...xs) - 100, minY: Math.min(...ys) - 100, maxX: Math.max(...xs) + 100, maxY: Math.max(...ys) + 100 }, d.side);
    },
    [notesForModel?.drawings],
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
      viewRef.current?.zoomTo({ minX: m.x - 150, minY: m.y - 150, maxX: m.x + 150, maxY: m.y + 150 }, m.side);
      // Open the note once the view has flown there.
      window.setTimeout(() => {
        const at = viewRef.current?.toScreen(m, m.side);
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
    setPhotoPane(false);
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
      setPhotoPane(false);
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

  // Side, rotation and view of a board being reopened from the last session.
  const pendingRestore = useRef<WorkspaceTab | null>(null);

  const finishLoad = useCallback((loaded: Loaded): boolean => {
    setLoading(null);
    const { result, source } = loaded;
    if (!result.ok) {
      setError({ name: source.name, path: source.path, error: result.error });
      return false;
    }
    const restore = pendingRestore.current?.path === source.path ? pendingRestore.current : null;
    pendingRestore.current = null;
    setError(null);
    setModel(new BoardModel(result.board));
    setSource(source);
    setSelection(NONE);
    setSide(restore?.side ?? "top");
    setRotation(restore?.rotation ?? 0);
    setInitialView(restore?.view);
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

  // For the one-time restore on start, which must use the current copies.
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  const switchTabRef = useRef(switchTab);
  switchTabRef.current = switchTab;

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
      setPhotoPane(false);
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
      if (photoPane) {
        setPhotoPane(false);
        setSchematicVisible(true);
      } else setSchematicVisible((v) => !v);
      return;
    }
    const path = await pickPath(t("schematic.open"), "pdf");
    if (path) await openSchematicPath(path);
  }, [detached, schematic, openSchematicPath, t]);

  // --- selection -----------------------------------------------------------

  // Several parts chosen with ⌘/Shift-click (the first one is the selected part as well).
  const [multiParts, setMultiParts] = useState<number[]>([]);
  const [bgaPart, setBgaPart] = useState<number | null>(null);
  const [donorPart, setDonorPart] = useState<number | null>(null);
  // Board comparison: the list of differences, and parts of A marked on the board.
  const [showDiff, setShowDiff] = useState(false);
  const [diffMarks, setDiffMarks] = useState<number[] | null>(null);
  // Parts marked from the details: same type, short candidates.
  const [markedParts, setMarkedParts] = useState<{ parts: number[]; label: string } | null>(null);
  const multiSet = useMemo(
    () => new Set([...multiParts, ...(diffMarks ?? []), ...(markedParts?.parts ?? [])]),
    [multiParts, diffMarks, markedParts],
  );
  useEffect(() => {
    setMultiParts([]);
    setMarkedParts(null);
    setBgaPart(null);
    setDonorPart(null);
    setDiffMarks(null);
  }, [model]);
  const addPartToSelection = (part: number) => {
    setMultiParts((list) => {
      const base = list.length === 0 && selection.kind === "part" && selection.part !== part ? [selection.part] : list;
      return base.includes(part) ? base.filter((p) => p !== part) : [...base, part];
    });
  };

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
        const onBottom = where === "bottom" || (sel.kind === "net" && netSides(model, sel.net) === "bottom");
        const view = splitViewsRef.current && onBottom ? viewRef2.current : viewRef.current;
        if (bounds) view?.zoomTo(bounds, where && where !== "both" ? where : sel.kind === "net" ? netSides(model, sel.net) : undefined);
      }
    },
    [model],
  );

  // --- AI connection (MCP): requests answered from the current state ---------------
  const mcpContext = useRef<McpContext | null>(null);
  mcpContext.current = {
    model,
    fileName: source?.name,
    side,
    selection,
    notes: notesForModel,
    facts: schematicFacts,
    schematic,
    t,
    select: (sel) => select(sel, true),
  };
  const mcpEnabled = !!settings.mcp?.enabled;
  const mcpPort = settings.mcp?.port ?? MCP_DEFAULT_PORT;
  useEffect(() => {
    if (!mcpEnabled) {
      void invoke("mcp_stop").catch(() => {});
      return;
    }
    invoke("mcp_start", { port: mcpPort }).catch((e) => setToast(t("mcp.failed", { message: String(e) })));
  }, [mcpEnabled, mcpPort]);
  useEffect(() => {
    const off = listen<{ id: number; message: Parameters<typeof answerMcp>[0] }>("mcp:call", (e) => {
      const ctx = mcpContext.current;
      const answer = ctx ? answerMcp(e.payload.message, ctx) : { error: { code: -32000, message: "Avero is starting" } };
      void invoke("mcp_reply", { id: e.payload.id, answer });
    });
    return () => {
      void off.then((f) => f());
    };
  }, []);

  // Protected PDFs ask for their password in Avero's own dialog.
  useEffect(() => {
    setPdfPasswordPrompt((name, retry) =>
      askText(retry ? t("pdf.passwordWrong") : t("pdf.password", { name }), "", { title: t("pdf.passwordTitle"), secret: true }),
    );
    return () => setPdfPasswordPrompt(null);
  }, [t]);

  // --- back / forward through the selections ------------------------------------
  const histories = useRef(new WeakMap<BoardModel, NavHistory>());
  const navigating = useRef(false);
  useEffect(() => {
    if (!model || selection.kind === "none") return;
    let h = histories.current.get(model);
    if (!h) histories.current.set(model, (h = { items: [], at: -1 }));
    if (navigating.current) {
      navigating.current = false;
      return;
    }
    if (h.items[h.at] && sameSelection(h.items[h.at], selection)) return;
    h.items = [...h.items.slice(0, h.at + 1), selection].slice(-200);
    h.at = h.items.length - 1;
  }, [model, selection]);
  const navigate = (step: -1 | 1) => {
    const h = model && histories.current.get(model);
    if (!h) return;
    const at = h.at + step;
    if (at < 0 || at >= h.items.length) return setToast(t(step < 0 ? "nav.noBack" : "nav.noForward"));
    h.at = at;
    navigating.current = true;
    select(h.items[at], true);
  };

  // --- CSV lists for spreadsheets ---------------------------------------------------
  const exportCsv = async (what: "parts" | "nets" | "readings") => {
    if (!model) return;
    const base = (source?.name ?? "board").replace(/\.[^.]+$/, "");
    const bytes = what === "parts" ? partsCsv(model, schematicFacts) : what === "nets" ? netsCsv(model) : notesForModel ? readingsCsv(notesForModel) : null;
    if (!bytes) return;
    try {
      const path = await saveBytes(bytes, t(`csv.${what}`), `${base} ${t(`csv.file.${what}`)}.csv`, { name: "CSV", extensions: ["csv"] });
      if (path) setToast(t("csv.saved", { name: fileName(path) }));
    } catch (e) {
      setToast(String(e));
    }
  };

  // --- bookmarks -------------------------------------------------------------------
  const addBookmarkHere = async () => {
    const view = viewRef.current;
    if (!model || !notes || !view) return;
    const target = selectionText(model, selection);
    const name = await askText(t("bookmark.ask"), target ?? t("bookmark.default", { n: (notes.bookmarks?.length ?? 0) + 1 }), { title: t("bookmark.add") });
    if (!name?.trim()) return;
    const s = side === "bottom" ? "bottom" : "top";
    updateNotes((n) => addBookmark(n, { name: name.trim(), side: s, view: view.viewState(), ...(target && { target }) }));
    setToast(t("bookmark.added", { name: name.trim() }));
  };
  const goToBookmark = (b: Bookmark) => {
    if (!model) return;
    setSide(b.side);
    const hit = b.target ? search(model, b.target, 1)[0] : undefined;
    if (hit) select(hit.selection, false);
    // After the side switch has reached the view.
    requestAnimationFrame(() => viewRef.current?.setViewState(b.view));
  };

  // The back/forward buttons of a mouse.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        navigateRef.current(e.button === 3 ? -1 : 1);
      }
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  // ⌘C with nothing marked as text copies the selected part, pin or net name.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement) || (window.getSelection()?.toString() ?? "") !== "") return;
      const text = model ? selectionText(model, selection) : undefined;
      if (!text || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      setToast(t("copy.done", { text }));
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [model, selection, t]);

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
    // A pin: the occurrence of the part where that pin is, by its number and net.
    const pin =
      model && selection.kind === "pin"
        ? {
            number: model.pins[selection.pin].number,
            nets: [...new Set([model.nets[model.pins[selection.pin].net].name, model.fileNetName(model.pins[selection.pin].net)])],
          }
        : undefined;
    setFocus(text ? { text, jump, nonce: ++focusNonce.current, ...(pin && { pin }) } : null);
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

  // --- bench keys: next measuring point, flip … (changeable, also for a foot pedal) ---
  const [tabRequest, setTabRequest] = useState<{ tab: "measure" | "details"; n: number } | null>(null);
  const [listFocus, setListFocus] = useState<{ listId: string; index: number; n: number } | null>(null);
  const nextListPoint = () => {
    if (!model || !notesForModel) return;
    const lists = notesForModel.lists ?? [];
    const list = lists.find((l) => l.id === notesForModel.activeList) ?? lists[0];
    if (!list) return setToast(t("lists.noList"));
    const i = listProgress(notesForModel, list).done.indexOf(false);
    if (i < 0) return setToast(t("lists.allDone", { title: list.title }));
    const net = model.findNet(list.items[i].net);
    if (net !== undefined) select({ kind: "net", net }, true);
    const n = Date.now();
    setTabRequest({ tab: "measure", n });
    setSettings((s) => (s.showSidebar && !s.sidebarCollapsed ? s : { ...s, showSidebar: true, sidebarCollapsed: false }));
    setListFocus({ listId: list.id, index: i, n });
  };
  const runShortcut = (action: ShortcutAction) => {
    const view = viewRef.current;
    switch (action) {
      case "nextPoint":
        return nextListPoint();
      case "commitNext": {
        // An empty value field with a multimeter connected: its reading goes in first.
        const field = document.activeElement;
        const quantity = field instanceof HTMLInputElement && field.classList.contains("value-input") ? (field.dataset.quantity as Quantity | undefined) : undefined;
        if (quantity && meterState().connected && field instanceof HTMLInputElement && !field.value.trim()) {
          void readMeter(quantity).then(
            (v) => {
              field.dispatchEvent(new CustomEvent(METER_VALUE_EVENT, { detail: v }));
              field.blur();
              window.setTimeout(() => shortcutRef.current("nextPoint"), 50);
            },
            (e) => setToast(t("meter.failed", { message: String(e) })),
          );
          return;
        }
        // Leaving the field saves its value; then on to the next point.
        (document.activeElement as HTMLElement | null)?.blur();
        // The current handler, which sees the value just saved.
        window.setTimeout(() => shortcutRef.current("nextPoint"), 50);
        return;
      }
      case "flip":
        return flipSide();
      case "bothSides":
        return setBothSides(!bothSides);
      case "fit":
        return view?.fit();
      case "zoomIn":
        return view?.zoomBy(1.5);
      case "zoomOut":
        return view?.zoomBy(1 / 1.5);
      case "pinNet": {
        const net = model?.selectedNet(selection);
        if (net !== undefined) togglePinned(net);
        return;
      }
      case "marker":
        if (model) setPlacingMarker((v) => !v);
        return;
      case "rotate":
        return setRotation((r) => (r + 1) & 3);
      case "back":
        return navigate(-1);
      case "forward":
        return navigate(1);
      case "bookmark":
        return void addBookmarkHere();
      case "nextPin":
      case "prevPin": {
        // Pin by pin through the selected part (from a part: its first or last pin).
        if (!model) return;
        const step = action === "nextPin" ? 1 : -1;
        if (selection.kind === "pin") {
          const p = model.parts[model.pins[selection.pin].part];
          const at = selection.pin - p.firstPin;
          return select({ kind: "pin", pin: p.firstPin + ((at + step + p.pinCount) % p.pinCount) }, true);
        }
        if (selection.kind === "part") {
          const p = model.parts[selection.part];
          if (p.pinCount > 0) select({ kind: "pin", pin: step > 0 ? p.firstPin : p.firstPin + p.pinCount - 1 }, true);
        }
        return;
      }
    }
  };
  const shortcutRef = useRef(runShortcut);
  shortcutRef.current = runShortcut;

  // --- datasheets ---------------------------------------------------------------
  const [datasheets, setDatasheets] = useState<Datasheet[]>([]);
  useEffect(() => {
    loadStore("datasheets").then((json) => setDatasheets(parseDatasheets(json)), () => {});
  }, []);
  const saveDatasheets = (next: Datasheet[]) => {
    setDatasheets(next);
    void saveStore("datasheets", next).catch((e) => setToast(String(e)));
  };
  const openDatasheet = async (sheet: Datasheet, page = sheet.pages[0]?.page ?? 0) => {
    try {
      const { SchematicDocument } = await import("./schematic/document");
      const doc = await SchematicDocument.open(await readFileBytes(sheet.file), sheet.title, sheet.file);
      setSheetPane((old) => {
        old?.doc.destroy();
        return { doc, sheet, page };
      });
      setPhotoPane(false);
      setCameraPane(false);
    } catch (e) {
      setToast(t("sheet.failed", { message: e instanceof Error ? e.message : String(e) }));
    }
  };
  const addDatasheet = async (part: number) => {
    if (!model) return;
    const device = model.parts[part].device;
    const path = await pickPath(t("sheet.add"), "pdf");
    if (!path) return;
    const suggested = partNumbers(device)[0] ?? "";
    const chips = await askText(t("sheet.chipsAsk"), suggested, { title: t("sheet.add") });
    if (chips === null) return;
    try {
      const file = await invoke<string>("import_datasheet", { path });
      const sheet: Datasheet = {
        id: newDatasheetId(),
        file,
        title: fileName(path).replace(/\.pdf$/i, ""),
        chips: chips.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
        pages: [],
      };
      saveDatasheets([...datasheets, sheet]);
      void openDatasheet(sheet);
    } catch (e) {
      setToast(t("sheet.failed", { message: String(e) }));
    }
  };

  // --- multimeter -------------------------------------------------------------------
  // Connect on start when set up; a meter that is not plugged in stays quiet.
  useEffect(() => {
    const m = settings.meter;
    if (m?.autoConnect && m.port && !meterState().connected) void connectMeter(m).catch(() => {});
    // Once, on start.
  }, []);

  // --- camera ---------------------------------------------------------------------
  const openCamera = () => {
    setCameraPane(true);
    setPhotoPane(false);
    setSheetPane((old) => {
      old?.doc.destroy();
      return null;
    });
  };
  const cameraSnapshot = async (png: Uint8Array, use: "case" | "board") => {
    if (!notes) return setToast(t("photo.notesLoading"));
    try {
      const file = await invoke<string>("store_photo_png", png, {
        headers: { "x-key": encodeURIComponent(notes.key), "x-side": use === "case" ? "case" : side },
      });
      if (use === "board") return void (await startAlignment(file, true));
      const title = t("measure.caseTitle", { n: notes.cases.length + 1 });
      updateNotes((n) => {
        const withCase = activeCase(n) ? n : addCase(n, title);
        const c = activeCase(withCase)!;
        return updateCase(withCase, c.id, { photos: [...(c.photos ?? []), file] });
      });
      setToast(t("camera.saved", { title: activeCase(notes)?.title ?? title }));
    } catch (e) {
      setToast(t("camera.failed", { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  // --- workspace: what was open, back on the next start ------------------------

  const workspaceSnapshot = useCallback(async (): Promise<Workspace> => {
    const tabsNow = tabsRef.current.map((t) => (t.id === live.current.id ? { ...live.current, view: viewRef.current?.viewState() } : t));
    const withFiles = tabsNow.filter((t) => t.source?.path);
    let frame: Workspace["window"];
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const [pos, size, maximized] = await Promise.all([win.outerPosition(), win.outerSize(), win.isMaximized()]);
      frame = { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized };
    } catch {
      frame = undefined;
    }
    return {
      version: 1,
      tabs: withFiles.map((t) => ({
        path: t.source!.path!,
        ...(t.schematic?.path && { schematicPath: t.schematic.path }),
        schematicVisible: t.schematicVisible,
        side: t.side,
        rotation: t.rotation,
        ...(t.view && { view: t.view }),
      })),
      active: Math.max(0, withFiles.findIndex((t) => t.id === live.current.id)),
      ...(frame && { window: frame }),
    };
  }, []);

  // Saved every few seconds while something changed: also pans and zooms, which are no React state.
  const restoring = useRef(true);
  useEffect(() => {
    let last = "";
    const timer = window.setInterval(() => {
      if (restoring.current) return;
      void workspaceSnapshot().then((ws) => {
        const json = JSON.stringify(ws);
        if (json === last) return;
        last = json;
        void saveStore("workspace", ws).catch(() => {});
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [workspaceSnapshot]);

  // On start: reopen the last session, unless Finder handed over files to open.
  useEffect(() => {
    const restore = async () => {
      await new Promise((r) => window.setTimeout(r, 400));
      if (!loadSettings().restoreWorkspace || live.current.model !== null) return;
      const ws = parseWorkspace(await loadStore("workspace").catch(() => null));
      if (!ws) return;
      if (ws.window) {
        try {
          const { getCurrentWindow, PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          if (ws.window.maximized) await win.maximize();
          else {
            await win.setSize(new PhysicalSize(ws.window.width, ws.window.height));
            await win.setPosition(new PhysicalPosition(ws.window.x, ws.window.y));
          }
        } catch {
          // Window placement is a nicety.
        }
      }
      for (const tab of ws.tabs) {
        pendingRestore.current = tab;
        await openPathRef.current(tab.path, tab.schematicPath);
        if (!tab.schematicVisible) setSchematicVisible(false);
      }
      const active = tabsRef.current.filter((t) => (t.id === live.current.id ? live.current : t).source?.path)[ws.active];
      if (active && active.id !== live.current.id) switchTabRef.current(active.id);
    };
    void restore().finally(() => {
      restoring.current = false;
    });
    // Once, on start.
  }, []);

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
    exportCsv: (what) => void exportCsv(what),
    settings: () => setDialog("settings"),
    search: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    searchSchematic: () => {
      setPhotoPane(false);
      if (schematic && !schematicVisible) setSchematicVisible(true);
      // After the pane is shown.
      requestAnimationFrame(() => schematicViewRef.current?.focusSearch());
    },
    palette: () => setDialog((d) => (d === "palette" ? null : d ?? "palette")),
    undo: () => {
      if (editingText()) document.execCommand("undo");
      else if (undoNotes()) setToast(t("undo.done"));
    },
    redo: () => {
      if (editingText()) document.execCommand("redo");
      else if (redoNotes()) setToast(t("undo.redone"));
    },
    flip: flipSide,
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
    back: () => navigate(-1),
    forward: () => navigate(1),
    bookmark: () => void addBookmarkHere(),
    ruler: () => model && setRuler((r) => (r ? null : { side, points: [] })),
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
      { id: "ruler", label: t("ruler.title"), shortcut: "L", enabled: board, run: () => setRuler({ side, points: [] }) },
      { id: "draw-line", label: t("draw.line"), enabled: board && notes !== null, run: () => startDrawing("line") },
      { id: "draw-area", label: t("draw.area"), enabled: board && notes !== null, run: () => startDrawing("area") },
      { id: "draw-jumper", label: t("draw.jumper"), enabled: board && notes !== null, run: () => startDrawing("jumper") },
      { id: "photo-add", label: t("photo.add"), enabled: board && notes !== null, run: a.addPhoto },
      { id: "photo-toggle", label: t("photo.toggle"), enabled: !!storedPhoto, run: a.togglePhoto },
      { id: "photo-pane", label: t("photo.paneCommand"), enabled: !!model, run: () => {
          setPhotoPane((v) => !v);
          setCameraPane(false);
        } },
      { id: "csv-parts", label: t("csv.parts"), enabled: board, run: () => void exportCsv("parts") },
      { id: "csv-nets", label: t("csv.nets"), enabled: board, run: () => void exportCsv("nets") },
      { id: "csv-readings", label: t("csv.readings"), enabled: board && notes !== null, run: () => void exportCsv("readings") },
      { id: "nav-back", label: t("nav.back"), shortcut: "⌘[", enabled: board, run: () => navigate(-1) },
      { id: "nav-forward", label: t("nav.forward"), shortcut: "⌘]", enabled: board, run: () => navigate(1) },
      { id: "bookmark-add", label: t("bookmark.add"), shortcut: "⌘D", enabled: board && notes !== null, run: () => void addBookmarkHere() },
      ...(notesForModel?.bookmarks ?? []).map((b) => ({ id: `bookmark-${b.id}`, label: `${t("bookmark.title")}: ${b.name}`, run: () => goToBookmark(b) })),
      { id: "board-hide", label: t("board.toggle"), enabled: secondView, run: () => setBoardHidden((v) => !v) },
      { id: "camera", label: t("camera.command"), enabled: board, run: () => (cameraPane ? setCameraPane(false) : openCamera()) },
      { id: "photo-pdf", label: t("photo.pdfCommand"), enabled: !!model && notes !== null && !!schematic, run: () => void photoFromPdf() },
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
      // ⌘C with no text marked: the selected part, pin or net name (the menu's
      // Copy may be greyed out then, so the key is handled here as well).
      if (mod && key === "c" && !isTyping(e.target) && !(window.getSelection()?.toString() ?? "")) {
        const text = model ? selectionText(model, selection) : undefined;
        if (text) {
          e.preventDefault();
          void copyText(text).then((ok) => ok && setToast(t("copy.done", { text })));
          return;
        }
      }
      // With the native menu bar, its key equivalents handle their ⌘ shortcuts.
      if (menuOwnsKey(e)) return;
      if (mod && key === "k") {
        e.preventDefault();
        actionsRef.current.palette();
        return;
      }
      if (mod && key === "z" && !editingText()) {
        e.preventDefault();
        if (e.shiftKey) actionsRef.current.redo();
        else actionsRef.current.undo();
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
      // Bench keys from the settings; pedal keys (F13 …, Page Down) also while typing a value.
      if (!dialog && !isModifierOnly(e)) {
        const name = keyName(e);
        const action = actionFor(bindings(loadSettings().shortcuts), name);
        if (action && (!isTyping(e.target) || worksWhileTyping(name))) {
          e.preventDefault();
          shortcutRef.current(action);
          return;
        }
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
        case "l":
        case "L":
          if (model) setRuler((r) => (r ? null : { side, points: [] }));
          break;
        case "Escape":
          if (rulerRef.current) setRuler(null);
          else if (drawingRef.current) setDrawing(null);
          else if (aligningRef.current) cancelAlignment();
          else if (placingMarkerRef.current) setPlacingMarker(false);
          else setSelection(NONE);
          break;
        case "R":
          setRotation((r) => (r + 3) & 3);
          break;
        case "Enter": {
          if (drawingRef.current?.kind === "area") {
            finishDrawing(drawingRef.current);
            break;
          }
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
  // Live while dragging; stored in the settings when the drag ends.
  const [sidebarWidth, setSidebarWidth] = useState(settings.sidebarWidth);
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
          onToggleSide={toggleSide}
          onFlip={flipSide}
          bothSides={bothSides}
          bothSidesMode={settings.bothSidesMode}
          onBothSidesMode={(mode) => setSettings((old) => ({ ...old, bothSidesMode: mode }))}
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
          drawing={ruler ? "ruler" : (drawing?.kind ?? null)}
          onDraw={(kind) => {
            setRuler(kind === "ruler" ? { side, points: [] } : null);
            if (kind && kind !== "ruler") startDrawing(kind);
            else setDrawing(null);
          }}
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
              <div className={`work-area${boardAway ? " board-hidden" : ""}`} ref={workAreaRef}>
                {boardAway && !showSchematic && (
                  <button className="small primary board-show" onClick={() => setBoardHidden(false)} title={t("board.showHint")}>
                    {t("board.show")}
                  </button>
                )}
                {model ? (
                  <>
                  <BoardView
                    ref={viewRef}
                    model={model}
                    side={splitViews ? "top" : side}
                    dual={bothSides && !splitViews}
                    onViewChange={splitViews && settings.bothSidesMode === "synced" ? (v) => viewRef2.current?.setViewState(v) : undefined}
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
                    photo={bothSides ? undefined : photoLayer}
                    partValues={partValues}
                    onPointPick={
                      drawing
                        ? pickDrawPoint
                        : ruler
                          ? pickRulerPoint
                          : placingMarker
                            ? placeMarker
                            : aligning && aligning.photoPoints.length >= aligning.count
                              ? pickBoardPoint
                              : undefined
                    }
                    drawings={boardDrawings}
                    draft={drawing && drawing.points.length ? { id: "draft", kind: drawing.kind, side: drawing.side, points: drawing.points } : null}
                    onSelect={(sel, zoom) => {
                      setMultiParts([]);
                      select(sel, zoom);
                    }}
                    onAddPart={addPartToSelection}
                    extraParts={multiSet}
                  >
                    {placingMarker && <div className="placing-hint">{t("marker.placing")}</div>}
                    {ruler && (
                      <div className="placing-hint drawing-hint ruler-hint">
                        {rulerText ? <strong>{rulerText.detail}</strong> : t("ruler.hint")}
                        <button className="small" onClick={() => setRuler(null)}>
                          {t("ruler.done")}
                        </button>
                      </div>
                    )}
                    {drawing && (
                      <div className="placing-hint drawing-hint">
                        {t(`draw.hint.${drawing.kind}`)}
                        {drawing.kind === "area" && (
                          <button className="small primary" disabled={drawing.points.length < 3} onClick={() => finishDrawing(drawing)}>
                            {t("draw.finish")}
                          </button>
                        )}
                        <button className="small" onClick={() => setDrawing(null)}>
                          {t("photo.cancel")}
                        </button>
                      </div>
                    )}
                    {secondView && !boardAway && (
                      <button className="small board-hide" onClick={() => setBoardHidden(true)} title={t("board.hideHint")}>
                        ✕ {t("board.hide")}
                      </button>
                    )}
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
                  {splitViews && (
                    <BoardView
                      ref={viewRef2}
                      model={model}
                      side="bottom"
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
                      partValues={partValues}
                      drawings={boardDrawings}
                      onPointPick={drawing ? pickDrawPoint : ruler ? pickRulerPoint : placingMarker ? placeMarker : undefined}
                      onSelect={(sel, zoom) => {
                        setMultiParts([]);
                        select(sel, zoom);
                      }}
                      onAddPart={addPartToSelection}
                      extraParts={multiSet}
                      onViewChange={settings.bothSidesMode === "synced" ? (v) => viewRef.current?.setViewState(v) : undefined}
                    />
                  )}
                  </>
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
                        <button className="small" onClick={() => setShowDiff(true)}>
                          {t("diff.button")}
                        </button>
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
                {model && sheetPane && (
                  <>
                    <Splitter
                      container={workAreaRef}
                      share={share}
                      onDrag={setShare}
                      onDone={(s) => setSettings((old) => ({ ...old, schematicShare: s }))}
                    />
                    <div className="compare-pane" style={{ width: `${share * 100}%` }}>
                      <DatasheetPane
                        doc={sheetPane.doc}
                        sheet={sheetPane.sheet}
                        page={sheetPane.page}
                        scroll={settings.scroll}
                        onRemember={(page, label) => {
                          const next = datasheets.map((s) => (s.id === sheetPane.sheet.id ? { ...s, pages: [...s.pages, { label, page }] } : s));
                          saveDatasheets(next);
                          setSheetPane((p) => (p ? { ...p, sheet: next.find((s) => s.id === p.sheet.id) ?? p.sheet } : p));
                        }}
                        onClose={() =>
                          setSheetPane((old) => {
                            old?.doc.destroy();
                            return null;
                          })
                        }
                      />
                    </div>
                  </>
                )}
                {model && cameraPane && !sheetPane && (
                  <>
                    <Splitter
                      container={workAreaRef}
                      share={share}
                      onDrag={setShare}
                      onDone={(s) => setSettings((old) => ({ ...old, schematicShare: s }))}
                    />
                    <div className="compare-pane" style={{ width: `${share * 100}%` }}>
                      <CameraPane onSnapshot={(png, use) => void cameraSnapshot(png, use)} onClose={() => setCameraPane(false)} />
                    </div>
                  </>
                )}
                {model && photoPane && !aligning && !sheetPane && !cameraPane && (
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
                          perspective={storedPhoto.perspective}
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
                            {notes && schematic && (
                              <button className="small primary" onClick={() => void photoFromPdf()}>
                                {t("photo.pdfUse")}
                              </button>
                            )}
                            {notes && (
                              <button className={schematic ? "small" : "small primary"} onClick={() => void addPhoto()}>
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
                        onShowBoard={boardAway ? () => setBoardHidden(false) : undefined}
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
                  marked={markedParts}
                  onMarkParts={(parts, label) => setMarkedParts(parts && parts.length ? { parts, label: label ?? "" } : null)}
                  onPinNets={(nets) => setPinChoice({ model, nets: [...new Set(nets)] })}
                  onShowMarker={showMarker}
                  onShowDrawing={showDrawing}
                  onShowBookmark={goToBookmark}
                  onAddBookmark={() => void addBookmarkHere()}
                  obdata={boardObdata?.obdata ?? null}
                  knowledgeCount={knowledgeForBoard}
                  schematicFacts={schematicFacts}
                  multiParts={multiParts}
                  onMultiParts={setMultiParts}
                  onOpenBga={setBgaPart}
                  onFindDonors={setDonorPart}
                  datasheets={datasheets}
                  onOpenDatasheet={(sheet, page) => void openDatasheet(sheet, page)}
                  onAddDatasheet={(part) => void addDatasheet(part)}
                  onRemoveDatasheet={(sheet) => {
                    saveDatasheets(datasheets.filter((s) => s.id !== sheet.id));
                    if (sheetPane?.sheet.id === sheet.id)
                      setSheetPane((old) => {
                        old?.doc.destroy();
                        return null;
                      });
                    void invoke("remove_datasheet", { path: sheet.file }).catch(() => {});
                  }}
                  tabRequest={tabRequest}
                  listFocus={listFocus}
                  width={sidebarWidth}
                  onWidth={(w, done) => {
                    setSidebarWidth(w);
                    if (done) setSettings((old) => ({ ...old, sidebarWidth: w }));
                  }}
                  collapsed={settings.sidebarCollapsed}
                  onCollapsed={(c) => setSettings((old) => ({ ...old, sidebarCollapsed: c }))}
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
                {["needs-key", "invalid-key", "needs-fz-key", "invalid-fz-key", "needs-cae-key", "invalid-cae-key", "xzz-all-locked"].includes(error.error.code) && (
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

          {aligning && aligning.photoPoints.length >= aligning.count && (
            <PhotoBoardHint
              image={aligning.image}
              point={aligning.photoPoints[aligning.boardPoints.length]}
              index={aligning.boardPoints.length}
              count={aligning.count}
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
              <button className={photoPane ? "small on" : "small"} onClick={() => {
                  setPhotoPane((v) => !v);
                  setCameraPane(false);
                }} title={t("photo.paneHint")}>
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

        <StatusBar model={model} source={source} schematic={schematic} loading={loading} settings={settings} onReport={() => setDialog("report")} />
        {dialog === "report" && model && <ImportReport model={model} source={source} onClose={() => setDialog(null)} />}
        {showDiff && model && compareModel && compared && (
          <DiffView
            a={model}
            b={compareModel}
            nameA={source?.name ?? ""}
            nameB={compared.source?.name ?? ""}
            onSelect={select}
            onMark={setDiffMarks}
            onClose={() => setShowDiff(false)}
          />
        )}
        {donorPart !== null && model && (
          <DonorView
            model={model}
            part={donorPart}
            boardPath={source?.path}
            keys={{ xzzKey: settings.xzzKey, fzKey: settings.fzKey }}
            onOpen={(path, part) => {
              setDonorPart(null);
              pendingBoardSearch.current = part;
              void openPath(path);
            }}
            onClose={() => setDonorPart(null)}
          />
        )}
        {bgaPart !== null && model && (
          <BgaView model={model} part={bgaPart} units={settings.units} onSelect={select} onClose={() => setBgaPart(null)} />
        )}

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
        <AskHost />
        {aligning && aligning.photoPoints.length < aligning.count && (
          <PhotoPointDialog
            image={aligning.image}
            points={aligning.photoPoints}
            count={aligning.count}
            onCount={(count) => {
              setSettings((old) => ({ ...old, photoPoints: count }));
              setAligning((a) => a && { ...a, count, photoPoints: a.photoPoints.slice(0, count) });
            }}
            onUndo={() => setAligning((a) => a && { ...a, photoPoints: a.photoPoints.slice(0, -1) })}
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
