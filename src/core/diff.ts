/**
 * What differs between two boards (revisions of one design, or a board and
 * a donor): parts added, removed or changed, pins that land on another net,
 * nets whose connections differ, nets that were only renamed, and nets
 * only one board has. Parts and pins are matched by designator and pin
 * number. Nets are matched by what they connect: a net renamed with the
 * same pins is no electrical change, a net of the same name with other pins
 * is one. Positions are compared after lining the boards up on the parts
 * both have, so a shifted origin does not make every part "moved".
 */
import { partCenter, type BoardModel } from "./board";

export interface PartChange {
  name: string;
  /** Part index on board A (or B for parts only B has). */
  a?: number;
  b?: number;
  changes: ("device" | "pins" | "side" | "moved" | "nets")[];
  deviceA?: string;
  deviceB?: string;
}

export interface PinChange {
  part: string;
  pin: string;
  /** Pin index on board A. */
  a: number;
  netA: string;
  netB: string;
}

/** A net on both boards whose pins differ (by name, or renamed as well: `renamedTo`). */
export interface NetChange {
  name: string;
  /** B's name when the net was renamed too (matched on most of its pins). */
  renamedTo?: string;
  /** Pins ("U7.3") only B's net has, and only A's. */
  added: string[];
  removed: string[];
}

export interface BoardDiff {
  onlyA: PartChange[];
  onlyB: PartChange[];
  changed: PartChange[];
  pins: PinChange[];
  netsOnlyA: string[];
  netsOnlyB: string[];
  /** Same pins, other name: no electrical change. */
  renamed: { a: string; b: string }[];
  /** Same name, other pins: an electrical change. */
  netChanges: NetChange[];
  /** Parts in both with no difference. */
  same: number;
  /** How B lies against A (fitted on parts both have), when there were enough of them. */
  aligned?: Alignment;
}

/** Each net's pins as "PART.PIN", sorted: what the net connects. Taken from the pins themselves. */
function connectionsOf(m: BoardModel): string[][] {
  const out: string[][] = m.nets.map(() => []);
  m.pins.forEach((pin) => out[pin.net]?.push(`${m.parts[pin.part].name}.${pin.number}`.toUpperCase()));
  for (const c of out) c.sort();
  return out;
}

/**
 * Nets of A matched to nets of B: by name when the name is on both, else by
 * the same set of connections (a renamed net). Returns A net → B net.
 */
export function matchNets(a: BoardModel, b: BoardModel): { map: Map<number, number>; renamed: { a: string; b: string }[]; changed: NetChange[] } {
  const map = new Map<number, number>();
  const renamed: { a: string; b: string }[] = [];
  const changed: NetChange[] = [];
  const ofA = connectionsOf(a);
  const ofB = connectionsOf(b);
  const connections = (m: BoardModel, net: number) => (m === a ? ofA : ofB)[net];
  const live = (m: BoardModel) => m.nets.flatMap((n, i) => (n.kind === "unconnected" ? [] : [i]));
  const bByName = new Map(live(b).map((i) => [b.fileNetName(i).toUpperCase(), i]));
  const usedB = new Set<number>();
  const waitingA: number[] = [];
  for (const i of live(a)) {
    const j = bByName.get(a.fileNetName(i).toUpperCase());
    if (j === undefined) {
      waitingA.push(i);
      continue;
    }
    map.set(i, j);
    usedB.add(j);
    const ca = connections(a, i);
    const cb = connections(b, j);
    if (ca.join() !== cb.join()) {
      const inA = new Set(ca);
      const inB = new Set(cb);
      changed.push({ name: a.fileNetName(i), added: cb.filter((x) => !inA.has(x)), removed: ca.filter((x) => !inB.has(x)) });
    }
  }
  // Left over: the same connections under another name.
  const bBySet = new Map<string, number>();
  for (const j of live(b)) if (!usedB.has(j) && connections(b, j).length) bBySet.set(connections(b, j).join(), j);
  for (const i of waitingA) {
    if (!connections(a, i).length) continue;
    const j = bBySet.get(connections(a, i).join());
    if (j === undefined) continue;
    map.set(i, j);
    usedB.add(j);
    bBySet.delete(connections(b, j).join());
    renamed.push({ a: a.fileNetName(i), b: b.fileNetName(j) });
  }
  // Renamed and changed: the B net sharing most pins, when they share most of what either has.
  const netOfB = new Map<string, number>();
  for (const j of live(b)) if (!usedB.has(j)) for (const c of connections(b, j)) netOfB.set(c, j);
  for (const i of waitingA) {
    if (map.has(i)) continue;
    const ca = connections(a, i);
    if (ca.length < 2) continue;
    const shared = new Map<number, number>();
    for (const c of ca) {
      const j = netOfB.get(c);
      if (j !== undefined && !usedB.has(j)) shared.set(j, (shared.get(j) ?? 0) + 1);
    }
    let best: [number, number] | undefined;
    for (const [j, n] of shared) if (!best || n > best[1]) best = [j, n];
    if (!best) continue;
    const cb = connections(b, best[0]);
    // At least two thirds of the pins on both sides in common.
    if (best[1] * 3 < Math.max(ca.length, cb.length) * 2) continue;
    map.set(i, best[0]);
    usedB.add(best[0]);
    const inA = new Set(ca);
    const inB = new Set(cb);
    changed.push({ name: a.fileNetName(i), renamedTo: b.fileNetName(best[0]), added: cb.filter((x) => !inA.has(x)), removed: ca.filter((x) => !inB.has(x)) });
  }
  return { map, renamed, changed };
}

