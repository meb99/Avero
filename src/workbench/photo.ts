/**
 * Photos of the real board laid over the boardview.
 *
 * A photo is aligned by two points picked on the photo and the same two
 * points picked on the board. That fixes a similarity transform (scale,
 * rotation, shift). Photo pixels have Y pointing down and board mils Y
 * pointing up, so a photo of the top side is mirrored against the board;
 * a photo of the bottom side, taken of the turned-over board, is not.
 */
import { visibleFrom, type BoardModel, type ViewSide } from "../core/board";
import type { Point } from "../core/types";

/** Photo pixel (u, v) → board (A·u + C·v + E, B·u + D·v + F). */
export type Affine = [number, number, number, number, number, number];

export interface BoardPhoto {
  /** Copy of the photo in the app's data folder. */
  file: string;
  matrix: Affine;
  /** 0–1. */
  opacity: number;
}

export type PhotoSide = "top" | "bottom";

export function alignPhoto(side: PhotoSide, photo: [Point, Point], board: [Point, Point]): Affine | null {
  // Complex numbers: board = a·z + b with z = u − iv (top) or u + iv (bottom).
  const sign = side === "top" ? -1 : 1;
  const z1 = { re: photo[0].x, im: sign * photo[0].y };
  const z2 = { re: photo[1].x, im: sign * photo[1].y };
  const dz = { re: z2.re - z1.re, im: z2.im - z1.im };
  const dq = { re: board[1].x - board[0].x, im: board[1].y - board[0].y };
  const n = dz.re * dz.re + dz.im * dz.im;
  if (n < 1e-9 || Math.hypot(dq.re, dq.im) < 1e-9) return null;
  // a = dq / dz
  const a = { re: (dq.re * dz.re + dq.im * dz.im) / n, im: (dq.im * dz.re - dq.re * dz.im) / n };
  const b = { re: board[0].x - (a.re * z1.re - a.im * z1.im), im: board[0].y - (a.re * z1.im + a.im * z1.re) };
  // a·z = (a.re·u − a.im·s·v) + i(a.im·u + a.re·s·v), s = sign
  return [a.re, a.im, -a.im * sign, a.re * sign, b.re, b.im];
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Board → photo, the other way round; null if the matrix is degenerate. */
export function invertAffine(m: Affine): Affine | null {
  const det = m[0] * m[3] - m[2] * m[1];
  if (Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Board mils per photo unit (the photo's width is one unit). */
export function photoScale(m: Affine): number {
  return Math.hypot(m[0], m[1]);
}

/**
 * The part at a board point clicked on a photo. A body under the point wins,
 * the smallest first (a capacitor beside a shield, not the shield); otherwise
 * the closest part within `slack` mils, because an alignment from two points
 * is a little off away from them.
 */
export function partAtPoint(model: BoardModel, p: Point, view: ViewSide, slack: number): { inside?: number; near?: number } {
  let inside: number | undefined;
  let insideArea = Infinity;
  let near: number | undefined;
  let nearDist = Infinity;
  model.partIndex.query({ minX: p.x - slack, minY: p.y - slack, maxX: p.x + slack, maxY: p.y + slack }, (i) => {
    const part = model.parts[i];
    if (!visibleFrom(part.side, view)) return;
    const b = part.bounds;
    const d = Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY));
    if (d === 0 && !part.marker) {
      const area = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (area < insideArea) {
        insideArea = area;
        inside = i;
      }
    } else if (d <= slack && d < nearDist) {
      nearDist = d;
      near = i;
    }
  });
  return { inside, near };
}

/** Board positions of the photo's corners: top-left, top-right, bottom-left, bottom-right. */
export function photoCorners(m: Affine, width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map((p) => applyAffine(m, p));
}

export function parsePhoto(value: unknown): BoardPhoto | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Partial<BoardPhoto>;
  if (typeof p.file !== "string" || !Array.isArray(p.matrix) || p.matrix.length !== 6) return undefined;
  if (!p.matrix.every((x) => typeof x === "number" && Number.isFinite(x))) return undefined;
  const opacity = typeof p.opacity === "number" ? Math.min(1, Math.max(0, p.opacity)) : 0.8;
  return { file: p.file, matrix: p.matrix as Affine, opacity };
}
