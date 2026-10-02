/**
 * Photos of the real board laid over the boardview.
 *
 * A photo is aligned by points picked on the photo and the same points
 * picked on the board. Two fix a similarity transform (scale, rotation,
 * shift), three an affine one (also a slightly squashed photo), four a
 * perspective one (a board photographed at an angle, or a microscope that
 * does not look straight down). Photo pixels have Y pointing down and board mils Y
 * pointing up, so a photo of the top side is mirrored against the board;
 * a photo of the bottom side, taken of the turned-over board, is not.
 */
import { visibleFrom, type BoardModel, type ViewSide } from "../core/board";
import type { Bounds, Point } from "../core/types";

/** Photo pixel (u, v) → board (A·u + C·v + E, B·u + D·v + F). */
export type Affine = [number, number, number, number, number, number];

/**
 * Photo pixel (u, v) → board, with perspective: (h0·u + h1·v + h2, h3·u + h4·v + h5) / (h6·u + h7·v + h8).
 * For a board photographed at an angle, aligned by four points.
 */
export type Homography = [number, number, number, number, number, number, number, number, number];

export interface BoardPhoto {
  /** Copy of the photo in the app's data folder. */
  file: string;
  /** The alignment, or its affine part when `perspective` is set. */
  matrix: Affine;
  /** Perspective alignment from four points; wins over `matrix`. */
  perspective?: Homography;
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

/** The affine transform through three point pairs; null if the points lie on one line. */
export function affineFrom3(photo: Point[], board: Point[]): Affine | null {
  const [p0, p1, p2] = photo;
  const det = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  if (Math.abs(det) < 1e-9) return null;
  // Board = M·(photo − p0) + board0, M from the two edge vectors.
  const du1 = p1.x - p0.x, dv1 = p1.y - p0.y, du2 = p2.x - p0.x, dv2 = p2.y - p0.y;
  const bx1 = board[1].x - board[0].x, by1 = board[1].y - board[0].y, bx2 = board[2].x - board[0].x, by2 = board[2].y - board[0].y;
  const a = (bx1 * dv2 - bx2 * dv1) / det;
  const c = (bx2 * du1 - bx1 * du2) / det;
  const b = (by1 * dv2 - by2 * dv1) / det;
  const d = (by2 * du1 - by1 * du2) / det;
  return [a, b, c, d, board[0].x - a * p0.x - c * p0.y, board[0].y - b * p0.x - d * p0.y];
}

/** The perspective transform through four point pairs; null if three of them lie on one line. */
export function homographyFrom4(photo: Point[], board: Point[]): Homography | null {
  for (const pts of [photo, board])
    for (let i = 0; i < 4; i++) {
      const [a, b, c] = [0, 1, 2, 3].filter((k) => k !== i).map((k) => pts[k]);
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) < 1e-9 * (1 + Math.hypot(b.x - a.x, b.y - a.y) ** 2)) return null;
    }
  // Eight equations for h0..h7 (h8 = 1), solved by Gaussian elimination.
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = photo[i];
    const { x, y } = board[i];
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    if (Math.abs(rows[pivot][col]) < 1e-12) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = rows[r][col] / rows[col][col];
      for (let k = col; k < 9; k++) rows[r][k] -= f * rows[col][k];
    }
  }
  const h = rows.map((r, i) => r[8] / r[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, k, l] = h;
  const A = e * l - f * k, B = -(d * l - f * g), C = d * k - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  const inv: Homography = [A, -(b * l - c * k), b * f - c * e, B, a * l - c * g, -(a * f - c * d), C, -(a * k - b * g), a * e - b * d];
  return inv.map((x) => x / det) as Homography;
}

/** Photo units → board, by whichever alignment the photo has. */
export function photoToBoard(photo: Pick<BoardPhoto, "matrix" | "perspective">, p: Point): Point {
  return photo.perspective ? applyHomography(photo.perspective, p) : applyAffine(photo.matrix, p);
}

/** Board → photo units; a function, so the inverse is worked out once. */
export function boardToPhoto(photo: Pick<BoardPhoto, "matrix" | "perspective">): ((p: Point) => Point) | null {
  if (photo.perspective) {
    const inv = invertHomography(photo.perspective);
    return inv && ((p) => applyHomography(inv, p));
  }
  const inv = invertAffine(photo.matrix);
  return inv && ((p) => applyAffine(inv, p));
}