/**
 * The rotation, scale and shift that best lay B's part centres on A's,
 * fitted on parts both have (least squares); undefined with fewer than 3.
 */
export function alignOnParts(a: BoardModel, b: BoardModel): Alignment | undefined {
  const pairs: Pair[] = [];
  a.parts.forEach((p) => {
    const j = b.findPart(p.name);
    if (j === undefined || b.parts[j].pinCount !== p.pinCount || p.marker || b.parts[j].side !== p.side) return;
    pairs.push([partCenter(b.parts[j]), partCenter(p)]);
  });
  if (pairs.length < 3) return undefined;
  // Parts that really moved would pull a plain fit. So: candidates from two parts each, the
  // one most parts agree with wins, and the fit is made on those parts only.
  const fitsWith = (al: Alignment) =>
    pairs.filter(([q, p]) => {
      const r = alignedToA(al, q);
      return Math.hypot(r.x - p.x, r.y - p.y) <= MOVE;
    });
  // Every two parts on a small board, 400 drawn at random (always the same) on a big one.
  const candidates: [number, number][] = [];
  if (pairs.length <= 28) {
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) candidates.push([i, j]);
  } else {
    let seed = 12345;
    const pick = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % pairs.length;
    };
    for (let t = 0; t < 400; t++) candidates.push([pick(), pick()]);
  }
  let best: Pair[] = [];
  for (const [i, j] of candidates) {
    const al = i !== j ? fromTwo(pairs[i], pairs[j]) : undefined;
    if (!al) continue;
    const agree = fitsWith(al);
    if (agree.length > best.length) best = agree;
    if (best.length === pairs.length) break;
  }
  return fit(best.length >= 3 ? best : pairs);
}

/** The turn, scale and shift that lay two parts of B exactly on A; undefined when they lie too close. */
function fromTwo([b1, a1]: Pair, [b2, a2]: Pair): Alignment | undefined {
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const len = bx * bx + by * by;
  if (len < 50 * 50) return undefined;
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  // (ax + i ay) / (bx + i by)
  const c = (ax * bx + ay * by) / len;
  const s = (ay * bx - ax * by) / len;
  return { angle: Math.atan2(s, c), scale: Math.hypot(c, s), dx: a1.x - (c * b1.x - s * b1.y), dy: a1.y - (s * b1.x + c * b1.y) };
}

export interface Alignment {
  /** Radians, B turned onto A. */
  angle: number;
  scale: number;
  dx: number;
  dy: number;
}

type Pair = [{ x: number; y: number }, { x: number; y: number }];

/** A point of B where it lies on A. */
export function alignedToA(al: Alignment, p: { x: number; y: number }): { x: number; y: number } {
  const [c, s] = [Math.cos(al.angle) * al.scale, Math.sin(al.angle) * al.scale];
  return { x: c * p.x - s * p.y + al.dx, y: s * p.x + c * p.y + al.dy };
}

/** A point of A where it lies on B. */
export function alignedToB(al: Alignment, p: { x: number; y: number }): { x: number; y: number } {
  const x = p.x - al.dx;
  const y = p.y - al.dy;
  const [c, s] = [Math.cos(-al.angle) / al.scale, Math.sin(-al.angle) / al.scale];
  return { x: c * x - s * y, y: s * x + c * y };
}

/** Whether lining up changes anything worth saying (more than a mil, a tenth of a degree, a thousandth in scale). */
export function alignmentMatters(al: Alignment | undefined): boolean {
  return !!al && (Math.hypot(al.dx, al.dy) > 1 || Math.abs(al.angle) > Math.PI / 1800 || Math.abs(al.scale - 1) > 0.001);
}

