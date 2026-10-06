import { useEffect, useMemo, useRef, useState } from "react";
import { BOARD_EXTENSIONS } from "../core/loader";
import { loadSettings } from "../settings";
import { convertXzzFiles, pickXzz, pickXzzFolder, saveOriginalXzz, type ConversionResult, type ConvertedFile } from "../workbench/conversion";
import { importCollection, pickCollection, type CollectionProgress, type CollectionResult } from "../workbench/collection";
import { useI18n } from "../i18n";
import {
  badge,
  filterEntries,
  importFiles,
  libraryRoot,
  loadAutoSort,
  loadLibrary,
  pickFolder,
  pickImport,
  revealInFinder,
  saveAutoSort,
  saveLibrary,
  scanLibrary,
  trashLibraryFiles,
  type ImportResult,
  type LibraryEntry,
  type LibraryFile,
  type LibraryScan,
  type LibraryState,
} from "../workbench/library";
import { LibraryText } from "./LibraryText";
import { RenameFiles, type RenameTarget } from "./RenameFiles";
import { CategoryDialog, CategoryFields, CategoryTree } from "./Categories";
import { DuplicatesDialog } from "./Duplicates";
import { AutoSortDialog, applyPlans } from "./AutoSort";
import { planFor, schematicWords, unsortedEntries, type SortPlan } from "../workbench/autosort";
import {
  buildTree,
  categoryFolder,
  isSorted,
  UNSORTED,
  type Category,
} from "../workbench/catalog";
import { Dialog } from "./Dialogs";
import { CloseIcon, OpenIcon, RenameIcon, TagIcon, TrashIcon } from "./Icons";
import { VirtualList } from "./VirtualList";

/** Paths dropped on the window while the library is open. */
export interface LibraryDrop {
  paths: string[];
  nonce: number;
}

interface Props {
  drop: LibraryDrop | null;
  onOpen(entry: LibraryEntry): void;
  /** Opens a schematic found by full-text search and searches it for `query`. */
  onOpenText(entry: LibraryEntry, file: LibraryFile, query: string): void;
  onClose(): void;
}

const TOOLS_KEY = "avero.library.tools";

/** Rescan automatically when the last scan is older than this. */
const STALE_MS = 10 * 60 * 1000;

