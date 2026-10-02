/**
 * Both sides of a board at once, the way FlexBV shows them: the top side as
 * it is and the bottom side beside it (below a wide board, to the right of a
 * tall one), mirrored as if the board were turned over.
 *
 * "Layout" coordinates hold both: the top side keeps its board coordinates,
 * the bottom side is mirrored about the board's middle and shifted by
 * `offset`. One camera looks at the layout; the bottom side is drawn with a
 * mirrored camera that puts every board point where the layout says.
 */
import type { ViewSide } from "./board";
import { Camera } from "./camera";
import type { Bounds, Point } from "./types";

export interface DualLayout {
  /** Board bounds, one side. */
  board: Bounds;
  /** Bottom side: layout = (mirror − x + offset.x, y + offset.y). */
  mirror: number;
  offset: Point;
  /** Both sides together. */
  bounds: Bounds;
}

export function dualLayout(board: Bounds): DualLayout {
  const w = board.maxX - board.minX;
  const h = board.maxY - board.minY;
  const gap = Math.max(w, h) * 0.05;
  // A wide board gets the bottom side below it, a tall one to its right.
  const offset = w >= h ? { x: 0, y: -(h + gap) } : { x: w + gap, y: 0 };
  return {
    board,
    mirror: board.minX + board.maxX,
    offset,
    bounds: {
      minX: board.minX,
      minY: board.minY + Math.min(0, offset.y),
      maxX: board.maxX + Math.max(0, offset.x),
      maxY: board.maxY,
    },
  };
}

/** Where a board point of a side is drawn in the layout. */
export function toLayout(p: Point, side: ViewSide, layout: DualLayout): Point {
  return side === "top" ? p : { x: layout.mirror - p.x + layout.offset.x, y: p.y + layout.offset.y };
}

/** The board point of a layout point on the bottom side (the mirroring is its own inverse). */
export function fromLayout(p: Point, side: ViewSide, layout: DualLayout): Point {
  return side === "top" ? p : { x: layout.mirror - (p.x - layout.offset.x), y: p.y - layout.offset.y };
}

export function boundsToLayout(b: Bounds, side: ViewSide, layout: DualLayout): Bounds {
  const a = toLayout({ x: b.minX, y: b.minY }, side, layout);
  const c = toLayout({ x: b.maxX, y: b.maxY }, side, layout);
  return { minX: Math.min(a.x, c.x), minY: Math.min(a.y, c.y), maxX: Math.max(a.x, c.x), maxY: Math.max(a.y, c.y) };
}

/**
 * The camera that draws the bottom side: board points land where the
 * layout camera `master` shows their layout position.
 */
export function bottomCamera(master: Camera, layout: DualLayout): Camera {
  const cam = master.clone();
  cam.mirrored = !master.mirrored;
  // Layout = R·p + o with R = mirror in x; the camera center c' = R·(c − o).
  const ox = layout.mirror + layout.offset.x;
  const oy = layout.offset.y;
  cam.centerX = ox - master.centerX;
  cam.centerY = master.centerY - oy;
  return cam;
}

/** The side under a layout point: the nearer of the two board areas. */
export function sideAt(p: Point, layout: DualLayout): ViewSide {
  const b = layout.board;
  const distance = (minX: number, minY: number, maxX: number, maxY: number) =>
    Math.hypot(Math.max(minX - p.x, 0, p.x - maxX), Math.max(minY - p.y, 0, p.y - maxY));
  const top = distance(b.minX, b.minY, b.maxX, b.maxY);
  const o = layout.offset;
  const bottom = distance(b.minX + o.x, b.minY + o.y, b.maxX + o.x, b.maxY + o.y);
  return bottom < top ? "bottom" : "top";
}
