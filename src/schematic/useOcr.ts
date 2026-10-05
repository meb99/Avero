import { invoke } from "@tauri-apps/api/core";
import { addOcrToLibraryIndex } from "../workbench/fulltext";
import { useEffect, useRef, useState } from "react";
import type { SchematicDocument } from "./document";
import { fixRecognised, recognizePages, type OcrProgress } from "./ocr";
import type { Word } from "./textIndex";

/** Stored recognition of one PDF: per page its words as [text, x0, y0, x1, y1]. */
interface OcrCache {
  version: 1;
  pages: Record<string, [string, number, number, number, number][]>;
}

/**
 * The cache key of a PDF's recognised text: its content, so a replaced file
 * under the same name and path is read again (name, path and page count only
 * when the content is unknown).
 */
export function ocrKey(doc: Pick<SchematicDocument, "name" | "path" | "pageCount" | "contentId">): string {
  if (doc.contentId) return `ocr-${doc.contentId}`;
  const s = `${doc.path ?? ""}|${doc.name}|${doc.pageCount}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return `${doc.name.replace(/\.pdf$/i, "").slice(0, 40)}-${h.toString(16)}`;
}

export function parseOcrCache(json: string | null): OcrCache {
  try {
    const d = json ? (JSON.parse(json) as OcrCache) : null;
    if (d?.version === 1 && d.pages && typeof d.pages === "object") return d;
  } catch {
    // A broken cache is read again.
  }
  return { version: 1, pages: {} };
}

export function cachedWords(cache: OcrCache, page: number): Word[] {
  return (cache.pages[page] ?? []).map(([text, x0, y0, x1, y1]) => ({ key: text.toUpperCase(), text, page, box: { x0, y0, x1, y1 } }));
}

const round = (n: number) => Math.round(n * 10) / 10;

export interface OcrState {
  /** Scanned pages still without words. */
  scanned: number;
  progress: OcrProgress | null;
  error: string | null;
  start(): void;
  cancel(): void;
}

/**
 * Text recognition for the scanned pages of a schematic: what was read
 * before comes from the data folder at once, the rest on request.
 */
export function useOcr(doc: SchematicDocument, indexComplete: boolean, known?: (key: string) => boolean): OcrState {
  const [scanned, setScanned] = useState(0);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<OcrCache>({ version: 1, pages: {} });
  const stop = useRef(false);
  // Scanned pages not read yet (a page read without result is not read again).
  const remaining = () => doc.textlessPages().filter((p) => !(String(p) in cacheRef.current.pages));

  useEffect(() => {
    setScanned(0);
    setProgress(null);
    setError(null);
    stop.current = true;
    if (!indexComplete) return;
    const pages = doc.textlessPages();
    if (pages.length === 0) return;
    let gone = false;
    invoke<string | null>("load_ocr", { key: ocrKey(doc) })
      .catch(() => null)
      .then((json) => {
        if (gone) return;
        const cache = parseOcrCache(json);
        cacheRef.current = cache;
        for (const p of pages) {
          const words = cachedWords(cache, p);
          if (words.length) doc.addWords(p, words);
        }
        setScanned(remaining().length);
      });
    return () => {
      gone = true;
    };
  }, [doc, indexComplete]);

  const start = () => {
    const pages = remaining();
    if (pages.length === 0 || progress) return;
    stop.current = false;
    setError(null);
    setProgress({ done: 0, total: pages.length });
    const key = ocrKey(doc);
    recognizePages(
      doc,
      pages,
      (page, found, p) => {
        // Board spelling for names OCR got nearly right.
        const fix = (w: Word): Word => {
          const key = known ? fixRecognised(w.key, known) : w.key;
          return key === w.key ? w : { ...w, key, text: key };
        };
        const words = found.map(fix);
        doc.addWords(page, words);
        cacheRef.current.pages[page] = words.map((w) => [w.text, round(w.box.x0), round(w.box.y0), round(w.box.x1), round(w.box.y1)]);
        // Saved after every page: a long document is not read twice.
        void invoke("save_ocr", { key, data: JSON.stringify(cacheRef.current) }).catch(() => {});
        // The library's text search finds recognised words too.
        if (doc.path) void addOcrToLibraryIndex(doc.path, cacheRef.current, doc.pageCount).catch(() => {});
        setProgress(p);
      },
      () => stop.current,
    ).then(
      () => {
        setProgress(null);
        setScanned(remaining().length);
      },
      (e: unknown) => {
        setProgress(null);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };

  return {
    scanned,
    progress,
    error,
    start,
    cancel: () => {
      stop.current = true;
    },
  };
}
