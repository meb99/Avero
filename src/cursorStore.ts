/**
 * Where the mouse is on the board, for the status bar. Kept outside React state so a mouse
 * move redraws only the status bar's readout, not the whole app.
 */
import { useSyncExternalStore } from "react";
import type { ViewSide } from "./core/board";
import type { Point } from "./core/types";

/** Board coordinates in mil, already relative to the board's own origin when it has one. */
export type BoardCursor = (Point & { side: ViewSide; fromOrigin: boolean }) | null;

let current: BoardCursor = null;
const listeners = new Set<() => void>();

export function setBoardCursor(cursor: BoardCursor): void {
  if (cursor === current || (cursor && current && cursor.x === current.x && cursor.y === current.y && cursor.side === current.side)) return;
  current = cursor;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useBoardCursor(): BoardCursor {
  return useSyncExternalStore(subscribe, () => current);
}
