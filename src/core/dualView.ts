/**
 * Both sides of a board at once, the way FlexBV shows them: the top side as
 * it is and the bottom side beside it (below a wide board, to the right of a
 * tall one), turned over as in the single view: mirrored left to right as if
 * the board were turned in the hand (the default), top to bottom, or not at all.
 *
 * "Layout" coordinates hold both: the top side keeps its board coordinates,
 * the bottom side is turned over about the board's middle and shifted by
 * `offset`. One camera looks at the layout; the bottom side is drawn with its
 * own camera that puts every board point where the layout says.
 */
import type { ViewSide } from "./board";
import { Camera, type BottomFlip } from "./camera";
import type { Bounds, Point } from "./types";

export interface DualLayout {
  /** Board bounds, one side. */
  board: Bounds;
  /** How the bottom side is turned over about the board's middle. */
  flip: BottomFlip;
  /** Bottom side: layout = turned-over point + offset. */
  offset: Point;
  /** Both sides together. */
  bounds: Bounds;
}

export function dualLayout(board: Bounds, flip: BottomFlip = "leftRight"): DualLayout {
  const w = board.maxX - board.minX;
  const h = board.maxY - board.minY;
  const gap = Math.max(w, h) * 0.05;
  // A wide board gets the bottom side below it, a tall one to its right.
  const offset = w >= h ? { x: 0, y: -(h + gap) } : { x: w + gap, y: 0 };
  return {
    board,
    flip,
    offset,
    bounds: {
      minX: board.minX,
      minY: board.minY + Math.min(0, offset.y),
      maxX: board.maxX + Math.max(0, offset.x),
      maxY: board.maxY,
    },
  };
}

/** The bottom side turned over about the board's middle; its own inverse. */
function turnOver(p: Point, layout: DualLayout): Point {
  const b = layout.board;
  if (layout.flip === "none") return p;
  return layout.flip === "topBottom" ? { x: p.x, y: b.minY + b.maxY - p.y } : { x: b.minX + b.maxX - p.x, y: p.y };
}

/** Where a board point of a side is drawn in the layout. */
export function toLayout(p: Point, side: ViewSide, layout: DualLayout): Point {
  if (side === "top") return p;
  const q = turnOver(p, layout);
  return { x: q.x + layout.offset.x, y: q.y + layout.offset.y };
}

/** The board point of a layout point on a side. */
export function fromLayout(p: Point, side: ViewSide, layout: DualLayout): Point {
  return side === "top" ? p : turnOver({ x: p.x - layout.offset.x, y: p.y - layout.offset.y }, layout);
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
  // Layout = R·p + o with R the turn-over: the camera folds R into its own
  // transform and centers on R⁻¹(c − o), the board point under the center.
  const center = fromLayout({ x: master.centerX, y: master.centerY }, "bottom", layout);
  cam.centerX = center.x;
  cam.centerY = center.y;
  if (layout.flip !== "none") cam.mirrored = !master.mirrored;
  // Mirrored left to right and turned half way round is mirrored top to bottom.
  if (layout.flip === "topBottom") cam.rotation = (master.rotation + 2) & 3;
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
