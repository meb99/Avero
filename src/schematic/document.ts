// The legacy build carries polyfills for the very recent JavaScript APIs the
// modern build relies on (e.g. Map.getOrInsertComputed), which WKWebView on
// current macOS releases does not have yet.
import { getDocument, GlobalWorkerOptions, Util, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PdfTextIndex } from "../workbench/fulltext";
import { splitWords, WordIndex, wordsFromRuns, type TextRun, type Word } from "./textIndex";

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * Asks for the password of a protected PDF (`retry`: the last one was
 * wrong); null cancels. Set by each window that can show a question.
 */
export type PasswordPrompt = (name: string, retry: boolean) => Promise<string | null>;
let passwordPrompt: PasswordPrompt | null = null;
export function setPdfPasswordPrompt(prompt: PasswordPrompt | null): void {
  passwordPrompt = prompt;
}
// Passwords given in this session, so a reopened PDF does not ask again.
const knownPasswords = new Map<string, string>();

function openPdf(bytes: Uint8Array, name = "", ask = false): Promise<PDFDocumentProxy> {
  const key = `${name}|${bytes.length}`;
  const known = knownPasswords.get(key);
  const task = getDocument({
    data: bytes,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    ...(known && { password: known }),
  });
  if (ask && passwordPrompt) {
    const prompt = passwordPrompt;
    let tried = false;
    task.onPassword = (update: (password: string) => void) => {
      void prompt(name, tried).then((password) => {
        if (password === null) {
          void task.destroy();
          return;
        }
        tried = true;
        knownPasswords.set(key, password);
        update(password);
      });
    };
  }
  return task.promise;
}

/**
 * Which words appear on which pages, for the library's full-text search.
 * Stops early when `cancelled` turns true.
 */
/** A short hash of a file's bytes (SHA-256, hex, first 16 characters). */
let documentCount = 0;

export async function contentId(bytes: Uint8Array): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // No WebCrypto: FNV-1a over the length and all bytes.
    let h = 0x811c9dc5 ^ bytes.length;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    return `f${h.toString(16)}`;
  }
}

export async function extractTextIndex(bytes: Uint8Array, cancelled: () => boolean): Promise<PdfTextIndex | null> {
  const pdf = await openPdf(bytes);
  try {
    const words: Record<string, number[]> = {};
    for (let p = 0; p < pdf.numPages; p++) {
      if (cancelled()) return null;
      const page = await pdf.getPage(p + 1);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        for (const word of splitWords(item.str)) {
          const pages = (words[word] ??= []);
          if (pages[pages.length - 1] !== p) pages.push(p);
        }
      }
      page.cleanup();
    }
    return { v: 1, pages: pdf.numPages, words };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export interface OutlineEntry {
  title: string;
  /** Zero-based page, or null when the bookmark points nowhere useful. */
  page: number | null;
  children: OutlineEntry[];
}

export interface PageSize {
  width: number;
  height: number;
}

/**
 * An open schematic PDF plus a word index that is built in the background,
 * page by page, so the viewer is usable immediately.
 */
export class SchematicDocument {
  readonly index = new WordIndex();
  private indexed = 0;
  /** Words found per page: none on a page with text means a scan. */
  private readonly wordCount: number[] = [];
  /** Counts additions after the PDF text (recognised scans). */
  private added = 0;
  private readonly sizes: (PageSize | undefined)[];
  private readonly listeners = new Set<() => void>();
  private cancelled = false;
  /** Tells open documents apart (the same file may be opened for two boards). */
  readonly id = ++documentCount;

  private constructor(
    readonly pdf: PDFDocumentProxy,
    readonly name: string,
    readonly path: string | undefined,
    /** Hash of the file's bytes: another PDF under the same name and path has another one. */
    readonly contentId?: string,
  ) {
    this.sizes = new Array(pdf.numPages);
  }

  static async open(bytes: Uint8Array, name: string, path?: string): Promise<SchematicDocument> {
    // Before pdf.js takes the bytes: the content decides which recognised text belongs to the file.
    const id = await contentId(bytes);
    const pdf = await openPdf(bytes, name, true);
    const doc = new SchematicDocument(pdf, name, path, id);
    void doc.buildIndex();
    return doc;
  }

  get pageCount(): number {
    return this.pdf.numPages;
  }

  /** Pages whose words are searchable so far. */
  get indexedPages(): number {
    return this.indexed;
  }

  get indexComplete(): boolean {
    return this.indexed >= this.pageCount;
  }

  /** Called whenever more pages have been indexed. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  page(index: number): Promise<PDFPageProxy> {
    return this.pdf.getPage(index + 1);
  }

  async pageSize(index: number): Promise<PageSize> {
    const known = this.sizes[index];
    if (known) return known;
    const vp = (await this.page(index)).getViewport({ scale: 1 });
    const size = { width: vp.width, height: vp.height };
    this.sizes[index] = size;
    return size;
  }

  async outline(): Promise<OutlineEntry[]> {
    const raw = await this.pdf.getOutline().catch(() => null);
    if (!raw) return [];
    type RawNode = { title: string; dest: string | unknown[] | null; items: RawNode[] };
    const resolve = async (node: RawNode): Promise<OutlineEntry> => {
      let page: number | null = null;
      try {
        const dest = typeof node.dest === "string" ? await this.pdf.getDestination(node.dest) : node.dest;
        const ref = dest?.[0];
        if (typeof ref === "number") page = ref;
        else if (ref && typeof ref === "object") page = await this.pdf.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
      } catch {
        page = null;
      }
      return { title: node.title, page, children: await Promise.all(node.items.map(resolve)) };
    };
    return Promise.all((raw as RawNode[]).map(resolve));
  }

  private async buildIndex(): Promise<void> {
    for (let i = 0; i < this.pageCount && !this.cancelled; i++) {
      try {
        const page = await this.page(i);
        const viewport = page.getViewport({ scale: 1 });
        this.sizes[i] = { width: viewport.width, height: viewport.height };
        const content = await page.getTextContent();
        const runs: TextRun[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str) continue;
          runs.push({ str: item.str, width: item.width, transform: Util.transform(viewport.transform, item.transform) });
        }
        const words = wordsFromRuns(runs, i);
        this.index.add(words);
        this.wordCount[i] = words.length;
      } catch {
        // A broken page must not stop the rest of the document from indexing.
      }
      this.indexed = i + 1;
      for (const l of this.listeners) l();
    }
  }

  /** Pages without a text layer (scans), once indexing is through. */
  textlessPages(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.indexed; i++) if (!this.wordCount[i]) out.push(i);
    return out;
  }

  /** Changes whenever words are added after indexing (recognised text). */
  get revision(): number {
    return this.added;
  }

  /** Words that came from text recognition (shown as such where a match is checked). */
  private readonly recognised = new WeakSet<Word>();
  isRecognised(w: Word): boolean {
    return this.recognised.has(w);
  }

  /** Recognised words of a scanned page, searchable like PDF text. */
  addWords(page: number, words: Word[]): void {
    if (this.cancelled) return;
    for (const w of words) this.recognised.add(w);
    this.index.add(words);
    this.wordCount[page] = (this.wordCount[page] ?? 0) + words.length;
    this.added++;
    for (const l of this.listeners) l();
  }

  destroy(): void {
    this.cancelled = true;
    this.listeners.clear();
    void this.pdf.loadingTask.destroy();
  }
}
