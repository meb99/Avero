import { useEffect, useMemo, useRef, useState } from "react";
import { BOARD_EXTENSIONS } from "../core/loader";
import { useI18n } from "../i18n";
import {
  badge,
  filterEntries,
  importFiles,
  libraryRoot,
  loadLibrary,
  pickFolder,
  pickImport,
  revealInFinder,
  saveLibrary,
  scanLibrary,
  type ImportResult,
  type LibraryEntry,
  type LibraryState,
} from "../workbench/library";
import { Dialog } from "./Dialogs";
import { CloseIcon, OpenIcon } from "./Icons";
import { VirtualList } from "./VirtualList";

/** Paths dropped on the window while the library is open. */
export interface LibraryDrop {
  paths: string[];
  nonce: number;
}

interface Props {
  drop: LibraryDrop | null;
  onOpen(entry: LibraryEntry): void;
  onClose(): void;
}

/** Rescan automatically when the last scan is older than this. */
const STALE_MS = 10 * 60 * 1000;

export function LibraryDialog({ drop, onOpen, onClose }: Props) {
  const { t, lang } = useI18n();
  const [library, setLibrary] = useState<LibraryState>(loadLibrary);
  const [root, setRoot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [device, setDevice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handledDrop = useRef(drop?.nonce ?? 0);

  const rescan = async (folders: string[], own = root) => {
    setScanning(true);
    setError(null);
    try {
      const all = [...new Set([...(own ? [own] : []), ...folders])];
      const scan = all.length ? await scanLibrary(all) : null;
      const next = { folders, scan, scannedAt: new Date().toISOString() };
      setLibrary(next);
      saveLibrary(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  // Find the own library folder, then refresh a stale scan.
  useEffect(() => {
    void libraryRoot()
      .then((dir) => {
        setRoot(dir);
        const stale = !library.scannedAt || Date.now() - Date.parse(library.scannedAt) > STALE_MS;
        if (stale) void rescan(library.folders, dir);
      })
      .catch((e) => setError(String(e)));
    // Only when the library is opened, not on every state change.
  }, []);

  const runImport = async (paths: string[]) => {
    if (paths.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      setResult(await importFiles(paths, device));
      await rescan(library.folders);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (drop && drop.nonce !== handledDrop.current) {
      handledDrop.current = drop.nonce;
      void runImport(drop.paths);
    }
    // runImport reads the current device field; only a new drop triggers it.
  }, [drop]);

  const entries = useMemo(() => filterEntries(library.scan?.entries ?? [], query), [library.scan, query]);

  const addFolder = async () => {
    const folder = await pickFolder(t("library.addFolder"));
    if (folder && folder !== root && !library.folders.includes(folder)) await rescan([...library.folders, folder]);
  };

  const scannedAt = library.scannedAt
    ? new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(new Date(library.scannedAt))
    : null;

  const summary = result
    ? [
        t("library.imported", { n: result.imported.length }),
        result.duplicates ? t("library.duplicates", { n: result.duplicates }) : "",
        result.skipped ? t("library.skippedFiles", { n: result.skipped }) : "",
        result.errors.length ? t("library.importErrors", { n: result.errors.length }) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <Dialog title={t("library.title")} onClose={onClose} className="library-dialog">
      <div className="library-bar">
        <input
          type="search"
          autoFocus
          placeholder={t("library.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && entries[0] && entries[0].boards.length + entries[0].schematics.length > 0) onOpen(entries[0]);
          }}
        />
        <button onClick={() => void addFolder()}>{t("library.addFolder")}</button>
        <button onClick={() => void rescan(library.folders)} disabled={scanning}>
          {scanning ? t("library.scanning") : t("library.rescan")}
        </button>
      </div>

      <div className="library-import">
        <input
          className="import-folder"
          placeholder={t("library.importFolder")}
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          aria-label={t("library.importFolder")}
        />
        <button className="primary" disabled={importing} onClick={() => void pickImport(t("library.import"), BOARD_EXTENSIONS).then(runImport)}>
          {importing ? t("library.scanning") : t("library.import")}
        </button>
        <p className="muted import-hint">{summary ?? t("library.importHint")}</p>
      </div>

      <div className="library-folders">
        {root && (
          <span className="folder-chip own" title={root}>
            {t("library.ownFolder")}
            <button className="tool icon-only" onClick={() => void revealInFinder(root)} aria-label={t("library.reveal")} title={t("library.reveal")}>
              <OpenIcon />
            </button>
          </span>
        )}
        {library.folders.map((f) => (
          <span key={f} className="folder-chip" title={f}>
            {f.split("/").filter(Boolean).pop()}
            <button
              className="tool icon-only"
              onClick={() => void rescan(library.folders.filter((x) => x !== f))}
              aria-label={t("library.removeFolder")}
              title={t("library.removeFolder")}
            >
              <CloseIcon size={12} />
            </button>
          </span>
        ))}
        <span className="muted library-meta">
          {library.scan && t("library.count", { n: library.scan.entries.length, files: library.scan.files })}
          {scannedAt && ` · ${scannedAt}`}
        </span>
      </div>

      {library.scan?.truncated && <p className="library-warn">{t("library.truncated", { files: library.scan.files })}</p>}
      {library.scan?.missing.map((m) => (
        <p key={m} className="library-warn">
          {t("library.missing", { path: m })}
        </p>
      ))}
      {result?.errors.slice(0, 3).map((e) => (
        <p key={e} className="library-warn">
          {e}
        </p>
      ))}
      {error && <p className="library-warn">{error}</p>}

      {(library.scan?.entries.length ?? 0) === 0 && !scanning ? (
        <p className="library-empty">{t("library.empty")}</p>
      ) : entries.length === 0 && !scanning ? (
        <p className="library-empty">{t("library.noMatch")}</p>
      ) : (
        <div className="library-list">
          <VirtualList
            items={entries}
            rowHeight={54}
            render={(e) => {
              const usable = e.boards.length + e.schematics.length > 0;
              const first = e.boards[0] ?? e.schematics[0] ?? e.unsupported[0];
              return (
                <div className="library-item">
                  <button className="library-row" disabled={!usable} onClick={() => onOpen(e)} title={usable ? undefined : t("library.unsupported")}>
                    <span className="library-title">{e.title}</span>
                    <span className="library-folder">{e.folder || "/"}</span>
                    <span className="library-files">
                      {[...e.boards, ...e.schematics].map((f) => (
                        <span key={f.path} className="file-badge" title={f.path}>
                          {badge(f.name)}
                        </span>
                      ))}
                      {e.unsupported.map((f) => (
                        <span key={f.path} className="file-badge unsupported" title={`${f.path} · ${t("library.unsupported")}`}>
                          {badge(f.name)}
                        </span>
                      ))}
                    </span>
                  </button>
                  {first && (
                    <button className="tool icon-only reveal" onClick={() => void revealInFinder(first.path)} aria-label={t("library.reveal")} title={t("library.reveal")}>
                      <OpenIcon />
                    </button>
                  )}
                </div>
              );
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
