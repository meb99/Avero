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
  /** False when a second side is drawn onto the same canvas. */
  clear = true,
  /** Values under part names from the schematic, by part index; else the board's device text. */
  values?: ReadonlyMap<number, string>,
): void {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) ctx.clearRect(0, 0, width, height);
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
    // Parts on the highlighted net get a name tag in the highlight color.
    const onNet = new Set<number>();
    if (highlightedNet !== undefined) for (const pin of model.nets[highlightedNet].pins) onNet.add(model.pins[pin].part);
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
      // Big chips get big names, as in FlexBV.
      let size = Math.min(Math.max(Math.min(w, h) * 0.32, 9), 34);
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
      if (onNet.has(i)) {
        ctx.fillStyle = palette.labelNetBg;
        ctx.fillRect(c.x - tw / 2 - 3, y - size / 2 - 2, tw + 6, size + 4);
        ctx.fillStyle = palette.labelNetText;
        ctx.fillText(part.name, c.x, y);
        continue;
      }
      ctx.strokeText(part.name, c.x, y);
      ctx.fillStyle = size >= 16 ? palette.labelChip : palette.label;
      ctx.fillText(part.name, c.x, y);
      // The value under the name once there is room, as FlexBV shows it ("1uF", "LT3957").
      const valueText = (values?.get(i) ?? part.device)?.trim();
      if (valueText && inside && y === spots[0] && size >= 10 && h >= size * 2.7) {
        const small = Math.max(8, size * 0.55);
        ctx.font = `500 ${small}px ${FONT}`;
        let value = valueText;
        while (value.length > 3 && ctx.measureText(value).width > w * 0.92) value = value.slice(0, -2);
        if (value !== valueText) value = `${value}…`;
        const vy = y + size * 0.62 + small * 0.6;
        ctx.strokeText(value, c.x, vy);
        ctx.fillStyle = palette.label;
        ctx.globalAlpha = 0.75;
        ctx.fillText(value, c.x, vy);
        ctx.globalAlpha = 1;
      }
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

/** A board note as the labels layer draws it. */
export interface MarkerMark {
  id: string;
  x: number;
  y: number;
  side: ViewSide;
  text: string;
}

const MARKER_HEAD = 7;
const MARKER_STEM = 16;
const MARKER_TEXT = 34;

/** Screen geometry of a marker: pin head above the spot, text bubble beside it. */
export function markerLayout(ctx: CanvasRenderingContext2D | null, camera: Camera, m: MarkerMark) {
  const p = camera.toScreen(m);
  const head = { x: p.x, y: p.y - MARKER_STEM };
  const text = m.text.length > MARKER_TEXT ? `${m.text.slice(0, MARKER_TEXT - 1)}…` : m.text;
  const width = ctx ? ctx.measureText(text).width : text.length * 6.5;
  const bubble = { x0: head.x + MARKER_HEAD + 4, y0: head.y - 10, x1: head.x + MARKER_HEAD + 14 + width, y1: head.y + 10 };
  return { point: p, head, text, bubble };
}

/** The marker under a screen point, if any. */
export function markerAt(camera: Camera, markers: readonly MarkerMark[], x: number, y: number): MarkerMark | undefined {
  for (let i = markers.length - 1; i >= 0; i--) {
    const l = markerLayout(null, camera, markers[i]);
    if (Math.hypot(x - l.head.x, y - l.head.y) <= MARKER_HEAD + 4) return markers[i];
    if (markers[i].text && x >= l.bubble.x0 && x <= l.bubble.x1 && y >= l.bubble.y0 && y <= l.bubble.y1) return markers[i];
  }
  return undefined;
}

/** Board notes as red pins with their text; the far side's ones faint, or hidden when sides are kept apart. */
export function drawMarkers(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  markers: readonly MarkerMark[],
  view: ViewSide,
  palette: Palette,
  dpr: number,
  active: string | null,
  showOtherSide = false,
): void {
  if (markers.length === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const m of markers) {
    if (m.side !== view && !showOtherSide) continue;
    const l = markerLayout(ctx, camera, m);
    ctx.globalAlpha = m.side === view ? 1 : 0.35;
    ctx.strokeStyle = "#7f1d1d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(l.point.x, l.point.y);
    ctx.lineTo(l.head.x, l.head.y);
    ctx.stroke();
    ctx.fillStyle = m.id === active ? "#f59e0b" : "#dc2626";
    ctx.beginPath();
    ctx.arc(l.head.x, l.head.y, MARKER_HEAD, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (l.text) {
      const b = l.bubble;
      ctx.fillStyle = palette.labelHalo;
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = palette.label;
      ctx.fillText(l.text, b.x0 + 5, l.head.y + 0.5);
    }
  }
  ctx.globalAlpha = 1;
}
