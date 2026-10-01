import { markerSize, partCenter, visibleFrom, type BoardModel, type ViewSide } from "../core/board";
import type { Camera } from "../core/camera";
import type { Selection } from "../core/types";
import type { NetStatus } from "../workbench/notes";
import type { Palette } from "./palette";

export interface LabelOptions {
  partNames: boolean;
  pinNumbers: boolean;
  netNames: boolean;
}

const FONT = '-apple-system, "SF Pro Text", "Helvetica Neue", sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, monospace';
const MAX_PART_LABELS = 700;
const MAX_PIN_LABELS = 2500;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Keeps labels from piling on top of each other. */
class Occupancy {
  private readonly cells = new Map<number, Rect[]>();
  private static readonly CELL = 64;

  tryPlace(r: Rect): boolean {
    const c = Occupancy.CELL;
    const keys: number[] = [];
    for (let y = Math.floor(r.y0 / c); y <= Math.floor(r.y1 / c); y++) {
      for (let x = Math.floor(r.x0 / c); x <= Math.floor(r.x1 / c); x++) keys.push(y * 4096 + x);
    }
    for (const k of keys) {
      for (const o of this.cells.get(k) ?? []) {
        if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return false;
      }
    }
    for (const k of keys) {
      const list = this.cells.get(k);
      if (list) list.push(r);
      else this.cells.set(k, [r]);
    }
    return true;
  }
}

