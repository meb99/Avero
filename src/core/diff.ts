/**
 * What differs between two boards (revisions of one design, or a board and
 * a donor): parts added, removed or changed, pins that land on another net,
 * and nets only one board has. Parts and pins are matched by designator and
 * pin number, nets by their name in the file.
 */
import { partCenter, type BoardModel } from "./board";

export interface PartChange {
  name: string;
  /** Part index on board A (or B for parts only B has). */
  a?: number;
  b?: number;
  changes: ("device" | "pins" | "side" | "moved")[];
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

export interface BoardDiff {
  onlyA: PartChange[];
  onlyB: PartChange[];
  changed: PartChange[];
  pins: PinChange[];
  netsOnlyA: string[];
  netsOnlyB: string[];
  /** Parts in both with no difference. */
  same: number;
}

/** Moves smaller than this (mils) are rounding between exports, not a change. */
const MOVE = 20;

export function diffBoards(a: BoardModel, b: BoardModel): BoardDiff {
  const diff: BoardDiff = { onlyA: [], onlyB: [], changed: [], pins: [], netsOnlyA: [], netsOnlyB: [], same: 0 };
  const netName = (m: BoardModel, net: number) => m.fileNetName(net);

  a.parts.forEach((p, i) => {
    const j = b.findPart(p.name);
    if (j === undefined) {
      diff.onlyA.push({ name: p.name, a: i, changes: [], deviceA: p.device });
      return;
    }
    const q = b.parts[j];
    const changes: PartChange["changes"] = [];
    if ((p.device ?? "").trim().toUpperCase() !== (q.device ?? "").trim().toUpperCase()) changes.push("device");
    if (p.pinCount !== q.pinCount) changes.push("pins");
    if (p.side !== q.side) changes.push("side");
    const ca = partCenter(p);
    const cb = partCenter(q);
    if (Math.hypot(ca.x - cb.x, ca.y - cb.y) > MOVE) changes.push("moved");
    // Pins present on both: the net each lands on.
    for (let k = p.firstPin; k < p.firstPin + p.pinCount; k++) {
      const pin = a.pins[k];
      const other = b.findPin(j, pin.number);
      if (other === undefined) continue;
      const na = netName(a, pin.net);
      const nb = netName(b, b.pins[other].net);
      const unconnected = a.nets[pin.net].kind === "unconnected" && b.nets[b.pins[other].net].kind === "unconnected";
      if (na.toUpperCase() !== nb.toUpperCase() && !unconnected) diff.pins.push({ part: p.name, pin: pin.number, a: k, netA: na, netB: nb });
    }
    if (changes.length) diff.changed.push({ name: p.name, a: i, b: j, changes, deviceA: p.device, deviceB: q.device });
    else diff.same++;
  });
  b.parts.forEach((q, j) => {
    if (a.findPart(q.name) === undefined) diff.onlyB.push({ name: q.name, b: j, changes: [], deviceB: q.device });
  });

  const names = (m: BoardModel) => new Set(m.nets.flatMap((n, i) => (n.kind === "unconnected" ? [] : [netName(m, i).toUpperCase()])));
  const na = names(a);
  const nb = names(b);
  a.nets.forEach((n, i) => {
    const name = netName(a, i);
    if (n.kind !== "unconnected" && !nb.has(name.toUpperCase())) diff.netsOnlyA.push(name);
  });
  b.nets.forEach((n, i) => {
    const name = netName(b, i);
    if (n.kind !== "unconnected" && !na.has(name.toUpperCase())) diff.netsOnlyB.push(name);
  });
  const byName = (x: PartChange, y: PartChange) => x.name.localeCompare(y.name, undefined, { numeric: true });
  diff.onlyA.sort(byName);
  diff.onlyB.sort(byName);
  diff.changed.sort(byName);
  diff.netsOnlyA.sort();
  diff.netsOnlyB.sort();
  return diff;
}
