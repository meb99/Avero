/**
 * The board tool: what the next click on the board means – placing a marker, drawing,
 * moving a drawing, measuring with the ruler or aligning a photo. Only one is in use at a
 * time; starting one ends the other. Pure transitions, the app does what follows from them
 * (storing a drawing, deleting an abandoned photo). See GLOSSARY.md: Werkzeug.
 */
import type { ViewSide } from "./core/board";
import type { Point } from "./core/types";
import { DRAWING_POINTS, type DrawingKind } from "./workbench/notes";

/** A drawing being made: its points so far and what each one sits on ("U7.3 · PP3V3" or ""). */
export interface Draft {
  kind: DrawingKind;
  side: ViewSide;
  points: Point[];
  ends: string[];
}

/** A photo being aligned: two points on the photo, then the same two on the board. */
export interface PhotoAlignment {
  side: ViewSide;
  file: string;
  image: HTMLCanvasElement;
  /** True for a photo imported for this alignment (deleted when cancelled). */
  fresh: boolean;
  /** Points to pick: 2 (straight photo), 3 (slightly squashed), 4 (taken at an angle). */
  count: 2 | 3 | 4;
  photoPoints: Point[];
  boardPoints: Point[];
}

export type BoardTool =
  | { kind: "none" }
  | { kind: "marker" }
  | { kind: "draw"; draft: Draft }
  | { kind: "move"; drawing: string }
  | { kind: "ruler"; side: ViewSide; points: Point[] }
  | { kind: "align"; alignment: PhotoAlignment };

export const NO_TOOL: BoardTool = { kind: "none" };
export const MARKER_TOOL: BoardTool = { kind: "marker" };

export const drawTool = (kind: DrawingKind, side: ViewSide): BoardTool => ({ kind: "draw", draft: { kind, side, points: [], ends: [] } });
export const rulerTool = (side: ViewSide): BoardTool => ({ kind: "ruler", side, points: [] });
export const moveTool = (drawing: string): BoardTool => ({ kind: "move", drawing });
export const alignTool = (alignment: PhotoAlignment): BoardTool => ({ kind: "align", alignment });

/** The marker tool on, or off when it is on. */
export const toggleMarker = (tool: BoardTool): BoardTool => (tool.kind === "marker" ? NO_TOOL : MARKER_TOOL);

/** A fresh ruler, or none when the ruler is in use. */
export const toggleRuler = (tool: BoardTool, side: ViewSide): BoardTool => (tool.kind === "ruler" ? NO_TOOL : rulerTool(side));

/**
 * The ruler after a click: the first point, the second, then a new first one. The side is
 * where the first point was clicked.
 */
export function rulerPoint(tool: BoardTool, point: Point, clicked: ViewSide): BoardTool {
  if (tool.kind !== "ruler") return tool;
  if (tool.points.length >= 2) return { kind: "ruler", side: clicked, points: [point] };
  return { kind: "ruler", side: tool.points.length ? tool.side : clicked, points: [...tool.points, point] };
}

/**
 * The drawing after a click. A shape with all its points is done (`finished`) and the tool
 * ends; an area takes points until it is finished by hand.
 */
export function drawPoint(tool: BoardTool, point: Point, clicked: ViewSide, label: string): { tool: BoardTool; finished?: Draft } {
  if (tool.kind !== "draw") return { tool };
  const d = tool.draft;
  const next: Draft = { ...d, side: d.points.length ? d.side : clicked, points: [...d.points, point], ends: [...d.ends, label] };
  if (next.kind !== "area" && next.points.length >= DRAWING_POINTS[next.kind]) return { tool: NO_TOOL, finished: next };
  return { tool: { kind: "draw", draft: next } };
}

/** The area being drawn, to finish it by hand (Enter or the button). */
export const openArea = (tool: BoardTool): Draft | null => (tool.kind === "draw" && tool.draft.kind === "area" ? tool.draft : null);

/** The alignment with a change to it; other tools stay as they are. */
export const changeAlignment = (tool: BoardTool, change: (a: PhotoAlignment) => PhotoAlignment): BoardTool =>
  tool.kind === "align" ? { kind: "align", alignment: change(tool.alignment) } : tool;

/**
 * Whether a click on the board goes to the tool instead of selecting. The photo alignment
 * takes clicks once the points on the photo are picked. `secondView`: the other side's view
 * beside the board, where drawings can't be moved and photos not aligned.
 */
export function takesClicks(tool: BoardTool, secondView = false): boolean {
  switch (tool.kind) {
    case "none":
      return false;
    case "align":
      return !secondView && tool.alignment.photoPoints.length >= tool.alignment.count;
    case "move":
      return !secondView;
    default:
      return true;
  }
}

/**
 * The photo file a tool leaves behind when it ends for another one: a photo imported for
 * an alignment that was not finished. Null when there is nothing to clean up.
 */
export function abandonedPhoto(tool: BoardTool, next: BoardTool): string | null {
  if (tool.kind !== "align" || !tool.alignment.fresh) return null;
  if (next.kind === "align" && next.alignment.file === tool.alignment.file) return null;
  return tool.alignment.file;
}
