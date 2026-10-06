/**
 * The board over the live microscope picture. A calibration links points of
 * the camera's own frame (video pixels, before the digital zoom, mirror and
 * turn that only change what is shown) to points of the board; it holds as
 * long as camera and board stay where they were. A small grey copy of the
 * picture at calibration tells when they moved.
 */
import type { Point } from "../core/types";
import { applyHomography, homographyFrom4, invertHomography, type Homography } from "./photo";

export interface CameraCalibration {
  side: "top" | "bottom";
  /** Video pixels → board. */
  toBoard: Homography;
  videoWidth: number;
  videoHeight: number;
  /** The picture at calibration, 32 × 24 grey values, to notice a moved camera. */
  thumb: number[];
  created: string;
}

/** How the picture is shown: digital zoom, mirrored, quarter turns. */
export interface ShownView {
  zoom: number;
  mirror: boolean;
  turns: number;
}

/** Where the video element lies in its frame before its CSS transform (its layout box). */
export interface VideoBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Video pixels → position in the frame on screen: the video at its layout
 * box, then scaled, mirrored and turned about the box's centre as the CSS
 * transform does.
 */
export function videoToScreen(p: Point, video: { width: number; height: number }, box: VideoBox, view: ShownView): Point {
  const s0 = box.width / video.width;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // In the element, relative to its centre.
  let x = box.x + p.x * s0 - cx;
  let y = box.y + p.y * s0 - cy;
  // scale(±zoom, zoom), then rotate.
  x *= view.mirror ? -view.zoom : view.zoom;
  y *= view.zoom;
  const a = (view.turns * Math.PI) / 2;
  const [c, s] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  return { x: cx + c * x - s * y, y: cy + s * x + c * y };
}

export function screenToVideo(p: Point, video: { width: number; height: number }, box: VideoBox, view: ShownView): Point {
  const s0 = box.width / video.width;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const a = (view.turns * Math.PI) / 2;
  const [c, s] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  const dx = p.x - cx;
  const dy = p.y - cy;
  // Turn back, then unscale.
  let x = c * dx + s * dy;
  let y = -s * dx + c * dy;
  x /= view.mirror ? -view.zoom : view.zoom;
  y /= view.zoom;
  return { x: (x + cx - box.x) / s0, y: (y + cy - box.y) / s0 };
}

/** The calibration from four point pairs (video pixels, board); null when they do not span an area. */
export function calibrate(video: Point[], board: Point[]): { toBoard: Homography; toVideo: Homography } | null {
  if (video.length < 4 || board.length < 4) return null;
  const toBoard = homographyFrom4(video.slice(0, 4), board.slice(0, 4));
  const toVideo = toBoard && invertHomography(toBoard);
  return toBoard && toVideo ? { toBoard, toVideo } : null;
}

export const videoToBoard = (cal: Pick<CameraCalibration, "toBoard">, p: Point) => applyHomography(cal.toBoard, p);

/** Board → video pixels, worked out once. */
export function boardToVideo(cal: Pick<CameraCalibration, "toBoard">): ((p: Point) => Point) | null {
  const inv = invertHomography(cal.toBoard);
  return inv && ((p) => applyHomography(inv, p));
}

/** A 32 × 24 grey copy of a picture, for noticing movement. */
export const THUMB_W = 32;
export const THUMB_H = 24;

export function greyThumb(rgba: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) out.push(Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]));
  return out;
}

/**
 * How different two grey copies are, 0–255, after evening out the overall
 * brightness (a lamp switched on is no movement).
 */
export function thumbDifference(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 255;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - ma - (b[i] - mb));
  return sum / a.length;
}

/** Above this, and for a few looks in a row, the camera or board has moved. */
export const MOVED = 14;

const CAL_KEY = (board: string) => `avero.camera.cal.${board}`;

export function loadCalibration(board: string): CameraCalibration | null {
  try {
    const v = JSON.parse(localStorage.getItem(CAL_KEY(board)) ?? "null") as CameraCalibration | null;
    return v && Array.isArray(v.toBoard) && v.toBoard.length === 9 && (v.side === "top" || v.side === "bottom") ? v : null;
  } catch {
    return null;
  }
}

export function saveCalibration(board: string, cal: CameraCalibration | null): void {
  try {
    if (cal) localStorage.setItem(CAL_KEY(board), JSON.stringify(cal));
    else localStorage.removeItem(CAL_KEY(board));
  } catch {
    // Only a convenience.
  }
}
