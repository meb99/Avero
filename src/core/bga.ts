/**
 * Ball grids: rows by letter (A, B … AA, AB), columns by number, as on
 * BGA datasheets; and where a ball's net can be reached with a probe.
 */
import { partCenter, type BoardModel } from "./board";
import { partKind } from "../schematic/partInfo";

export interface BallGrid {
  rows: string[];
  cols: number;
  /** Pin index by "row|column". */
  balls: Map<string, number>;
}

const BALL = /^([A-Z]{1,3})(\d{1,3})$/i;

/** Row letters in order: A … Z before AA … */
function rowOrder(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/** The ball grid of a part, or null when its pins are not numbered like balls. */
export function ballGrid(model: BoardModel, part: number): BallGrid | null {
  const p = model.parts[part];
  if (p.pinCount < 16) return null;
  const balls = new Map<string, number>();
  const rows = new Set<string>();
  let cols = 0;
  let matched = 0;
  for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
    const m = BALL.exec(model.pins[i].number.trim());
    if (!m) continue;
    matched++;
    const row = m[1].toUpperCase();
    const col = Number(m[2]);
    rows.add(row);
    cols = Math.max(cols, col);
    balls.set(`${row}|${col}`, i);
  }
  if (matched < p.pinCount * 0.8) return null;
  return { rows: [...rows].sort(rowOrder), cols, balls };
}

export interface ProbePoint {
  kind: "testPoint" | "part";
  index: number;
  name: string;
  /** Distance from the chip's centre in mils. */
  distance: number;
}

/**
 * Where a net can be reached outside the chip: test points, then small
 * passives (capacitors, resistors, coils) on the net, nearest first.
 */
export function probePoints(model: BoardModel, net: number, part: number, limit = 12): ProbePoint[] {
  const c = partCenter(model.parts[part]);
  const out: ProbePoint[] = [];
  const n = model.nets[net];
  for (const i of n.testPoints) {
    const tp = model.testPoints[i];
    if (tp.kind === "via") continue;
    out.push({ kind: "testPoint", index: i, name: tp.name ?? (tp.probe !== undefined ? `TP ${tp.probe}` : "TP"), distance: Math.hypot(tp.x - c.x, tp.y - c.y) });
  }
  const seen = new Set<number>();
  for (const i of n.pins) {
    const owner = model.pins[i].part;
    if (owner === part || seen.has(owner)) continue;
    seen.add(owner);
    const q = model.parts[owner];
    const kind = partKind(q.name);
    if ((kind !== "C" && kind !== "R" && kind !== "L") || q.pinCount > 4) continue;
    const pc = partCenter(q);
    out.push({ kind: "part", index: owner, name: q.name, distance: Math.hypot(pc.x - c.x, pc.y - c.y) });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.distance - b.distance : a.kind === "testPoint" ? -1 : 1)).slice(0, limit);
}
