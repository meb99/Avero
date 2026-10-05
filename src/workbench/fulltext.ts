/**
 * Full-text search over all schematics of the library.
 *
 * Each PDF is indexed once (which words appear on which pages) and the
 * index is cached in the app's data folder under a key made of the file's
 * path, size and modification time, so a changed file is indexed again.
 */
import { invoke } from "@tauri-apps/api/core";
import type { LibraryFile } from "./library";

export interface PdfTextIndex {
  v: 1;
  pages: number;
  /** Upper-case word → zero-based pages it appears on, ascending. */
  words: Record<string, number[]>;
}

export interface FullTextHit {
  path: string;
  /** Zero-based pages with a match, ascending. */
  pages: number[];
  /** Distinct matching words, a few at most. */
  words: string[];
  /** Matching word-page pairs, for ranking. */
  count: number;
}

/** FNV-1a (64-bit) as hex: a short, stable file name for a cache entry. */
export function hashKey(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function indexKey(file: LibraryFile): string {
  return `text-${hashKey(`${file.path}|${file.size}|${file.modified}`)}`;
}

/** Schematics whose words contain `query`, most matches first. */
export function searchText(indexes: Iterable<[string, PdfTextIndex]>, query: string, limit = 200): FullTextHit[] {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const hits: FullTextHit[] = [];
  for (const [path, index] of indexes) {
    const pages = new Set<number>();
    const words: string[] = [];
    let count = 0;
    for (const word in index.words) {
      if (!word.includes(q)) continue;
      const on = index.words[word];
      count += on.length;
      for (const p of on) pages.add(p);
      if (words.length < 5) words.push(word);
    }
    if (count > 0) hits.push({ path, pages: [...pages].sort((a, b) => a - b), words, count });
  }
  hits.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

export function parseTextIndex(json: string): PdfTextIndex | null {
  try {
    const d = JSON.parse(json) as Partial<PdfTextIndex>;
    return d.v === 1 && typeof d.pages === "number" && d.words && typeof d.words === "object" ? (d as PdfTextIndex) : null;
  } catch {
    return null;
  }
}

// In memory for the session, so reopening the library is instant.
const loaded = new Map<string, PdfTextIndex>();

/** The cached index of a schematic, or null when it was not indexed yet. */
export async function cachedIndex(file: LibraryFile): Promise<PdfTextIndex | null> {
  const key = indexKey(file);
  const hit = loaded.get(key);
  if (hit) return hit;
  const json = await invoke<string | null>("load_text_index", { key });
  const index = json ? parseTextIndex(json) : null;
  if (index) loaded.set(key, index);
  return index;
}

export async function storeIndex(file: LibraryFile, index: PdfTextIndex): Promise<void> {
  const key = indexKey(file);
  loaded.set(key, index);
  await invoke("save_text_index", { key, data: JSON.stringify(index) });
}

/** Recognised words per page, as the OCR cache keeps them. */
export interface OcrPages {
  pages: Record<string, [string, ...number[]][]>;
}

/** A text index with the words recognised on scanned pages added. */
export function withOcrWords(index: PdfTextIndex, ocr: OcrPages | null): PdfTextIndex {
  if (!ocr) return index;
  const words: Record<string, number[]> = { ...index.words };
  let pages = index.pages;
  for (const [page, list] of Object.entries(ocr.pages)) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 0) continue;
    pages = Math.max(pages, p + 1);
    for (const [text] of list) {
      const word = text.toUpperCase();
      const on = words[word] ? [...words[word]] : [];
      if (!on.includes(p)) on.push(p);
      words[word] = on.sort((a, b) => a - b);
    }
  }
  return { ...index, pages, words };
}

/** Adds recognised words of an open schematic to the library's index of that file. */
export async function addOcrToLibraryIndex(path: string, ocr: OcrPages, pageCount: number): Promise<void> {
  const [size, modified] = await invoke<[number, number]>("file_stamp", { path });
  const file = { path, name: path.split("/").pop() ?? path, size, modified };
  const base = (await cachedIndex(file)) ?? { v: 1 as const, pages: pageCount, words: {} };
  await storeIndex(file, withOcrWords(base, ocr));
}
