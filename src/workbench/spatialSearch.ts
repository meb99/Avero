import type { Box, Word } from "../schematic/textIndex";
import type { PdfTextIndex } from "./fulltext";

export interface SpatialHit {
  path: string;
  page: number;
  box: Box;
  words: Word[];
}
const canonical = (s: string) => s.toUpperCase().replace(/[µΜ]/g, "U").replace(/^[.:]+|[.:]+$/g, "");
const center = (w: Word) => [(w.box.x0 + w.box.x1) / 2, (w.box.y0 + w.box.y1) / 2];
const distance = (a: Word, b: Word) => {
  const [ax, ay] = center(a), [bx, by] = center(b);
  return Math.hypot(ax - bx, ay - by);
};

/** All terms must occur on one page, every pair within the chosen radius.
 * Exact tokens avoid 16V matching 116V, or 0201 matching 02010.
 * Search starts with the rarest term and stops at a bounded result count. */
export function searchNearby(indexes: Iterable<[string, PdfTextIndex]>, query: string, radius = 50, limit = 200, onLimit?:()=>void): SpatialHit[] {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(canonical);
  if (!terms.length || terms.length > 12 || !Number.isFinite(radius) || radius <= 0) return [];
  const out: SpatialHit[] = [];
  for (const [path, index] of indexes) {
    if (!index.positions) continue;
    const pages = new Map<number, Word[][]>();
    for (const w of index.positions) {
      const key = canonical(w.key);
      const matches = terms.map((t, i) => t === key ? i : -1).filter((i) => i >= 0);
      if (!matches.length) continue;
      const groups = pages.get(w.page) ?? terms.map(() => [] as Word[]);
      matches.forEach((i) => groups[i].push(w));
      pages.set(w.page, groups);
    }
    for (const [page, groups] of pages) {
      if (groups.some((g) => !g.length)) continue;
      const order = groups.map((_, i) => i).sort((a, b) => groups[a].length - groups[b].length);
      const seen = new Set<string>();
      let budget = 100_000;
      const visit = (depth: number, chosen: Word[]) => {
        if (out.length >= limit || --budget < 0) {onLimit?.();return;}
        if (depth === order.length) {
          const box = { x0: Math.min(...chosen.map((w) => w.box.x0)), y0: Math.min(...chosen.map((w) => w.box.y0)), x1: Math.max(...chosen.map((w) => w.box.x1)), y1: Math.max(...chosen.map((w) => w.box.y1)) };
          const key = `${box.x0}:${box.y0}:${box.x1}:${box.y1}`;
          if (!seen.has(key)) { seen.add(key); out.push({ path, page, box, words: [...chosen] }); }
          return;
        }
        for (const w of groups[order[depth]]) {
          if (budget < 0 || out.length >= limit) break;
          if (chosen.some((other) => other === w || distance(w, other) > radius)) continue;
          visit(depth + 1, [...chosen, w]);
        }
      };
      visit(0, []);
      if(budget<0)onLimit?.();
      if (out.length >= limit) {onLimit?.();return out;}
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.page - b.page || a.box.y0 - b.box.y0);
}
