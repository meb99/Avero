import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readFileBytes } from "../core/loader";
import { loadSettings } from "../settings";
import { useI18n } from "../i18n";
import { cachedIndex, searchText, storeIndex, type PdfTextIndex } from "../workbench/fulltext";
import type { LibraryEntry, LibraryFile } from "../workbench/library";
import { VirtualList } from "./VirtualList";

interface Props {
  entries: LibraryEntry[];
  query: string;
  onOpen(entry: LibraryEntry, file: LibraryFile, query: string): void;
}

const isPdf = (file: LibraryFile) => /\.pdf$/i.test(file.name);

/** Words of one library file: schematic text by page, or a board's part and net names. */
async function buildIndex(file: LibraryFile, stop: () => boolean): Promise<PdfTextIndex | null> {
  if (isPdf(file)) {
    const { extractTextIndex } = await import("../schematic/document");
    return extractTextIndex(await readFileBytes(file.path), stop);
  }
  const { xzzKey, fzKey } = loadSettings();
  const names = await invoke<string[]>("board_words", { path: file.path, xzzKey: xzzKey || null, fzKey: fzKey || null });
  return { v: 1, pages: 1, words: Object.fromEntries(names.map((n) => [n, [0]])) };
}

/** Full-text search over the schematics and boardviews of the library. */
export function LibraryText({ entries, query, onOpen }: Props) {
  const { t } = useI18n();
  const pdfs = useMemo(
    () => entries.flatMap((entry) => [...entry.schematics, ...entry.boards].map((file) => ({ entry, file }))),
    [entries],
  );
  const byPath = useMemo(() => new Map(pdfs.map((p) => [p.file.path, p])), [pdfs]);
  const [indexes, setIndexes] = useState(new Map<string, PdfTextIndex>());
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState<{ done: number; total: number; name: string } | null>(null);
  const stop = useRef(false);

  // Indexes built earlier come from the cache.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = new Map<string, PdfTextIndex>();
      for (let i = 0; i < pdfs.length && !cancelled; i += 8) {
        const batch = pdfs.slice(i, i + 8);
        const loaded = await Promise.all(batch.map(({ file }) => cachedIndex(file).catch(() => null)));
        loaded.forEach((index, k) => index && found.set(batch[k].file.path, index));
      }
      if (!cancelled) {
        setIndexes(found);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfs]);

  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );

  const missing = pdfs.filter((p) => !indexes.has(p.file.path));

  const build = async () => {
    stop.current = false;
    for (let i = 0; i < missing.length && !stop.current; i++) {
      const { file } = missing[i];
      setBuilding({ done: i, total: missing.length, name: file.name });
      try {
        const index = await buildIndex(file, () => stop.current);
        if (!index) break;
        await storeIndex(file, index);
        setIndexes((m) => new Map(m).set(file.path, index));
      } catch {
        // A damaged or protected PDF is skipped.
      }
    }
    setBuilding(null);
  };

  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(id);
  }, [query]);
  const hits = useMemo(() => searchText(indexes, debounced), [indexes, debounced]);

  return (
    <>
      <div className="fulltext-status">
        <span className="muted">
          {loading ? t("library.scanning") : t("library.textIndexed", { n: indexes.size, total: pdfs.length })}
          {building && ` · ${t("library.indexing", { n: building.done + 1, total: building.total, name: building.name })}`}
        </span>
        {building ? (
          <button className="small" onClick={() => (stop.current = true)}>
            {t("library.stopIndex")}
          </button>
        ) : (
          !loading &&
          missing.length > 0 && (
            <button className="small primary" onClick={() => void build()}>
              {t("library.buildIndex", { n: missing.length })}
            </button>
          )
        )}
      </div>
      {debounced.trim().length < 2 ? (
        <p className="library-empty">{t("library.textHint")}</p>
      ) : hits.length === 0 ? (
        <p className="library-empty">{t("library.noMatch")}</p>
      ) : (
        <div className="library-list">
          <VirtualList
            items={hits}
            rowHeight={54}
            render={(hit) => {
              const pdf = byPath.get(hit.path);
              if (!pdf) return null;
              const pages = hit.pages.slice(0, 12).map((p) => p + 1);
              return (
                <div className="library-item">
                  <button className="library-row" onClick={() => onOpen(pdf.entry, pdf.file, debounced.trim())}>
                    <span className="library-title">{pdf.file.name}</span>
                    <span className="library-folder">
                      {pdf.entry.title} ·{" "}
                      {isPdf(pdf.file) ? (
                        <>
                          {t("library.pagesList", { pages: pages.join(", ") })}
                          {hit.pages.length > pages.length && ` +${hit.pages.length - pages.length}`}
                        </>
                      ) : (
                        t("library.inBoard")
                      )}
                    </span>
                    <span className="library-files">
                      {hit.words.map((w) => (
                        <span key={w} className="file-badge">
                          {w}
                        </span>
                      ))}
                    </span>
                  </button>
                </div>
              );
            }}
          />
        </div>
      )}
    </>
  );
}