function fit(pairs: Pair[]): Alignment | undefined {
  if (pairs.length < 3) return undefined;
  const n = pairs.length;
  const mb = pairs.reduce((s, [q]) => ({ x: s.x + q.x / n, y: s.y + q.y / n }), { x: 0, y: 0 });
  const ma = pairs.reduce((s, [, p]) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
  let sxx = 0;
  let sxy = 0;
  let norm = 0;
  for (const [q, p] of pairs) {
    const bx = q.x - mb.x;
    const by = q.y - mb.y;
    const ax = p.x - ma.x;
    const ay = p.y - ma.y;
    sxx += bx * ax + by * ay;
    sxy += bx * ay - by * ax;
    norm += bx * bx + by * by;
  }
  if (norm === 0) return undefined;
  const angle = Math.atan2(sxy, sxx);
  const scale = Math.hypot(sxx, sxy) / norm;
  const [c, s] = [Math.cos(angle) * scale, Math.sin(angle) * scale];
  return { angle, scale, dx: ma.x - (c * mb.x - s * mb.y), dy: ma.y - (s * mb.x + c * mb.y) };
}

/** Moves smaller than this (mils) are rounding between exports, not a change. */
const MOVE = 20;

export function diffBoards(a: BoardModel, b: BoardModel): BoardDiff {
  const nets = matchNets(a, b);
  const aligned = alignOnParts(a, b);
  const diff: BoardDiff = { onlyA: [], onlyB: [], changed: [], pins: [], netsOnlyA: [], netsOnlyB: [], renamed: nets.renamed, netChanges: nets.changed, same: 0, ...(aligned && { aligned }) };
  const netName = (m: BoardModel, net: number) => m.fileNetName(net);
  // B's positions laid onto A's.
  const onA = (p: { x: number; y: number }) => (aligned ? alignedToA(aligned, p) : p);

  a.parts.forEach((p, i) => {
    const j = b.findPart(p.name);
    if (j === undefined) {
      diff.onlyA.push({ name: p.name, a: i, changes: [], deviceA: p.device });
      return;
    }
    const q = b.parts[j];
    const changes: PartChange["changes"] = [];
    if ((p.device ?? "").trim().toUpperCase() !== (q.device ?? "").trim().toUpperCase()) changes.push("device");
    // The same pin numbers, not just as many: "1,2" against "3,2" is a change.
    const numbers = (m: BoardModel, part: number) => {
      const x = m.parts[part];
      return m.pins
        .slice(x.firstPin, x.firstPin + x.pinCount)
        .map((pin) => pin.number.toUpperCase())
        .sort()
        .join("|");
    };
    if (p.pinCount !== q.pinCount || numbers(a, i) !== numbers(b, j)) changes.push("pins");
    if (p.side !== q.side) changes.push("side");
    const ca = partCenter(p);
    const cb = onA(partCenter(q));
    if (Math.hypot(ca.x - cb.x, ca.y - cb.y) > MOVE) changes.push("moved");
    // Pins present on both: the net each lands on.
    const pinsBefore = diff.pins.length;
    for (let k = p.firstPin; k < p.firstPin + p.pinCount; k++) {
      const pin = a.pins[k];
      const other = b.findPin(j, pin.number);
      if (other === undefined) continue;
      const na = netName(a, pin.net);
      const nb = netName(b, b.pins[other].net);
      const unconnected = a.nets[pin.net].kind === "unconnected" && b.nets[b.pins[other].net].kind === "unconnected";
      // On the net that matches (a renamed net is the same net), nothing changed.
      const matched = nets.map.get(pin.net);
      const same = matched !== undefined ? matched === b.pins[other].net : na.toUpperCase() === nb.toUpperCase();
      if (!same && !unconnected) diff.pins.push({ part: p.name, pin: pin.number, a: k, netA: na, netB: nb });
    }
    // A part wired differently is changed, even when nothing else is.
    if (diff.pins.length > pinsBefore) changes.push("nets");
    if (changes.length) diff.changed.push({ name: p.name, a: i, b: j, changes, deviceA: p.device, deviceB: q.device });
    else diff.same++;
  });
  b.parts.forEach((q, j) => {
    if (a.findPart(q.name) === undefined) diff.onlyB.push({ name: q.name, b: j, changes: [], deviceB: q.device });
  });

  // Nets with no counterpart at all (neither by name nor by connections).
  const matchedB = new Set(nets.map.values());
  a.nets.forEach((n, i) => {
    if (n.kind !== "unconnected" && !nets.map.has(i)) diff.netsOnlyA.push(netName(a, i));
  });
  b.nets.forEach((n, j) => {
    if (n.kind !== "unconnected" && !matchedB.has(j)) diff.netsOnlyB.push(netName(b, j));
  });
  const byName = (x: PartChange, y: PartChange) => x.name.localeCompare(y.name, undefined, { numeric: true });
  diff.onlyA.sort(byName);
  diff.onlyB.sort(byName);
  diff.changed.sort(byName);
  diff.netsOnlyA.sort();
  diff.netsOnlyB.sort();
  return diff;
}