/** Draws text labels and the selection ring on a 2D canvas above the GL canvas. */
export function drawLabels(
  ctx: CanvasRenderingContext2D,
  model: BoardModel,
  camera: Camera,
  view: ViewSide,
  selection: Selection,
  highlightedNet: number | undefined,
  options: LabelOptions,
  palette: Palette,
  dpr: number,
  measured?: ReadonlyMap<number, NetStatus>,
): void {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  const visible = camera.visibleBounds(40);
  const s = camera.scale;
  const occupied = new Occupancy();

  // Pin labels first: they sit inside pads and must not be pushed away.
  if (options.pinNumbers || options.netNames) {
    let count = 0;
    model.pinIndex.query(visible, (i) => {
      if (count >= MAX_PIN_LABELS) return;
      const pin = model.pins[i];
      if (!visibleFrom(pin.side, view)) return;
      const r = pin.radius * s;
      if (r < 7) return;
      const p = camera.toScreen(pin);
      if (p.x < -r || p.y < -r || p.x > camera.width + r || p.y > camera.height + r) return;
      count++;
      const showNet = options.netNames && r >= 15;
      const net = model.nets[pin.net];
      // Ground and unconnected pads are dark in the dark theme (and light in
      // the light theme), so their text uses the regular label color.
      const quietPad = (net.kind === "ground" || net.kind === "unconnected") && pin.net !== highlightedNet;
      ctx.fillStyle = quietPad ? palette.label : palette.labelPin;
      if (options.pinNumbers) {
        const size = Math.min(Math.max(r * 0.75, 7), 14);
        ctx.font = `600 ${size}px ${MONO}`;
        ctx.fillText(fitText(ctx, pin.number, r * 1.8), p.x, showNet ? p.y - size * 0.45 : p.y);
      }
      if (showNet) {
        const size = Math.min(Math.max(r * 0.42, 7), 11);
        ctx.font = `500 ${size}px ${FONT}`;
        ctx.fillText(fitText(ctx, net.name, r * 1.9), p.x, p.y + size * 0.75);
      }
      occupied.tryPlace({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
    });
  }

  if (options.partNames) {
    const candidates: { i: number; w: number; h: number }[] = [];
    model.partIndex.query(visible, (i) => {
      const part = model.parts[i];
      if (!visibleFrom(part.side, view)) return;
      if (part.marker) {
        // Size unknown: chips are always named, small parts once zoomed in.
        const chip = markerSize(part) > 4;
        if (chip || s >= 1.2) candidates.push({ i, w: chip ? 36 : 22, h: chip ? 36 : 22 });
        return;
      }
      const b = part.bounds;
      const sideways = (camera.rotation & 1) === 1;
      const w = (sideways ? b.maxY - b.minY : b.maxX - b.minX) * s;
      const h = (sideways ? b.maxX - b.minX : b.maxY - b.minY) * s;
      if (Math.max(w, h) < 18) return;
      candidates.push({ i, w, h });
    });
    // Bigger parts first; they get the prime spots.
    candidates.sort((a, b) => b.w * b.h - a.w * a.h);
    const seen = new Set<number>();
    let placed = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.labelHalo;
    for (const { i, w, h } of candidates) {
      if (placed >= MAX_PART_LABELS || seen.has(i)) continue;
      seen.add(i);
      const part = model.parts[i];
      const b = part.bounds;
      const c = camera.toScreen({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
      let size = Math.min(Math.max(Math.min(w, h) * 0.35, 9), 18);
      ctx.font = `600 ${size}px ${FONT}`;
      let tw = ctx.measureText(part.name).width;
      if (tw > w * 1.15 && size > 9) {
        size = Math.max(9, (size * w * 1.15) / tw);
        ctx.font = `600 ${size}px ${FONT}`;
        tw = ctx.measureText(part.name).width;
      }
      // Try the middle of the part first, then just above and below it.
      const selected = i === model.selectedPart(selection);
      const inside = !part.marker && h >= size * 1.4 && tw <= w * 1.6;
      const spots = inside ? [c.y, c.y - h / 2 - size * 0.7, c.y + h / 2 + size * 0.7] : [c.y - h / 2 - size * 0.7, c.y + h / 2 + size * 0.7];
      let y: number | undefined;
      for (const candidate of spots) {
        const rect = { x0: c.x - tw / 2 - 2, y0: candidate - size / 2 - 1, x1: c.x + tw / 2 + 2, y1: candidate + size / 2 + 1 };
        if (occupied.tryPlace(rect)) {
          y = candidate;
          break;
        }
      }
      if (y === undefined) {
        if (!selected) continue;
        y = spots[0];
      }
      placed++;
      ctx.strokeText(part.name, c.x, y);
      ctx.fillStyle = palette.label;
      ctx.fillText(part.name, c.x, y);
    }
  }

  if (measured && measured.size > 0) drawMeasured(ctx, model, camera, view, visible, measured);
  drawSelectionRing(ctx, model, camera, selection, palette);
}

const STATUS_COLOR: Record<NetStatus, string> = {
  ok: "#43a047",
  deviation: "#e53935",
  measured: "#1e88e5",
  reference: "#8d9aa6",
};
const MAX_DOTS = 4000;

/** Small status dots on pins and test points of measured nets. */
function drawMeasured(
  ctx: CanvasRenderingContext2D,
  model: BoardModel,
  camera: Camera,
  view: ViewSide,
  visible: ReturnType<Camera["visibleBounds"]>,
  measured: ReadonlyMap<number, NetStatus>,
): void {
  let count = 0;
  const dot = (x: number, y: number, radius: number, status: NetStatus) => {
    if (count++ > MAX_DOTS) return;
    const p = camera.toScreen({ x, y });
    const r = Math.max(radius * camera.scale, 1.2);
    const size = Math.min(Math.max(r * 0.38, 2.5), 5);
    ctx.beginPath();
    ctx.arc(p.x + r * 0.72, p.y - r * 0.72, size, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_COLOR[status];
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke();
  };
  const seen = new Set<number>();
  model.pinIndex.query(visible, (i) => {
    if (seen.has(i)) return;
    seen.add(i);
    const pin = model.pins[i];
    const status = measured.get(pin.net);
    if (status && visibleFrom(pin.side, view)) dot(pin.x, pin.y, pin.radius, status);
  });
  seen.clear();
  model.testPointIndex.query(visible, (i) => {
    if (seen.has(i)) return;
    seen.add(i);
    const tp = model.testPoints[i];
    const status = measured.get(tp.net);
    if (status && visibleFrom(tp.side, view)) dot(tp.x, tp.y, tp.radius, status);
  });
}

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  model: BoardModel,
  camera: Camera,
  selection: Selection,
  palette: Palette,
): void {
  let target: { x: number; y: number; radius: number } | undefined;
  if (selection.kind === "pin") target = model.pins[selection.pin];
  else if (selection.kind === "testPoint") target = model.testPoints[selection.testPoint];
  else if (selection.kind === "part" && model.parts[selection.part].marker) {
    // Markers have a fixed size on screen, so does their ring.
    const part = model.parts[selection.part];
    const p = camera.toScreen(partCenter(part));
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.selectionRing;
    ctx.beginPath();
    ctx.arc(p.x, p.y, markerSize(part) * 1.5 + 5, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (!target) return;
  const p = camera.toScreen(target);
  const r = Math.max(target.radius * camera.scale, 1.2) + 4;
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.selectionRing;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}
