import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardView, type BoardViewHandle } from "./components/BoardView";
import { HelpDialog, SettingsDialog } from "./components/Dialogs";
import { CloseIcon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { Splitter } from "./components/Splitter";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";
import { BoardModel, type ViewSide } from "./core/board";
import {
  loadDemo,
  loadPath,
  onFileDrop,
  onFinderOpen,
  pickPath,
  readFileBytes,
  schematicsFor,
  setWindowTitle,
  type BoardSource,
  type Loaded,
} from "./core/loader";
import type { LoadError, Selection, Side } from "./core/types";
import { I18nContext, systemLanguage, translator, type MessageKey } from "./i18n";
import { DARK, LIGHT } from "./render/palette";
import type { SchematicDocument } from "./schematic/document";
import { SchematicView, type SchematicFocus, type SchematicViewHandle, type WordTarget } from "./schematic/SchematicView";
import type { Word } from "./schematic/textIndex";
import { clearRecent, loadRecent, loadSettings, rememberRecent, saveSettings, type Settings } from "./settings";

const NONE: Selection = { kind: "none" };
const DEMO_SCHEMATIC = `${import.meta.env.BASE_URL}demo/avero-demo-schematic.pdf`;

function usePrefersDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const listener = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  return dark;
}

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
  const [error, setError] = useState<{ name: string; error: LoadError } | null>(null);
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [schematic, setSchematic] = useState<SchematicDocument | null>(null);
  const [schematicVisible, setSchematicVisible] = useState(true);
  const [focus, setFocus] = useState<SchematicFocus | null>(null);
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
  const prefersDark = usePrefersDark();
  const theme = settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
  const palette = theme === "dark" ? DARK : LIGHT;
  const showSchematic = schematic !== null && schematicVisible;

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
      setError({ name: source.name, error: result.error });
      return false;
    }
    setError(null);
    setModel(new BoardModel(result.board));
    setSource(source);
    setSelection(NONE);
    setSide("top");
    setRotation(0);
    if (source.path) setRecent(rememberRecent(source.path));
    return true;
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      if (isPdf(path)) {
        await openSchematicPath(path);
        return;
      }
      setLoading(fileName(path));
      if (finishLoad(await loadPath(path)) && settings.autoSchematic) {
        const [best] = await schematicsFor(path).catch(() => []);
        if (best && best !== schematic?.path) await openSchematicPath(best);
      }
    },
    [finishLoad, openSchematicPath, settings.autoSchematic, schematic],
  );

  const openDialog = useCallback(async () => {
    const path = await pickPath(t("welcome.open"), "any");
    if (path) await openPath(path);
  }, [openPath, t]);

  const openDemo = useCallback(async () => {
    setLoading("Avero Demo");
    if (!finishLoad(await loadDemo())) return;
    try {
      const response = await fetch(DEMO_SCHEMATIC);
      if (response.ok) await openSchematicBytes(new Uint8Array(await response.arrayBuffer()), "Avero Demo.pdf");
    } catch {
      // The demo board works without its schematic.
    }
  }, [finishLoad, openSchematicBytes]);

  const closeBoard = useCallback(() => {
    setModel(null);
    setSource(null);
    setSelection(NONE);
  }, []);

  const closeSchematic = useCallback(() => {
    setSchematic((old) => {
      old?.destroy();
      return null;
    });
  }, []);

  const toggleSchematic = useCallback(async () => {
    if (schematic) {
      setSchematicVisible((v) => !v);
      return;
    }
    const path = await pickPath(t("schematic.open"), "pdf");
    if (path) await openSchematicPath(path);
  }, [schematic, openSchematicPath, t]);

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

  const pickWord = useCallback(
    (word: Word) => {
      if (!model) return;
      const part = model.findPart(word.key);
      const net = model.findNet(word.key);
      pickedInSchematic.current = true;
      if (part !== undefined) select({ kind: "part", part }, true);
      else if (net !== undefined) select({ kind: "net", net }, true);
      else pickedInSchematic.current = false;
    },
    [model, select],
  );

  // Files dropped on the window or opened from Finder.
  useEffect(() => {
    const open = (paths: string[]) => {
      // A board and its schematic dropped together: open both.
      for (const p of [...paths.filter((p) => !isPdf(p)).slice(0, 1), ...paths.filter(isPdf).slice(0, 1)]) void openPath(p);
    };
    const subscriptions = [onFileDrop(open, setDragOver), onFinderOpen(open)];
    return () => {
      for (const s of subscriptions) void s.then((unlisten) => unlisten());
    };
  }, [openPath]);

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "o") {
        e.preventDefault();
        void openDialog();
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
      <div className="app">
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
          onSidebar={() => setSettings((s) => ({ ...s, showSidebar: !s.showSidebar }))}
          onSettings={() => setDialog("settings")}
          onHelp={() => setDialog("help")}
          onPick={(sel) => select(sel, true)}
          searchRef={searchRef}
        />

        <main className="workspace">
          {welcome ? (
            <Welcome
              recent={recent}
              onOpen={() => void openDialog()}
              onDemo={() => void openDemo()}
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
                      />
                    </div>
                  </>
                )}
              </div>
              {model && settings.showSidebar && (
                <Sidebar model={model} selection={selection} side={side} settings={settings} onSelect={select} />
              )}
            </>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>{t("error.title", { name: error.name })}</strong>
                <p>{errorText}</p>
              </div>
              <button className="tool icon-only" onClick={() => setError(null)} aria-label={t("error.dismiss")}>
                <CloseIcon />
              </button>
            </div>
          )}

          {dragOver && <div className="drop-overlay">{t("drop.hint")}</div>}
        </main>

        <StatusBar model={model} source={source} schematic={schematic} loading={loading} settings={settings} />

        {dialog === "settings" && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setDialog(null)} />}
        {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
      </div>
    </I18nContext.Provider>
  );
}
