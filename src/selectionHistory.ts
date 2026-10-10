/**
 * The selection history of one board: back and forward through what was selected, as in a
 * browser (⌘← / ⌘→, ⌘[ / ⌘], the menu, the palette and a mouse's side buttons).
 */
import type { Selection } from "./core/types";

export interface SelectionHistory {
  readonly items: readonly Selection[];
  /** The entry shown now; -1 while nothing was selected yet. */
  readonly at: number;
}

export const EMPTY_HISTORY: SelectionHistory = { items: [], at: -1 };

const LIMIT = 200;

const same = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A selection made on the board. One the history already shows (also the one a step just
 * made) changes nothing; anything new drops what lay ahead.
 */
export function recordSelection(h: SelectionHistory, sel: Selection): SelectionHistory {
  if (sel.kind === "none") return h;
  const current = h.items[h.at];
  if (current && same(current, sel)) return h;
  const items = [...h.items.slice(0, h.at + 1), sel].slice(-LIMIT);
  return { items, at: items.length - 1 };
}

/** One step back (-1) or forward (1); null when there is nothing in that direction. */
export function stepSelection(h: SelectionHistory, step: -1 | 1): SelectionHistory | null {
  const at = h.at + step;
  return at < 0 || at >= h.items.length ? null : { items: h.items, at };
}
