/** Where to solder a jumper wire when a pad or trace is gone: the nearest other points of the same net. */
import type { BoardModel } from "./board";

export interface JumperTarget {
  kind: "pin" | "testPoint";
  index: number;
  label: string;
  /** Mils from the pin. */
  distance: number;
  sameSide: boolean;
}

export function jumperTargets(model: BoardModel, pin: number, limit = 6): JumperTarget[] {
  const p = model.pins[pin];
  const net = model.nets[p.net];
  if (net.kind === "ground" || net.kind === "unconnected") return [];
  const out: JumperTarget[] = [];
  for (const i of net.pins) {
    const q = model.pins[i];
    if (i === pin || q.part === p.part) continue;
    out.push({ kind: "pin", index: i, label: model.pinLabel(i), distance: Math.hypot(q.x - p.x, q.y - p.y), sameSide: q.side === p.side || q.side === "both" || p.side === "both" });
  }
  for (const i of net.testPoints) {
    const tp = model.testPoints[i];
    out.push({
      kind: "testPoint",
      index: i,
      label: tp.name ?? (tp.kind === "via" ? "Via" : "TP"),
      distance: Math.hypot(tp.x - p.x, tp.y - p.y),
      sameSide: tp.side === p.side || tp.side === "both" || p.side === "both",
    });
  }
  return out.sort((a, b) => Number(b.sameSide) - Number(a.sameSide) || a.distance - b.distance).slice(0, limit);
}
