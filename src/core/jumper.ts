/** Where to solder a jumper wire when a pad or trace is gone: the nearest other points of the same net. */
import type { BoardModel } from "./board";

/**
 * How freely a net's points stand in for each other. A high-speed pair or a clock is one
 * net on paper, but a wire to any of its points adds a stub and breaks the impedance: such
 * targets are only fit when they sit on the same stretch of trace (F43).
 */
export type SignalClass = "highSpeed" | "clock" | "plain";

const HIGH_SPEED = [
  /USB.*(D[PNM+-]|_[PN]$)/i,
  /(^|_)D[PM+-]$/i,
  /USB3|USB_SS|SS(TX|RX)/i,
  /PCIE|PCI_E|PEG_/i,
  /HDMI|TMDS/i,
  /(^|_)E?DP\d*_?(TX|AUX|ML|LANE)/i,
  /LVDS|MIPI|(^|_)(CSI|DSI)\d*_/i,
  /SATA/i,
  /(^|_)M?DDR|(^|_)DQS?\d*(_?[PNTC])?$|(^|_)DM\d+$/i,
  /THUNDERBOLT|TBT_|(^|_)TB\d?_/i,
  /(^|_)(ETH|MDI)\d*_/i,
  /(TX|RX)\d*_?[PN]$/i,
  /(^|_)D\d+_?[PN]$/i,
];
const CLOCK = [/CLK(?!REQ)|XTAL|(^|_)X(IN|OUT)$|OSC|32K/i];
/** Slow side signals of a fast bus, and active-low controls ("_N", "_L", "#"): plain wires. */
const SIDEBAND = /(^|_)(RST|RESET|PERST|WAKE|CLKREQ|EN|PG|PWRGD|PWROK|INT|IRQ|ALERT|PRSNT|DET|SEL|OE|CS)\d*(_?[LN]|#)?$/i;

export function signalClass(netName: string): SignalClass {
  if (SIDEBAND.test(netName)) return "plain";
  if (HIGH_SPEED.some((re) => re.test(netName))) return "highSpeed";
  if (CLOCK.some((re) => re.test(netName))) return "clock";
  return "plain";
}

export interface JumperTarget {
  kind: "pin" | "testPoint";
  index: number;
  label: string;
  /** Mils from the pin. */
  distance: number;
  sameSide: boolean;
  /** Under the package of a part with many pins (a BGA ball, a QFN pad): no wire reaches it. */
  hidden: boolean;
}

/** Pins under a package: a ball grid or the pins inside the outline of a large part. */
function hiddenPin(model: BoardModel, pin: number): boolean {
  const p = model.pins[pin];
  const part = model.parts[p.part];
  if (part.pinCount < 16) return false;
  const b = part.bounds;
  const inset = Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.12;
  return p.x > b.minX + inset && p.x < b.maxX - inset && p.y > b.minY + inset && p.y < b.maxY - inset;
}

export function jumperTargets(model: BoardModel, pin: number, limit = 6): JumperTarget[] {
  const p = model.pins[pin];
  const net = model.nets[p.net];
  if (net.kind === "ground" || net.kind === "unconnected") return [];
  const out: JumperTarget[] = [];
  for (const i of net.pins) {
    const q = model.pins[i];
    if (i === pin || q.part === p.part) continue;
    out.push({
      kind: "pin",
      index: i,
      label: model.pinLabel(i),
      distance: Math.hypot(q.x - p.x, q.y - p.y),
      sameSide: q.side === p.side || q.side === "both" || p.side === "both",
      hidden: hiddenPin(model, i),
    });
  }
  for (const i of net.testPoints) {
    const tp = model.testPoints[i];
    out.push({
      kind: "testPoint",
      index: i,
      label: tp.name ?? (tp.kind === "via" ? "Via" : "TP"),
      distance: Math.hypot(tp.x - p.x, tp.y - p.y),
      sameSide: tp.side === p.side || tp.side === "both" || p.side === "both",
      hidden: false,
    });
  }
  // Reachable first, then the same side, then the nearest.
  return out
    .sort((a, b) => Number(a.hidden) - Number(b.hidden) || Number(b.sameSide) - Number(a.sameSide) || a.distance - b.distance)
    .slice(0, limit);
}

interface Point {
  x: number;
  y: number;
}
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Does the segment a–b pass through the box? (Liang–Barsky) */
export function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - box.minX) && clip(dx, box.maxX - a.x) && clip(-dy, a.y - box.minY) && clip(dy, box.maxY - a.y) && t1 - t0 > 1e-9;
}

