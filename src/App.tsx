import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardView, type BoardViewHandle } from "./components/BoardView";
import { HelpDialog, SettingsDialog } from "./components/Dialogs";
import { CloseIcon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { Welcome } from "./components/Welcome";
import { BoardModel, type ViewSide } from "./core/board";
import {
  loadDemo,
  loadPath,
  onFileDrop,
  onFinderOpen,
  pickBoardPath,
  setWindowTitle,
  type BoardSource,
  type Loaded,
} from "./core/loader";
import type { LoadError, Selection, Side } from "./core/types";
import { I18nContext, systemLanguage, translator, type MessageKey } from "./i18n";
import { DARK, LIGHT } from "./render/palette";
import { clearRecent, loadRecent, loadSettings, rememberRecent, saveSettings, type Settings } from "./settings";

const NONE: Selection = { kind: "none" };

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
  const viewRef = useRef<BoardViewHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const lang = settings.language === "auto" ? systemLanguage() : settings.language;
  const i18n = useMemo(() => ({ t: translator(lang), lang }), [lang]);
  const { t } = i18n;
  const prefersDark = usePrefersDark();
  const theme = settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
  const palette = theme === "dark" ? DARK : LIGHT;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [theme, lang]);

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    void setWindowTitle(source ? `${source.name} — Avero` : "Avero");
  }, [source]);

  const finishLoad = useCallback((loaded: Loaded | undefined) => {
    setLoading(null);
    if (!loaded) return;
    const { result, source } = loaded;
    if (!result.ok) {
      setError({ name: source.name, error: result.error });
      return;
    }
    setError(null);
    setModel(new BoardModel(result.board));
    setSource(source);
    setSelection(NONE);
    setSide("top");
    setRotation(0);
    if (source.path) setRecent(rememberRecent(source.path));
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      setLoading(path.split(/[\\/]/).pop() ?? path);
      finishLoad(await loadPath(path));
    },
    [finishLoad],
  );

  const openDialog = useCallback(async () => {
    const path = await pickBoardPath(t("welcome.open"));
    if (path) await openPath(path);
  }, [openPath, t]);

  const openDemo = useCallback(async () => {
    setLoading("Avero Demo");
    finishLoad(await loadDemo());
  }, [finishLoad]);

  const closeBoard = useCallback(() => {
    setModel(null);
    setSource(null);
    setSelection(NONE);
  }, []);

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

  // Files dropped on the window or opened from Finder.
  useEffect(() => {
    const open = (paths: string[]) => void (paths[0] && openPath(paths[0]));
    const subscriptions = [onFileDrop(open, setDragOver), onFinderOpen(open)];
    return () => {
      for (const s of subscriptions) void s.then((unlisten) => unlisten());
    };
  }, [openPath]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openDialog();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (isTyping(e.target) || dialog || mod || e.altKey) return;
      const view = viewRef.current;
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
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, model, selection, openDialog]);

  const errorText = error
    ? t(`error.${error.error.code}` as MessageKey, { format: error.error.format ?? "", message: error.error.message })
    : "";

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        <Toolbar
          model={model}
          side={side}
          onOpen={() => void openDialog()}
          onClose={closeBoard}
          onSide={setSide}
          onRotate={() => setRotation((r) => (r + 1) & 3)}
          onFit={() => viewRef.current?.fit()}
          onZoom={(f) => viewRef.current?.zoomBy(f)}
          onSettings={() => setDialog("settings")}
          onHelp={() => setDialog("help")}
          onPick={(sel) => select(sel, true)}
          searchRef={searchRef}
        />

        <main className="workspace">
          {model ? (
            <>
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
              <Sidebar model={model} selection={selection} side={side} settings={settings} onSelect={select} />
            </>
          ) : (
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

        <StatusBar model={model} source={source} loading={loading} settings={settings} />

        {dialog === "settings" && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setDialog(null)} />}
        {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
      </div>
    </I18nContext.Provider>
  );
}
