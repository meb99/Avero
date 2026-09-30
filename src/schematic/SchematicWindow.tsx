import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { readFileBytes, setWindowTitle } from "../core/loader";
import { I18nContext, systemLanguage, translator } from "../i18n";
import { loadSettings } from "../settings";
import { useTheme } from "../theme";
import type { SchematicDocument } from "./document";
import { closeSchematicWindow, LINK, type LinkedDoc } from "./link";
import { SchematicView, type SchematicFocus, type SchematicViewHandle } from "./SchematicView";

/** The schematic on its own, in the separate window. */
export function SchematicWindow() {
  const [settings] = useState(loadSettings);
  const lang = settings.language === "auto" ? systemLanguage() : settings.language;
  const i18n = useMemo(() => ({ t: translator(lang), lang }), [lang]);
  const { t } = i18n;
  const theme = useTheme(settings);
  const [linked, setLinked] = useState<LinkedDoc | null>(null);
  const [doc, setDoc] = useState<SchematicDocument | null>(null);
  const [focus, setFocus] = useState<SchematicFocus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<SchematicViewHandle>(null);
  const linkedRef = useRef(linked);
  linkedRef.current = linked;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [theme, lang]);

  // Messages from the main window; `ready` asks it for the current state.
  useEffect(() => {
    const subscriptions = [
      listen<LinkedDoc | null>(LINK.doc, (e) => setLinked(e.payload)),
      listen<SchematicFocus | null>(LINK.focus, (e) => setFocus(e.payload)),
    ];
    void Promise.all(subscriptions).then(() => emit(LINK.ready));
    return () => {
      for (const s of subscriptions) void s.then((unlisten) => unlisten());
    };
  }, []);

  // Load the document when it changes (not when only the board's names do).
  const docKey = linked ? (linked.path ?? linked.url ?? linked.name) : "";
  useEffect(() => {
    const target = linkedRef.current;
    if (!target) {
      setDoc((old) => {
        old?.destroy();
        return null;
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bytes = target.path
          ? await readFileBytes(target.path)
          : new Uint8Array(await (await fetch(target.url ?? "")).arrayBuffer());
        const { SchematicDocument } = await import("./document");
        const opened = await SchematicDocument.open(bytes, target.name, target.path);
        if (cancelled) {
          opened.destroy();
          return;
        }
        setError(null);
        setDoc((old) => {
          old?.destroy();
          return opened;
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docKey]);

  useEffect(() => {
    void setWindowTitle(doc ? `${doc.name} — Avero` : "Avero");
  }, [doc]);

  const names = useMemo(() => ({ parts: new Set(linked?.parts), nets: new Set(linked?.nets) }), [linked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const view = viewRef.current;
      const el = e.target as HTMLElement | null;
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "KeyF") {
        e.preventDefault();
        view?.focusSearch();
        return;
      }
      if (el?.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "PageDown") view?.nextPage();
      else if (e.key === "PageUp") view?.prevPage();
      else if (e.key === "]") view?.nextHit();
      else if (e.key === "[") view?.prevHit();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <I18nContext.Provider value={i18n}>
      <div className="schematic-window">
        {doc ? (
          <SchematicView
            ref={viewRef}
            doc={doc}
            focus={focus}
            scroll={settings.scroll}
            classify={(w) => (names.parts.has(w.key) ? "part" : names.nets.has(w.key) ? "net" : null)}
            onPick={(w) => void emitTo("main", LINK.pick, w.key)}
            onClose={() => void closeSchematicWindow()}
          />
        ) : (
          <div className="board-placeholder">{error ?? t(linked ? "schematic.loading" : "schematic.none")}</div>
        )}
      </div>
    </I18nContext.Provider>
  );
}
