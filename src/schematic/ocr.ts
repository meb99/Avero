/**
 * Text recognition for scanned schematics, on this Mac only: pages without
 * a text layer are rendered and read by Tesseract (bundled, no internet),
 * and the words go into the same index as real PDF text, so part and net
 * names become searchable and clickable.
 *
 * Schematics label pins and nets vertically too, so every page is read
 * twice: as it is and turned a quarter.
 */
import type { SchematicDocument } from "./document";
import { splitWords, type Box, type Word } from "./textIndex";

/** One word as Tesseract reports it, in pixels of the image it read. */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Box;
}

/** Words below this confidence are mostly noise from lines and symbols. */
const MIN_CONFIDENCE = 55;
/** Longer side of the page image Tesseract reads, in pixels. */
const IMAGE_SIZE = 4200;

/**
 * Page words from Tesseract's words: back to page units (`scale` pixels
 * per unit), split like PDF text, each piece with its share of the box.
 * `turned` words were read from the page image turned a quarter clockwise;
 * `pageHeightPx` is the height of the unturned image.
 */
export function ocrToWords(found: readonly OcrWord[], page: number, scale: number, turned?: { pageHeightPx: number }): Word[] {
  const out: Word[] = [];
  for (const w of found) {
    if (w.confidence < MIN_CONFIDENCE) continue;
    const text = w.text.trim();
    if (!text) continue;
    const pieces = splitWords(text);
    if (pieces.length === 0) continue;
    const upper = text.toUpperCase();
    let at = 0;
    for (const key of pieces) {
      const start = upper.indexOf(key, at);
      at = start + key.length;
      // The piece's share of the word box along the reading direction.
      const f0 = start / text.length;
      const f1 = (start + key.length) / text.length;
      const b = w.bbox;
      let box: Box;
      if (!turned) {
        box = { x0: b.x0 + (b.x1 - b.x0) * f0, x1: b.x0 + (b.x1 - b.x0) * f1, y0: b.y0, y1: b.y1 };
      } else {
        // Image turned clockwise: image (u, v) is page (v, H − u); reading
        // left to right in the image runs bottom to top on the page.
        const u0 = b.x0 + (b.x1 - b.x0) * f0;
        const u1 = b.x0 + (b.x1 - b.x0) * f1;
        box = { x0: b.y0, x1: b.y1, y0: turned.pageHeightPx - u1, y1: turned.pageHeightPx - u0 };
      }
      out.push({
        key,
        text: text.slice(start, start + key.length),
        page,
        box: { x0: box.x0 / scale, y0: box.y0 / scale, x1: box.x1 / scale, y1: box.y1 / scale },
      });
    }
  }
  return out;
}

/** Words of a page image Tesseract found, flattened from its block tree. */
type Blocks = { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null;
const flatten = (blocks: Blocks): OcrWord[] => (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));

export interface OcrProgress {
  /** Pages done of `total`. */
  done: number;
  total: number;
}

/**
 * Reads the given pages and returns their words. `onPage` gets each page's
 * words as soon as they are there; `cancelled` stops after the current page.
 */
export async function recognizePages(
  doc: SchematicDocument,
  pages: readonly number[],
  onPage: (page: number, words: Word[], progress: OcrProgress) => void,
  cancelled: () => boolean,
): Promise<void> {
  const { createWorker } = await import("tesseract.js");
  const base = new URL("/ocr/", window.location.href).href;
  const worker = await createWorker("eng", 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
    langPath: base.replace(/\/$/, ""),
    workerBlobURL: false,
    cacheMethod: "none",
    gzip: true,
  });
  try {
    // Labels and pin numbers are sparse text, not paragraphs.
    await worker.setParameters({ tessedit_pageseg_mode: "11" as never, preserve_interword_spaces: "0" });
    let done = 0;
    for (const index of pages) {
      if (cancelled()) break;
      const page = await doc.page(index);
      const unit = page.getViewport({ scale: 1 });
      const scale = IMAGE_SIZE / Math.max(unit.width, unit.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const straight = await worker.recognize(canvas, {}, { blocks: true });
      // The same page turned a quarter clockwise, for vertical labels.
      const turnedCanvas = document.createElement("canvas");
      turnedCanvas.width = canvas.height;
      turnedCanvas.height = canvas.width;
      const tctx = turnedCanvas.getContext("2d")!;
      tctx.translate(turnedCanvas.width, 0);
      tctx.rotate(Math.PI / 2);
      tctx.drawImage(canvas, 0, 0);
      const turned = await worker.recognize(turnedCanvas, {}, { blocks: true });
      const words = [
        ...ocrToWords(flatten(straight.data.blocks as Blocks), index, scale),
        ...ocrToWords(flatten(turned.data.blocks as Blocks), index, scale, { pageHeightPx: canvas.height }),
      ];
      canvas.width = canvas.height = turnedCanvas.width = turnedCanvas.height = 0;
      done++;
      onPage(index, words, { done, total: pages.length });
    }
  } finally {
    await worker.terminate();
  }
}

/** Characters OCR mixes up in part and net names. */
const CONFUSED: Record<string, string> = { O: "0", "0": "O", I: "1", "1": "I", L: "1", S: "5", "5": "S", B: "8", "8": "B", Z: "2", "2": "Z", G: "6", "6": "G" };

/**
 * The board's spelling of a recognised word: when the word is no part or
 * net name but becomes one by swapping commonly confused characters
 * (PPOV9_SOC → PP0V9_SOC). Tries one swap, then all swaps of one kind.
 */
export function fixRecognised(key: string, known: (key: string) => boolean): string {
  if (known(key)) return key;
  const chars = [...key];
  for (let i = 0; i < chars.length; i++) {
    const alt = CONFUSED[chars[i]];
    if (!alt) continue;
    const variant = [...chars.slice(0, i), alt, ...chars.slice(i + 1)].join("");
    if (known(variant)) return variant;
  }
  for (const [from, to] of Object.entries(CONFUSED)) {
    if (!key.includes(from)) continue;
    const variant = key.split(from).join(to);
    if (known(variant)) return variant;
  }
  return key;
}
