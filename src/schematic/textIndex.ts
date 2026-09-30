/**
 * Finds words on schematic pages and where they are.
 *
 * pdf.js reports text as runs with a transform; this splits runs into words
 * and gives each word a box in page coordinates (viewport at scale 1, Y
 * down), including rotated text, which schematics use for vertical labels.
 */

/** Rectangle in page coordinates. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Word {
  /** Upper-case text used for matching. */
  key: string;
  text: string;
  page: number;
  box: Box;
}

/** The subset of pdf.js' TextItem this module needs. */
export interface TextRun {
  str: string;
  /** Text matrix already combined with the page viewport transform. */
  transform: number[];
  /** Run length along the text direction, in page units. */
  width: number;
}

// Characters that never belong to a part or net name.
const SEPARATORS = /[\s,;()[\]{}<>"'=|]+/;
const TRIM = /^[.:]+|[.:]+$/g;

export function wordsFromRuns(runs: TextRun[], page: number): Word[] {
  const words: Word[] = [];
  for (const run of runs) {
    const str = run.str;
    if (!str.trim()) continue;
    const [a, b, c, d, e, f] = run.transform;
    const along = Math.hypot(a, b) || 1;
    const size = Math.hypot(c, d) || along;
    const ux = a / along;
    const uy = b / along;
    // "Up" in viewport space (Y down) is the direction of the text matrix's
    // second column.
    const vx = c / size;
    const vy = d / size;
    const perChar = run.width / str.length;

    let offset = 0;
    for (const part of str.split(SEPARATORS)) {
      const start = str.indexOf(part, offset);
      offset = start + part.length;
      const trimmed = part.replace(TRIM, "");
      if (!trimmed) continue;
      const lead = part.indexOf(trimmed);
      const from = (start + lead) * perChar;
      const to = from + trimmed.length * perChar;
      // Baseline quad, extended a little below for descenders.
      const corners = [
        [e + ux * from - vx * size * 0.2, f + uy * from - vy * size * 0.2],
        [e + ux * to - vx * size * 0.2, f + uy * to - vy * size * 0.2],
        [e + ux * from + vx * size * 0.9, f + uy * from + vy * size * 0.9],
        [e + ux * to + vx * size * 0.9, f + uy * to + vy * size * 0.9],
      ];
      words.push({
        key: trimmed.toUpperCase(),
        text: trimmed,
        page,
        box: {
          x0: Math.min(...corners.map((p) => p[0])),
          y0: Math.min(...corners.map((p) => p[1])),
          x1: Math.max(...corners.map((p) => p[0])),
          y1: Math.max(...corners.map((p) => p[1])),
        },
      });
    }
  }
  return words;
}

/** All words of a document, looked up by upper-case text. */
export class WordIndex {
  private readonly byKey = new Map<string, Word[]>();
  private readonly byPage = new Map<number, Word[]>();

  add(words: Word[]): void {
    for (const w of words) {
      let list = this.byKey.get(w.key);
      if (!list) this.byKey.set(w.key, (list = []));
      list.push(w);
      let page = this.byPage.get(w.page);
      if (!page) this.byPage.set(w.page, (page = []));
      page.push(w);
    }
  }

  /** Occurrences in reading order: by page, then top to bottom, left to right. */
  find(text: string): Word[] {
    const list = this.byKey.get(text.trim().toUpperCase()) ?? [];
    return [...list].sort((a, b) => a.page - b.page || a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  }

  onPage(page: number): Word[] {
    return this.byPage.get(page) ?? [];
  }

  /** The word under a point on a page, preferring the smallest box. */
  wordAt(page: number, x: number, y: number, slop = 0): Word | undefined {
    let best: Word | undefined;
    let bestArea = Infinity;
    for (const w of this.onPage(page)) {
      const b = w.box;
      if (x < b.x0 - slop || x > b.x1 + slop || y < b.y0 - slop || y > b.y1 + slop) continue;
      const area = (b.x1 - b.x0) * (b.y1 - b.y0);
      if (area < bestArea) {
        bestArea = area;
        best = w;
      }
    }
    return best;
  }
}