/**
 * The alignment from the picked points: 2 → similarity, 3 → affine,
 * 4 → perspective (with the affine of the first three as `matrix`).
 */
export function alignFromPoints(side: PhotoSide, photo: Point[], board: Point[]): Pick<BoardPhoto, "matrix" | "perspective"> | null {
  if (photo.length >= 4 && board.length >= 4) {
    const perspective = homographyFrom4(photo.slice(0, 4), board.slice(0, 4));
    const matrix = affineFrom3(photo, board);
    return perspective && matrix ? { matrix, perspective } : null;
  }
  if (photo.length === 3 && board.length === 3) {
    const matrix = affineFrom3(photo, board);
    return matrix && { matrix };
  }
  const matrix = alignPhoto(side, [photo[0], photo[1]], [board[0], board[1]]);
  return matrix && { matrix };
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

/** Pixel box of a picture's content, in pixels of the picture. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where the board is in a picture: everything that differs from the colour
 * of the corners (a plain background or page margin around the board).
 * `rgba` is the picture, possibly scaled down; the box is in its pixels.
 */
export function contentBox(rgba: Uint8ClampedArray, width: number, height: number, tolerance = 40): PixelBox | null {
  const at = (x: number, y: number) => (y * width + x) * 4;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + rgba[i + c], 0) / 4);
  const differs = (x: number, y: number) => {
    const i = at(x, y);
    return Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2]) > tolerance;
  };
  // A row or column belongs to the board when a few percent of it differs (noise, thin lines do not count).
  const rowHas = (y: number) => {
    let n = 0;
    for (let x = 0; x < width; x++) if (differs(x, y)) n++;
    return n > width * 0.02;
  };
  const colHas = (x: number) => {
    let n = 0;
    for (let y = 0; y < height; y++) if (differs(x, y)) n++;
    return n > height * 0.02;
  };
  let y0 = 0;
  while (y0 < height && !rowHas(y0)) y0++;
  let y1 = height - 1;
  while (y1 > y0 && !rowHas(y1)) y1--;
  let x0 = 0;
  while (x0 < width && !colHas(x0)) x0++;
  let x1 = width - 1;
  while (x1 > x0 && !colHas(x1)) x1--;
  if (x1 - x0 < width * 0.2 || y1 - y0 < height * 0.2) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Lays a picture of the whole board (as seen from above, like the board
 * pictures that come with boardviews) onto the board outline. Returns null
 * when the shapes differ too much for that to be right: the picture then
 * needs aligning by hand.
 */
export function fitToBounds(box: PixelBox, imageWidth: number, bounds: Bounds): Affine | null {
  const w = (box.x1 - box.x0) / imageWidth;
  const h = (box.y1 - box.y0) / imageWidth;
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  if (w <= 0 || h <= 0 || bw <= 0 || bh <= 0) return null;
  if (Math.abs(Math.log(w / h / (bw / bh))) > Math.log(1.12)) return null;
  const sx = bw / w;
  const sy = bh / h;
  const u0 = box.x0 / imageWidth;
  const v0 = box.y0 / imageWidth;
  // Picture Y points down, board Y up.
  return [sx, 0, 0, -sy, bounds.minX - u0 * sx, bounds.maxY + v0 * sy];
}

/** Board positions of the photo's corners: top-left, top-right, bottom-left, bottom-right. */
export function photoCorners(m: Affine | Pick<BoardPhoto, "matrix" | "perspective">, width: number, height: number): Point[] {
  const photo = Array.isArray(m) ? { matrix: m } : m;
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map((p) => photoToBoard(photo, p));
}

export function parsePhoto(value: unknown): BoardPhoto | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Partial<BoardPhoto>;
  if (typeof p.file !== "string" || !Array.isArray(p.matrix) || p.matrix.length !== 6) return undefined;
  if (!p.matrix.every((x) => typeof x === "number" && Number.isFinite(x))) return undefined;
  const opacity = typeof p.opacity === "number" ? Math.min(1, Math.max(0, p.opacity)) : 0.8;
  const h = p.perspective;
  const perspective = Array.isArray(h) && h.length === 9 && h.every((x) => typeof x === "number" && Number.isFinite(x)) ? (h as Homography) : undefined;
  return { file: p.file, matrix: p.matrix as Affine, opacity, ...(perspective && { perspective }) };
}
