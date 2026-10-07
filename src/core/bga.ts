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

/** Ball pitch as the board file places the balls, and whether it is the same all over. */
export interface BallPitch {
  /** Mils between neighbouring columns and rows (median). */
  col: number;
  row: number;
  /** All neighbour distances within 10 % of the median: the file's dimensions can be trusted. */
  consistent: boolean;
  samples: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export function ballPitch(model: BoardModel, grid: BallGrid): BallPitch | null {
  const cols: number[] = [];
  const rows: number[] = [];
  grid.rows.forEach((row, r) => {
    for (let c = 1; c <= grid.cols; c++) {
      const here = grid.balls.get(`${row}|${c}`);
      if (here === undefined) continue;
      const a = model.pins[here];
      const right = grid.balls.get(`${row}|${c + 1}`);
      if (right !== undefined) cols.push(Math.hypot(model.pins[right].x - a.x, model.pins[right].y - a.y));
      const next = r + 1 < grid.rows.length ? grid.balls.get(`${grid.rows[r + 1]}|${c}`) : undefined;
      if (next !== undefined) rows.push(Math.hypot(model.pins[next].x - a.x, model.pins[next].y - a.y));
    }
  });
  if (cols.length === 0 && rows.length === 0) return null;
  const col = median(cols.length ? cols : rows);
  const row = median(rows.length ? rows : cols);
  const all = [...cols.map((d) => d / col), ...rows.map((d) => d / row)];
  return { col, row, consistent: col > 0 && row > 0 && all.every((f) => f > 0.9 && f < 1.1), samples: all.length };
}

/** Grid places with no ball: left out by the design, not damaged. */
export function missingBalls(grid: BallGrid): string[] {
  const out: string[] = [];
  for (const row of grid.rows) for (let c = 1; c <= grid.cols; c++) if (!grid.balls.has(`${row}|${c}`)) out.push(`${row}${c}`);
  return out;
}

/** Ball A1, or the ball nearest to that corner when the design leaves A1 out. */
export function cornerBall(grid: BallGrid): number | undefined {
  for (const row of grid.rows)
    for (let c = 1; c <= grid.cols; c++) {
      const pin = grid.balls.get(`${row}|${c}`);
      if (pin !== undefined) return pin;
    }
  return undefined;
}

/**
 * How the balls are looked at: as datasheets draw them from the top (through the package,
 * like the pads on the board from above) or from below (the balls of the chip); or where
 * they lie on this board, seen from the side the part is on.
 */
export type BallView = "top" | "bottom" | "board";

export interface BallPlace {
  /** -1 where the design has no ball (datasheet views only). */
  pin: number;
  row: string;
  col: number;
  /** Place in the drawing: x to the right, y down; in mils for "board", in grid steps otherwise. */
  x: number;
  y: number;
}

/** Ball places for a view, turned by quarter turns (clockwise); the design's gaps too, except on the board. */
export function ballPlaces(model: BoardModel, grid: BallGrid, view: BallView, quarterTurns = 0): BallPlace[] {
  const part = model.parts[model.pins[grid.balls.values().next().value as number].part];
  const centre = partCenter(part);
  const out: BallPlace[] = [];
  grid.rows.forEach((row, r) => {
    for (let c = 1; c <= grid.cols; c++) {
      const pin = grid.balls.get(`${row}|${c}`) ?? -1;
      if (pin < 0 && view === "board") continue;
      let x: number;
      let y: number;
      if (view === "board") {
        const p = model.pins[pin];
        // Board y runs up; a part on the bottom is seen from below, so mirrored.
        x = (p.x - centre.x) * (part.side === "bottom" ? -1 : 1);
        y = -(p.y - centre.y);
      } else {
        x = view === "top" ? c - 1 : grid.cols - c;
        y = r;
      }
      out.push({ pin, row, col: c, x, y });
    }
  });
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (const b of out)
    for (let k = 0; k < turns; k++) {
      const { x, y } = b;
      b.x = -y;
      b.y = x;
    }
  return out;
}
