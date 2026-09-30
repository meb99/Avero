import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { badge, filterEntries, loadLibrary, pickFolder, saveLibrary, scanLibrary, type LibraryEntry, type LibraryState } from "../workbench/library";
import { Dialog } from "./Dialogs";
import { CloseIcon } from "./Icons";
import { VirtualList } from "./VirtualList";

interface Props {
  onOpen(entry: LibraryEntry): void;
  onClose(): void;
}

/** Rescan automatically when the last scan is older than this. */
const STALE_MS = 10 * 60 * 1000;

export function LibraryDialog({ onOpen, onClose }: Props) {
  const { t, lang } = useI18n();
  const [library, setLibrary] = useState<LibraryState>(loadLibrary);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rescan = async (folders: string[]) => {
    setScanning(true);
    setError(null);
    try {
      const scan = folders.length ? await scanLibrary(folders) : null;
      const next = { folders, scan, scannedAt: new Date().toISOString() };
      setLibrary(next);
      saveLibrary(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    const stale = !library.scannedAt || Date.now() - Date.parse(library.scannedAt) > STALE_MS;
    if (library.folders.length && stale) void rescan(library.folders);
    // Only when the library is opened, not on every state change.
  }, []);

  const entries = useMemo(() => filterEntries(library.scan?.entries ?? [], query), [library.scan, query]);

  const addFolder = async () => {
    const folder = await pickFolder(t("library.addFolder"));
    if (folder && !library.folders.includes(folder)) await rescan([...library.folders, folder]);
  };

  const removeFolder = (folder: string) => void rescan(library.folders.filter((f) => f !== folder));

  const scannedAt = library.scannedAt
    ? new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(new Date(library.scannedAt))
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
        <button onClick={() => void rescan(library.folders)} disabled={scanning || library.folders.length === 0}>
          {scanning ? t("library.scanning") : t("library.rescan")}
        </button>
      </div>

      {library.folders.length > 0 && (
        <div className="library-folders">
          {library.folders.map((f) => (
            <span key={f} className="folder-chip" title={f}>
              {f.split("/").filter(Boolean).pop()}
              <button className="tool icon-only" onClick={() => removeFolder(f)} aria-label={t("library.removeFolder")} title={t("library.removeFolder")}>
                <CloseIcon size={12} />
              </button>
            </span>
          ))}
          <span className="muted library-meta">
            {library.scan && t("library.count", { n: library.scan.entries.length, files: library.scan.files })}
            {scannedAt && ` · ${scannedAt}`}
          </span>
        </div>
      )}

      {library.scan?.truncated && <p className="library-warn">{t("library.truncated", { files: library.scan.files })}</p>}
      {library.scan?.missing.map((m) => (
        <p key={m} className="library-warn">
          {t("library.missing", { path: m })}
        </p>
      ))}
      {error && <p className="library-warn">{error}</p>}

      {library.folders.length === 0 ? (
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
              return (
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
              );
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