export function LibraryDialog({ drop, onOpen, onOpenText, onClose }: Props) {
  const { t, lang } = useI18n();
  const [library, setLibrary] = useState<LibraryState>(loadLibrary);
  const [root, setRoot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Search boards by name, or the text inside all schematics.
  const [mode, setMode] = useState<"boards" | "text">("boards");
  // Brand › family › model for imports; also the folder the files go to.
  const [importCategory, setImportCategory] = useState<Category>({
    brand: "",
    family: "",
    model: "",
  });
  const device = categoryFolder(importCategory);
  // Selected branch of the category tree ("" = everything).
  const [branch, setBranch] = useState("");
  const [sorting, setSorting] = useState<LibraryEntry | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);
  const [conversion, setConversion] = useState<ConversionResult | null>(null);
  const [conversionProgress, setConversionProgress] = useState<CollectionProgress | null>(null);
  const conversionAbort = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectionProgress, setCollectionProgress] = useState<CollectionProgress | null>(null);
  const [collection, setCollection] = useState<CollectionResult | null>(null);
  const conversionBusy = useRef(false);
  const busy = importing || converting !== null || collecting;
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [dupes, setDupes] = useState(false);
  const [sortingAll, setSortingAll] = useState(false);
  const [autoSort, setAutoSort] = useState(loadAutoSort);
  const [sortedNote, setSortedNote] = useState<string | null>(null);
  const handledDrop = useRef(drop?.nonce ?? 0);
  // Import and conversion tools: folded by default, remembered.
  const [toolsOpen, setToolsOpen] = useState(() => {
    try {
      return localStorage.getItem(TOOLS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const rescan = async (folders: string[], own = root) => {
    setScanning(true);
    setError(null);
    try {
      const all = [...new Set([...(own ? [own] : []), ...folders])];
      const scan = all.length ? await scanLibrary(all) : null;
      const next = { folders, scan, scannedAt: new Date().toISOString() };
      setLibrary(next);
      saveLibrary(next);
      return scan;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setScanning(false);
    }
  };

  /**
   * Puts freshly imported boards into Brand › Family › Model: by their
   * names, or by their schematic text when the names say nothing.
   */
  const sortImported = async (scan: LibraryScan, imported: string[], own: string): Promise<Map<string, string>> => {
    const wanted = new Set(imported);
    const entries = unsortedEntries(scan.entries, own).filter((e) =>
      [...e.boards, ...e.schematics, ...e.unsupported].some((f) => wanted.has(f.path)),
    );
    if (entries.length === 0) return new Map();
    const tree = buildTree(scan.entries.filter((e) => isSorted(e.folder)).map((e) => e.folder));
    const plans: SortPlan[] = [];
    for (const e of entries) {
      const plan = planFor(e, tree) ?? (e.schematics.length ? planFor(e, tree, await schematicWords(e, () => false)) : null);
      if (plan) plans.push(plan);
    }
    if (plans.length === 0) return new Map();
    const { moved, paths, errors } = await applyPlans(plans);
    if (errors.length) setError(errors.join("\n"));
    if (moved > 0) {
      setSortedNote(
        t("autosort.done", { n: moved, where: [...new Set(plans.map((p) => p.target.split("/").slice(0, 3).join(" › ")))].join(", ") }),
      );
      await rescan(library.folders, own);
    }
    return paths;
  };

  // Find the own library folder, then refresh a stale scan.
  useEffect(() => {
    void libraryRoot()
      .then((dir) => {
        setRoot(dir);
        const stale =
          !library.scannedAt ||
          Date.now() - Date.parse(library.scannedAt) > STALE_MS;
        if (stale) void rescan(library.folders, dir);
      })
      .catch((e) => setError(String(e)));
    // Only when the library is opened, not on every state change.
  }, []);

  const runImport = async (paths: string[]) => {
    if (paths.length === 0 || conversionBusy.current) return;
    conversionBusy.current = true;
    setImporting(true);
    setError(null);
    try {
      const imported = await importFiles(paths, device);
      setResult(imported);
      setSortedNote(null);
      const scan = await rescan(library.folders);
      // A category typed above wins; otherwise sort on its own.
      const moved = !device && autoSort && scan && root ? await sortImported(scan, imported.imported, root) : new Map<string, string>();
      imported.imported = imported.imported.map((p) => moved.get(p) ?? p);
      // Downloads often have meaningless names: offer to rename right away.
      if (imported.imported.length > 0)
        setRenaming({ title: t("rename.imported"), paths: imported.imported });
    } catch (e) {
      setError(String(e));
    } finally {
      conversionBusy.current = false;
      setImporting(false);
    }
  };

  const runConversion = async (wholeFolder = false) => {
    if (importing || conversionBusy.current) return;
    conversionBusy.current = true;
    setConverting(t(wholeFolder ? "convert.chooseFolder" : "convert.choose"));
    setConversionProgress(null);
    setStopping(false);
    setError(null);
    try {
      const paths = wholeFolder ? await pickXzzFolder(t("convert.chooseFolder")) : await pickXzz(t("convert.choose"));
      if (!paths) return;
      if (paths.length === 0) { if (wholeFolder) setError(t("convert.emptyFolder")); return; }
      setConversion(null);
      const controller = new AbortController();
      conversionAbort.current = controller;
      const converted = await convertXzzFiles(paths, device, loadSettings().xzzKey,
        (completed, total, path) => {
          const name = path.split(/[\\/]/).pop() ?? path;
          setConversionProgress({ completed, total, name });
          setConverting(t("convert.progress", { index: completed, total, name }));
        }, controller.signal);
      setConversion(converted);
      const own = root ?? await libraryRoot();
      setRoot(own);
      await rescan(library.folders, own);
      // Show the destination even when the user had another category selected.
      if (converted.files.length > 0) { setBranch(""); setQuery(""); setMode("boards"); }
    } catch (e) {
      setError(String(e));
    } finally {
      conversionBusy.current = false;
      conversionAbort.current = null;
      setConversionProgress(null);
      setStopping(false);
      setConverting(null);
    }
  };

  const runCollection = async () => {
    if (conversionBusy.current) return;
    conversionBusy.current = true;
    setCollecting(true);
    setError(null);
    setCollectionProgress(null);
    try {
      const path = await pickCollection(t("collection.choose"));
      if (!path) return;
      setCollection(null);
      const imported = await importCollection(path, loadSettings().xzzKey, setCollectionProgress);
      setCollection(imported);
      const own = root ?? await libraryRoot();
      setRoot(own);
      await rescan(library.folders, own);
      setBranch(""); setQuery(""); setMode("boards");
    } catch (e) {
      setError(String(e));
    } finally {
      conversionBusy.current = false;
      setCollecting(false);
      setCollectionProgress(null);
    }
  };

  const openConverted = (file: ConvertedFile) => {
    const entry = library.scan?.entries.find((e) => e.boards.some((b) => b.path === file.path));
    const name = file.path.split(/[\\/]/).pop() ?? file.path;
    onOpen(entry ? {
      ...entry, boards: [...entry.boards].sort((a, b) => Number(b.path === file.path) - Number(a.path === file.path)),
    } : {
      key: file.path, title: name, folder: "", root: root ?? "",
      boards: [{ path: file.path, name, size: 0, modified: 0 }], schematics: [], unsupported: [],
    });
  };

  useEffect(() => {
    if (drop && drop.nonce !== handledDrop.current) {
      handledDrop.current = drop.nonce;
      void runImport(drop.paths);
    }
    // runImport reads the current device field; only a new drop triggers it.
  }, [drop]);

  const all = library.scan?.entries ?? [];
  const tree = useMemo(
    () => buildTree(all.filter((e) => isSorted(e.folder)).map((e) => e.folder)),
    [library.scan],
  );
  const unsorted = all.filter((e) => !isSorted(e.folder)).length;
  const entries = useMemo(() => {
    const b = branch.toLowerCase();
    const inBranch = (e: LibraryEntry) =>
      branch === UNSORTED
        ? !isSorted(e.folder)
        : !b ||
          e.folder.toLowerCase() === b ||
          e.folder.toLowerCase().startsWith(`${b}/`);
    return filterEntries((library.scan?.entries ?? []).filter(inBranch), query);
  }, [library.scan, query, branch]);

  // After deleting or moving boards the chosen category may be gone or empty:
  // fall back to everything instead of an empty list.
  useEffect(() => {
    if (!branch || !library.scan) return;
    const b = branch.toLowerCase();
    const left =
      branch === UNSORTED
        ? all.some((e) => !isSorted(e.folder))
        : all.some((e) => e.folder.toLowerCase() === b || e.folder.toLowerCase().startsWith(`${b}/`));
    if (!left) setBranch("");
  }, [library.scan]);

  // Only files in Avero's own folder; they go to the Trash, not away for good.
  const remove = async (e: LibraryEntry) => {
    const paths = [...e.boards, ...e.schematics, ...e.unsupported].map((f) => f.path);
    const names = paths.map((p) => p.split("/").pop() ?? p);
    const files = names.slice(0, 12).join("\n") + (names.length > 12 ? `\n+${names.length - 12}` : "");
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const yes = await ask(t("library.deleteAsk", { name: e.title, files }), {
      title: "Avero",
      kind: "warning",
      okLabel: t("library.deleteOk"),
      cancelLabel: t("photo.cancel"),
    });
    if (!yes) return;
    setError(null);
    try {
      await trashLibraryFiles(paths);
    } catch (err) {
      setError(String(err));
    }
    await rescan(library.folders);
  };

  const addFolder = async () => {
    const folder = await pickFolder(t("library.addFolder"));
    if (folder && folder !== root && !library.folders.includes(folder))
      await rescan([...library.folders, folder]);
  };

  const scannedAt = library.scannedAt
    ? new Intl.DateTimeFormat(lang, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(library.scannedAt))
    : null;

  const summary = result
    ? [
        t("library.imported", { n: result.imported.length }),
        result.duplicates
          ? t("library.duplicates", { n: result.duplicates })
          : "",
        result.skipped ? t("library.skippedFiles", { n: result.skipped }) : "",
        result.errors.length
          ? t("library.importErrors", { n: result.errors.length })
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <Dialog
      title={t("library.title")}
      onClose={onClose}
      className="library-dialog"
    >
      <div className="library-bar">
        <input
          type="search"
          autoFocus
          placeholder={t(
            mode === "text" ? "library.searchText" : "library.search",
          )}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (
              mode === "boards" &&
              e.key === "Enter" &&
              entries[0] &&
              entries[0].boards.length + entries[0].schematics.length > 0
            )
              onOpen(entries[0]);
          }}
        />
        <div className="segmented" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "boards"}
            className={mode === "boards" ? "on" : undefined}
            onClick={() => setMode("boards")}
          >
            {t("library.modeBoards")}
          </button>
          <button
            role="tab"
            aria-selected={mode === "text"}
            className={mode === "text" ? "on" : undefined}
            onClick={() => setMode("text")}
          >
            {t("library.modeText")}
          </button>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void pickImport(t("library.import"), BOARD_EXTENSIONS).then(runImport)}
          title={t("library.importHint")}
        >
          {t("library.import")}
        </button>
        <button onClick={() => void addFolder()}>
          {t("library.addFolder")}
        </button>
        <button
          onClick={() => void rescan(library.folders)}
          disabled={scanning || busy}
        >
          {scanning ? t("library.scanning") : t("library.rescan")}
        </button>
        <button onClick={() => setSortingAll(true)} disabled={!root || scanning || busy} title={t("autosort.buttonHint")}>
          {t("autosort.button")}
        </button>
        <button onClick={() => setDupes(true)} disabled={!root || busy}>
          {t("dupes.find")}
        </button>
      </div>

      {/* Import, XZZ conversion and the collection fold away so the list gets the room. */}
      <details
        className="library-tools"
        open={toolsOpen || busy}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open;
          if (open === (toolsOpen || busy)) return;
          setToolsOpen(open);
          try {
            localStorage.setItem(TOOLS_KEY, open ? "1" : "0");
          } catch {
            // ignore
          }
        }}
      >
        <summary>
          <span className="library-tools-title">{t("library.tools")}</span>
          <span className="muted library-tools-note">
            {converting ?? (collecting ? t("collection.title") : summary ?? t("library.toolsHint"))}
          </span>
        </summary>
      <div className="library-import">
        <CategoryFields
          value={importCategory}
          onChange={setImportCategory}
          tree={tree}
        />
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void pickImport(t("library.import"), BOARD_EXTENSIONS).then(
              runImport,
            )
          }
        >
          {importing ? t("library.scanning") : t("library.import")}
        </button>
        <p className="muted import-hint">
          {summary ?? t("library.importHint")}
          {sortedNote && <span className="autosort-note"> · {sortedNote}</span>}
        </p>
        <label className="check autosort-toggle" title={t("autosort.toggleHint")}>
          <input
            type="checkbox"
            checked={autoSort}
            onChange={(e) => {
              setAutoSort(e.target.checked);
              saveAutoSort(e.target.checked);
            }}
          />
          {t("autosort.toggle")}
        </label>
      </div>

      <section className="library-convert" aria-labelledby="convert-title" aria-busy={converting !== null}>
        <div>
          <h3 id="convert-title">{t("convert.title")}</h3>
          <p className="muted">{t("convert.hint")}</p>
        </div>
        <div className="conversion-actions">
          <button onClick={() => void runConversion()} disabled={busy}>{t("convert.choose")}</button>
          <button onClick={() => void runConversion(true)} disabled={busy}>{t("convert.chooseFolder")}</button>
        </div>
        <div className="conversion-status" role="status" aria-live="polite">
          {converting ?? (conversion && t("convert.done", {
            n: conversion.files.filter((f) => !f.duplicate).length,
            duplicates: conversion.files.filter((f) => f.duplicate).length,
            errors: conversion.errors.length,
          }))}
          {conversion && conversion.remaining > 0 && ` · ${t("convert.remaining", { n: conversion.remaining })}`}
        </div>
        {conversionProgress && <div className="conversion-progress">
          <progress value={conversionProgress.completed} max={conversionProgress.total} aria-label={t("convert.title")} />
          <button disabled={stopping} onClick={() => { conversionAbort.current?.abort(); setStopping(true); }}>
            {t(stopping ? "convert.stopping" : "convert.stop")}
          </button>
        </div>}
        <div className="conversion-results">
        {conversion?.files.filter((f, i, all) => all.findIndex((other) => other.path === f.path) === i).map((file) => (
          <div className="conversion-result" key={file.path}>
          <div className="conversion-file">
            <span>{file.path.split(/[\\/]/).pop()} · {t("convert.counts", { parts: file.parts, pins: file.pins })}</span>
            <button onClick={() => openConverted(file)}>{t("convert.open")}</button>
          </div>
          {file.report && <details className="conversion-report">
            <summary>{t("convert.report")}</summary>
            <p>{t("convert.geometry", { traces: file.report.traces, arcs: file.report.arcs, vias: file.report.vias, contours: file.report.contours, texts: file.report.texts, layers: file.report.layers.length })}</p>
            <p>{t("convert.readings", { assigned: file.report.assignedReadings, total: file.report.readings })}</p>
            {file.report.unreadableReadings > 0 && <p className="library-warn">{t("convert.unreadableReadings", { n: file.report.unreadableReadings })}</p>}
            <p>{t("convert.outline", { lines: file.report.outlineLines, arcs: file.report.outlineArcs })}</p>
            <p>{t("convert.originalKept")}</p>
            <button onClick={() => void saveOriginalXzz(file.path, t("convert.saveOriginal")).catch((error) => {
              setConversion((current) => current ? { ...current, errors: [...current.errors, String(error)] } : current);
            })}>{t("convert.saveOriginal")}</button>
            {file.report.warnings.map((warning, i) => <p className="library-warn" key={i}>{warning}</p>)}
            {file.report.preservedBlocks.length > 0 && <p>{t("convert.preservedBlocks", { n: file.report.preservedBlocks.length })}</p>}
            {file.report.images.length > 0 && <details><summary>{t("convert.imageReferences", { n: file.report.images.length })}</summary>
              <ul>{file.report.images.map((image, i) => <li key={i}>{image.name} · {image.width} × {image.height}</li>)}</ul>
            </details>}
            {file.report.boardTexts.length > 0 && <details><summary>{t("convert.boardTexts", { n: file.report.boardTexts.length })}</summary>
              <ul>{file.report.boardTexts.map((text, i) => <li key={i}>{text.text} · {text.x}, {text.y} · Layer {text.layer}</li>)}</ul>
            </details>}
            {file.report.sections.map((section, i) => <details key={i}><summary>{t("convert.metadata")} · {section.name}</summary><pre>{section.text}</pre></details>)}
          </details>}
          </div>
        ))}
        {conversion?.errors.map((message, i) => <p className="library-warn" key={`${i}-${message}`}>{message}</p>)}
        </div>
      </section>

      <section className="library-convert" aria-labelledby="collection-title" aria-busy={collecting}>
        <div>
          <h3 id="collection-title">{t("collection.title")}</h3>
          <p className="muted">{t("collection.hint")}</p>
        </div>
        <button onClick={() => void runCollection()} disabled={busy}>{t("collection.choose")}</button>
        <div className="conversion-status" role="status" aria-live="polite">
          {collecting ? (collectionProgress ? t("collection.progress", {
            index: collectionProgress.completed, total: collectionProgress.total, name: collectionProgress.name,
          }) : t("collection.choose")) : collection && t("collection.done", {
            n: collection.imported.length, duplicates: collection.duplicates, boards: collection.boards,
            schematics: collection.schematics, converted: collection.converted, errors: collection.errors.length,
          })}
        </div>
        {collectionProgress && <div className="conversion-progress">
          <progress value={collectionProgress.completed} max={collectionProgress.total} aria-label={t("collection.title")} />
        </div>}
        {collection?.errors.length ? <details className="collection-errors"><summary>{t("library.importErrors", { n: collection.errors.length })}</summary>
          {collection.errors.map((message, i) => <p className="library-warn" key={`${i}-${message}`}>{message}</p>)}
        </details> : null}
      </section>
      </details>

      <div className="library-folders">
        {root && (
          <span className="folder-chip own" title={root}>
            {t("library.ownFolder")}
            <button
              className="tool icon-only"
              onClick={() => void revealInFinder(root)}
              aria-label={t("library.reveal")}
              title={t("library.reveal")}
            >
              <OpenIcon />
            </button>
          </span>
        )}
        {library.folders.map((f) => (
          <span key={f} className="folder-chip" title={f}>
            {f.split("/").filter(Boolean).pop()}
            <button
              className="tool icon-only"
              onClick={() =>
                void rescan(library.folders.filter((x) => x !== f))
              }
              aria-label={t("library.removeFolder")}
              title={t("library.removeFolder")}
            >
              <CloseIcon size={12} />
            </button>
          </span>
        ))}
        <span className="muted library-meta">
          {library.scan &&
            t("library.count", {
              n: library.scan.entries.length,
              files: library.scan.files,
            })}
          {scannedAt && ` · ${scannedAt}`}
        </span>
      </div>

      {library.scan?.truncated && (
        <p className="library-warn">
          {t("library.truncated", { files: library.scan.files })}
        </p>
      )}
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

      {mode === "text" ? (
        <LibraryText
          entries={library.scan?.entries ?? []}
          query={query}
          onOpen={onOpenText}
        />
      ) : (library.scan?.entries.length ?? 0) === 0 && !scanning ? (
        <p className="library-empty">{t("library.empty")}</p>
      ) : (
        <div className="library-main">
          <CategoryTree
            tree={tree}
            selected={branch}
            total={all.length}
            unsorted={unsorted}
            onSelect={setBranch}
          />
          <div className="library-list">
            {entries.length === 0 && !scanning && (
              <div className="library-empty">
                <p>{t("library.noMatch")}</p>
                {(branch || query) && (
                  <button
                    className="small"
                    onClick={() => {
                      setBranch("");
                      setQuery("");
                    }}
                  >
                    {t("library.showAll")}
                  </button>
                )}
              </div>
            )}
            <VirtualList
              items={entries}
              rowHeight={54}
              render={(e) => {
                const usable = e.boards.length + e.schematics.length > 0;
                const first =
                  e.boards[0] ?? e.schematics[0] ?? e.unsupported[0];
                return (
                  <div className="library-item">
                    <button
                      className="library-row"
                      disabled={!usable}
                      onClick={() => onOpen(e)}
                      title={usable ? undefined : t("library.unsupported")}
                    >
                      <span className="library-title">{e.title}</span>
                      <span className="library-folder">{e.folder || "/"}</span>
                      <span className="library-files">
                        {[...e.boards, ...e.schematics].map((f) => (
                          <span
                            key={f.path}
                            className="file-badge"
                            title={f.path}
                          >
                            {badge(f.name)}
                          </span>
                        ))}
                        {e.unsupported.map((f) => (
                          <span
                            key={f.path}
                            className="file-badge unsupported"
                            title={`${f.path} · ${t("library.unsupported")}`}
                          >
                            {badge(f.name)}
                          </span>
                        ))}
                      </span>
                    </button>
                    {first && e.root === root && (
                      <button
                        className="tool icon-only reveal"
                        onClick={() => setSorting(e)}
                        aria-label={t("category.action")}
                        title={t("category.action")}
                      >
                        <TagIcon />
                      </button>
                    )}
                    {first && (
                      <button
                        className="tool icon-only reveal"
                        onClick={() =>
                          setRenaming({
                            title: e.title,
                            paths: [
                              ...e.boards,
                              ...e.schematics,
                              ...e.unsupported,
                            ].map((f) => f.path),
                          })
                        }
                        aria-label={t("rename.action")}
                        title={t("rename.action")}
                      >
                        <RenameIcon />
                      </button>
                    )}
                    {first && e.root === root && (
                      <button
                        className="tool icon-only reveal danger"
                        onClick={() => void remove(e)}
                        aria-label={t("library.delete")}
                        title={t("library.delete")}
                      >
                        <TrashIcon />
                      </button>
                    )}
                    {first && (
                      <button
                        className="tool icon-only reveal"
                        onClick={() => void revealInFinder(first.path)}
                        aria-label={t("library.reveal")}
                        title={t("library.reveal")}
                      >
                        <OpenIcon />
                      </button>
                    )}
                  </div>
                );
              }}
            />
          </div>
        </div>
      )}
      {sorting && (
        <CategoryDialog
          entry={sorting}
          tree={tree}
          onDone={(changed) => {
            setSorting(null);
            if (changed) void rescan(library.folders);
          }}
        />
      )}
      {sortingAll && root && library.scan && (
        <AutoSortDialog
          entries={unsortedEntries(library.scan.entries, root)}
          tree={tree}
          onDone={(changed) => {
            setSortingAll(false);
            if (changed) void rescan(library.folders);
          }}
        />
      )}
      {dupes && root && (
        <DuplicatesDialog
          root={root}
          folders={library.folders}
          onDone={(changed) => {
            setDupes(false);
            if (changed) void rescan(library.folders);
          }}
        />
      )}
      {renaming && (
        <RenameFiles
          target={renaming}
          onDone={(changed) => {
            setRenaming(null);
            if (changed) void rescan(library.folders);
          }}
        />
      )}
    </Dialog>
  );
}
