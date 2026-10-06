/**
 * Orientation aids drawn over the board: a mm or mil grid through the
 * board's own origin, and that origin itself. Board units are mils.
 */
import type { Camera } from "../core/camera";
import { MILS_PER_MM, type Point } from "../core/types";

/** Grid steps in mils, finest first: 0.1 mm … 50 mm, or 5 … 1000 mil. */
const MM_STEPS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50].map((mm) => mm * MILS_PER_MM);
const MIL_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000];

/** Lines at least this far apart on screen (CSS pixels). */
const MIN_GAP = 14;

/** The finest step that keeps lines `MIN_GAP` apart at this zoom, and every how many lines one is stronger. */
export function gridStep(scale: number, units: "mm" | "mil"): { step: number; major: number } {
  const steps = units === "mm" ? MM_STEPS : MIL_STEPS;
  const step = steps.find((s) => s * scale >= MIN_GAP) ?? steps[steps.length - 1];
  // 1, 10, 100 … and 2.5, 25 … get a strong line every 4 (one round unit); the rest every 5 or 10.
  const value = units === "mm" ? step / MILS_PER_MM : step;
  const lead = Number(value.toPrecision(2)) / 10 ** Math.floor(Math.log10(value));
  return { step, major: lead === 2.5 ? 4 : lead === 5 ? 2 : 10 };
}

/** Grid lines on screen: board coordinates of the vertical (x) and horizontal (y) ones. */
export function gridLines(view: { minX: number; minY: number; maxX: number; maxY: number }, origin: Point, step: number, limit = 400): { xs: number[]; ys: number[] } {
  const along = (min: number, max: number, o: number) => {
    const first = Math.ceil((min - o) / step);
    const last = Math.floor((max - o) / step);
    if (last - first > limit) return [];
    const out: number[] = [];
    for (let k = first; k <= last; k++) out.push(o + k * step);
    return out;
  };
  return { xs: along(view.minX, view.maxX, origin.x), ys: along(view.minY, view.maxY, origin.y) };
}

/** The grid over what the camera shows. */
export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, units: "mm" | "mil", origin: Point | null, dark: boolean, dpr: number): void {
  const { step, major } = gridStep(camera.scale, units);
  const o = origin ?? { x: 0, y: 0 };
  const view = camera.visibleBounds();
  const { xs, ys } = gridLines(view, o, step);
  if (xs.length === 0 && ys.length === 0) return;
  const isMajor = (v: number, base: number) => Math.abs(Math.round((v - base) / step) % major) === 0;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const minor = dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.07)";
  const strong = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.16)";
  const line = (a: Point, b: Point, color: string) => {
    const p = camera.toScreen(a);
    const q = camera.toScreen(b);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
    ctx.lineTo(Math.round(q.x) + 0.5, Math.round(q.y) + 0.5);
    ctx.stroke();
  };
  ctx.lineWidth = 1;
  for (const x of xs) line({ x, y: view.minY }, { x, y: view.maxY }, isMajor(x, o.x) ? strong : minor);
  for (const y of ys) line({ x: view.minX, y }, { x: view.maxX, y }, isMajor(y, o.y) ? strong : minor);
  ctx.restore();
}

/** The board's own origin: a cross in a ring. */
export function drawOrigin(ctx: CanvasRenderingContext2D, camera: Camera, origin: Point, dpr: number): void {
  const p = camera.toScreen(origin);
  if (p.x < -20 || p.y < -20 || p.x > camera.width + 20 || p.y > camera.height + 20) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#ff9100";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.moveTo(p.x - 11, p.y);
  ctx.lineTo(p.x + 11, p.y);
  ctx.moveTo(p.x, p.y - 11);
  ctx.lineTo(p.x, p.y + 11);
  ctx.stroke();
  ctx.restore();
}