const pathLength = (pts: Point[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

/** Mils of clearance a wire keeps from a part outline. */
const CLEARANCE = 12;
/** Extra wire for bends, stripping and the solder joint at each end. */
const SLACK = 1.1;
const END_MM = 1.5;

export interface JumperPlan {
  from: { label: string; net: string; key: number };
  to: { label: string; kind: "pin" | "testPoint"; index: number };
  side: "top" | "bottom";
  /** The way the wire goes, from end to end, in board mils. */
  route: Point[];
  straight: number;
  routed: number;
  /** Approximate wire to cut, in mm: the route with slack for bends and both joints. */
  wireMm: number;
  /** Parts in the way of a straight wire, and those the route still has to cross. */
  inTheWay: number[];
  crossed: number[];
  signal: SignalClass;
  /** Pins of other nets right next to either end: the short test after soldering. */
  neighbours: { pin: number; net: string }[];
}

/**
 * A wire from a pin to a point of the same net: around the placed parts where a bend or
 * two do it, with the parts it still crosses named, the length to cut, and what to test.
 */
export function jumperPlan(model: BoardModel, pin: number, target: { kind: "pin" | "testPoint"; index: number }, side: "top" | "bottom"): JumperPlan {
  const p = model.pins[pin];
  const at = target.kind === "pin" ? model.pins[target.index] : model.testPoints[target.index];
  const a = { x: p.x, y: p.y };
  const b = { x: at.x, y: at.y };
  const ends = new Set([p.part, ...(target.kind === "pin" ? [model.pins[target.index].part] : [])]);
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const near: Box = {
    minX: Math.min(a.x, b.x) - span * 0.5 - 200,
    maxX: Math.max(a.x, b.x) + span * 0.5 + 200,
    minY: Math.min(a.y, b.y) - span * 0.5 - 200,
    maxY: Math.max(a.y, b.y) + span * 0.5 + 200,
  };
  const obstacles: { part: number; box: Box }[] = [];
  model.parts.forEach((part, i) => {
    if (ends.has(i) || part.pinCount === 0) return;
    if (part.side !== side && part.side !== "both") return;
    const bx = part.bounds;
    if (bx.maxX < near.minX || bx.minX > near.maxX || bx.maxY < near.minY || bx.minY > near.maxY) return;
    obstacles.push({ part: i, box: bx });
  });
  const crossing = (pts: Point[]) => {
    const hit = new Set<number>();
    for (let k = 1; k < pts.length; k++) for (const o of obstacles) if (segmentHitsBox(pts[k - 1], pts[k], o.box)) hit.add(o.part);
    return [...hit];
  };
  const inTheWay = crossing([a, b]);
  let best = { route: [a, b], crossed: inTheWay, length: span };
  if (inTheWay.length > 0) {
    // Bends at the corners of what is in the way, one or two of them.
    const corners = obstacles
      .filter((o) => inTheWay.includes(o.part))
      .flatMap(({ box }) => [
        { x: box.minX - CLEARANCE, y: box.minY - CLEARANCE },
        { x: box.maxX + CLEARANCE, y: box.minY - CLEARANCE },
        { x: box.minX - CLEARANCE, y: box.maxY + CLEARANCE },
        { x: box.maxX + CLEARANCE, y: box.maxY + CLEARANCE },
      ])
      .slice(0, 48);
    const consider = (route: Point[]) => {
      const length = pathLength(route);
      // A bend is worth it while the wire stays reasonable: at most three times the straight way.
      if (length > span * 3 + 100) return;
      const crossed = crossing(route);
      if (crossed.length < best.crossed.length || (crossed.length === best.crossed.length && length < best.length - 1)) best = { route, crossed, length };
    };
    for (const c of corners) consider([a, c, b]);
    if (best.crossed.length > 0) for (const c of corners) for (const d of corners) if (c !== d) consider([a, c, d, b]);
  }
  const net = model.nets[p.net];
  const neighbours: { pin: number; net: string }[] = [];
  const seen = new Set<string>();
  for (const end of [a, b]) {
    model.pinIndex.query({ minX: end.x - 40, minY: end.y - 40, maxX: end.x + 40, maxY: end.y + 40 }, (i) => {
      const q = model.pins[i];
      const other = model.nets[q.net];
      if (q.net === p.net || other.kind === "unconnected" || seen.has(other.name)) return;
      if (Math.hypot(q.x - end.x, q.y - end.y) > 40) return;
      seen.add(other.name);
      neighbours.push({ pin: i, net: other.name });
    });
  }
  return {
    from: { label: model.pinLabel(pin), net: net.name, key: pin },
    to: { label: target.kind === "pin" ? model.pinLabel(target.index) : (model.testPoints[target.index].name ?? (model.testPoints[target.index].kind === "via" ? "Via" : "TP")), ...target },
    side,
    route: best.route,
    straight: span,
    routed: best.length,
    wireMm: Math.round(((best.length * 0.0254 * SLACK + 2 * END_MM) * 10)) / 10,
    inTheWay,
    crossed: best.crossed,
    signal: signalClass(net.name),
    neighbours: neighbours.slice(0, 6),
  };
}
