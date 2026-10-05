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

/** A measured value shown at a pad: the reading, the reference under it, the comparison as color. */
export interface PadValue {
  text: string;
  /** Second line, e.g. the reference ("ref 0.450 V"). */
  sub?: string;
  status?: NetStatus;
}

/** Values to show at pins and test points (see App: chosen quantity, active case). */
export interface PadValues {
  pin(i: number): PadValue | undefined;
  testPoint(i: number): PadValue | undefined;
}

const MAX_PAD_VALUES = 900;

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
  /** Measured values written at pads, when zoomed in far enough. */
  padValues?: PadValues,
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
      if (!visibleFrom(pin.side, view) || model.pinHidden(i)) return;
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
      if (!visibleFrom(part.side, view) || model.partHidden(i)) return;
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
  if (padValues) drawPadValues(ctx, model, camera, view, visible, padValues, occupied, palette, selection);
  drawSelectionRing(ctx, model, camera, selection, palette);
}

/**
 * Numbers at pads: the reading in its status color with the reference under
 * it, beside the pad so the pad stays visible. Shown from a zoom where they
 * can be read; labels that would overlap give way, the selected pin's never.
 */
function drawPadValues(
  ctx: CanvasRenderingContext2D,
  model: BoardModel,
  camera: Camera,
  view: ViewSide,
  visible: ReturnType<Camera["visibleBounds"]>,
  values: PadValues,
  occupied: Occupancy,
  palette: Palette,
  selection: Selection,
): void {
  const s = camera.scale;
  const items: { x: number; y: number; r: number; v: PadValue; first: boolean }[] = [];
  const take = (x: number, y: number, radius: number, v: PadValue | undefined, first: boolean) => {
    if (!v) return;
    const r = radius * s;
    // Readable from about a 0402 pad at medium zoom; the selected pin always.
    if (r < 4 && !first) return;
    const p = camera.toScreen({ x, y });
    if (p.x < -40 || p.y < -40 || p.x > camera.width + 40 || p.y > camera.height + 40) return;
    items.push({ x: p.x, y: p.y, r: Math.max(r, 3), v, first });
  };
  if (selection.kind === "pin") {
    const pin = model.pins[selection.pin];
    if (visibleFrom(pin.side, view)) take(pin.x, pin.y, pin.radius, values.pin(selection.pin), true);
  }
  model.pinIndex.query(visible, (i) => {
    if (items.length >= MAX_PAD_VALUES || (selection.kind === "pin" && selection.pin === i)) return;
    const pin = model.pins[i];
    if (visibleFrom(pin.side, view) && !model.pinHidden(i)) take(pin.x, pin.y, pin.radius, values.pin(i), false);
  });
  model.testPointIndex.query(visible, (i) => {
    if (items.length >= MAX_PAD_VALUES) return;
    const tp = model.testPoints[i];
    if (visibleFrom(tp.side, view) && !model.netHidden(tp.net)) take(tp.x, tp.y, tp.radius, values.testPoint(i), false);
  });
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const { x, y, r, v, first } of items) {
    const size = Math.min(Math.max(r * 0.55, 9), 13);
    const subSize = Math.max(8, size * 0.8);
    ctx.font = `600 ${size}px ${MONO}`;
    const w1 = ctx.measureText(v.text).width;
    ctx.font = `500 ${subSize}px ${MONO}`;
    const w2 = v.sub ? ctx.measureText(v.sub).width : 0;
    const w = Math.max(w1, w2) + 8;
    const h = size + 6 + (v.sub ? subSize + 2 : 0);
    // Right of the pad, else left, below, above.
    const spots = [
      { x0: x + r + 3, y0: y - h / 2 },
      { x0: x - r - 3 - w, y0: y - h / 2 },
      { x0: x - w / 2, y0: y + r + 3 },
      { x0: x - w / 2, y0: y - r - 3 - h },
    ];
    let at: { x0: number; y0: number } | undefined;
    for (const spot of spots) {
      if (occupied.tryPlace({ x0: spot.x0, y0: spot.y0, x1: spot.x0 + w, y1: spot.y0 + h })) {
        at = spot;
        break;
      }
    }
    if (!at) {
      if (!first) continue;
      at = spots[0];
    }
    const color = v.status ? STATUS_COLOR[v.status] : palette.label;
    ctx.fillStyle = "rgba(16, 18, 22, 0.86)";
    ctx.strokeStyle = color;
    ctx.lineWidth = first ? 2 : 1.2;
    ctx.beginPath();
    ctx.roundRect(at.x0, at.y0, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.font = `600 ${size}px ${MONO}`;
    ctx.fillStyle = v.status === "reference" ? "#c9d1d9" : color === palette.label ? "#ffffff" : color;
    ctx.fillText(v.text, at.x0 + 4, at.y0 + 3 + size / 2);
    if (v.sub) {
      ctx.font = `500 ${subSize}px ${MONO}`;
      ctx.fillStyle = "#aab4be";
      ctx.fillText(v.sub, at.x0 + 4, at.y0 + 3 + size + 2 + subSize / 2);
    }
  }
  ctx.restore();
}

const STATUS_COLOR: Record<NetStatus, string> = {
  ok: "#43a047",
  mismatch: "#ab47bc",
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
    if (status && visibleFrom(pin.side, view) && !model.pinHidden(i)) dot(pin.x, pin.y, pin.radius, status);
  });
  seen.clear();
  model.testPointIndex.query(visible, (i) => {
    if (seen.has(i)) return;
    seen.add(i);
    const tp = model.testPoints[i];
    const status = measured.get(tp.net);
    if (status && visibleFrom(tp.side, view) && !model.netHidden(tp.net)) dot(tp.x, tp.y, tp.radius, status);
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

/** A drawing as shown on the board (see `Drawing` in notes.ts). */
export interface DrawingMark {
  id: string;
  kind: "line" | "area" | "jumper";
  side: ViewSide;
  points: { x: number; y: number }[];
  text?: string;
}

const DRAW_COLORS = { line: "#ff9800", area: "#ef5350", jumper: "#22c55e" } as const;

/** Lines, areas and jumpers of the side in view; `draft` is the one being drawn (its last point follows the cursor). */
export function drawDrawings(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  drawings: readonly DrawingMark[],
  view: ViewSide,
  dpr: number,
  draft?: DrawingMark | null,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const all = draft ? [...drawings, draft] : drawings;
  for (const d of all) {
    if (d.side !== view || d.points.length === 0) continue;
    const pts = d.points.map((p) => camera.toScreen(p));
    const color = DRAW_COLORS[d.kind];
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (d.kind === "area" && pts.length >= 3 && d !== draft) ctx.closePath();
    if (d.kind === "area") {
      ctx.fillStyle = "rgba(239, 83, 80, 0.22)";
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = d.kind === "jumper" ? 6 : 4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = d.kind === "jumper" ? 3.5 : 2;
    if (d.kind === "line") ctx.setLineDash([7, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (d.kind === "jumper")
      for (const p of [pts[0], pts[pts.length - 1]]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    if (d.text) {
      const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
      ctx.font = `600 12px ${FONT}`;
      const w = ctx.measureText(d.text).width + 10;
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(c.x - w / 2, c.y - 22, w, 18);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(d.text, c.x, c.y - 13);
    }
  }
}
