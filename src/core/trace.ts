/**
 * Following a signal or supply across the board, beyond the copper of one
 * net: through parts that pass it on. Each step names the part and how it
 * passes the signal, so the way can be shown in colours by kind:
 *
 * - `through`: coils, ferrites, fuses, jumpers, 0 Ω resistors – the same
 *   supply or signal on both sides (PPBUS → PPBUS_F through a fuse).
 * - `switch`: a MOSFET between two supply rails, its gate on a signal
 *   (PPBUS → PP3V3_SW switched).
 * - `diode`: a two-pin diode (or a dual in one package) between nets.
 * - `resistor`: a series resistor between two signals (termination, 33 Ω
 *   on a clock); pull-ups to a rail are left out.
 * - `coupling`: a capacitor between two signals (AC coupling on USB, PCIe,
 *   DisplayPort lanes); decoupling to ground is left out.
 *
 * Ground and unconnected nets end every path. `through` links are followed
 * as far as they go; the others one step from any reached net, and only up
 * to `MAX_HOPS` of them in a row, so a trace stays readable.
 */
import type { BoardModel } from "./board";
import { isZeroOhm, partRole, passesThrough } from "./partRole";
import { railVolts } from "../workbench/diagnosis";

export type TraceKind = "through" | "switch" | "diode" | "resistor" | "coupling";

export const TRACE_KINDS: TraceKind[] = ["through", "switch", "diode", "resistor", "coupling"];

export interface TraceLink {
  net: number;
  /** The part between `from` and `net`. */
  via: number;
  from: number;
  kind: TraceKind;
  /** Steps from the start net. */
  depth: number;
}

const MAX_HOPS = 2;
const MAX_LINKS = 80;

/** A supply rail: marked power by the file, or named with a voltage. */
function isRail(model: BoardModel, net: number): boolean {
  const n = model.nets[net];
  return n.kind === "power" || railVolts(n.name) !== undefined;
}

const usable = (model: BoardModel, net: number) => {
  const k = model.nets[net].kind;
  return k !== "ground" && k !== "unconnected";
};

/** The nets on a part's pins, in pin order, each once. */
function partNets(model: BoardModel, part: number): number[] {
  const p = model.parts[part];
  const out: number[] = [];
  for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
    const net = model.pins[i].net;
    if (!out.includes(net)) out.push(net);
  }
  return out;
}

/** How a part passes the signal from `net` on, and to which nets. */
export function partLinks(model: BoardModel, part: number, net: number): { kind: TraceKind; nets: number[] } | null {
  const p = model.parts[part];
  const nets = partNets(model, part);
  const others = nets.filter((n) => n !== net && usable(model, n));
  if (others.length === 0) return null;
  if (passesThrough(p.name, p.device, p.pinCount, nets.length)) return { kind: "through", nets: others };
  const role = partRole(p.name, p.device, p.pinCount);
  switch (role) {
    case "diode":
      // Two pins, or a dual diode (3 pins); bigger arrays are no path.
      return p.pinCount <= 3 ? { kind: "diode", nets: others } : null;
    case "transistor": {
      // Source and drain on two rails, the gate on a signal: a load switch.
      if (!isRail(model, net)) return null;
      const rails = others.filter((n) => isRail(model, n));
      const signals = others.filter((n) => !isRail(model, n));
      return rails.length === 1 && signals.length <= 1 ? { kind: "switch", nets: rails } : null;
    }
    case "resistor":
      if (p.pinCount !== 2 || isZeroOhm(p.device)) return null;
      // Signal to signal only: a pull-up or divider to a rail is no path.
      return !isRail(model, net) && !isRail(model, others[0]) ? { kind: "resistor", nets: others } : null;
    case "capacitor":
      return p.pinCount === 2 && !isRail(model, net) && !isRail(model, others[0]) ? { kind: "coupling", nets: others } : null;
    default:
      return null;
  }
}

/** Every net reached from `start`, breadth first, with the part and kind of each step. */
export function traceNet(model: BoardModel, start: number, kinds: ReadonlySet<TraceKind> = new Set(TRACE_KINDS)): TraceLink[] {
  const out: TraceLink[] = [];
  const seen = new Set([start]);
  // Net, depth, and how many non-`through` steps led here.
  const queue: [number, number, number][] = [[start, 0, 0]];
  while (queue.length > 0 && out.length < MAX_LINKS) {
    const [net, depth, hops] = queue.shift()!;
    const visited = new Set<number>();
    for (const pin of model.nets[net].pins) {
      const part = model.pins[pin].part;
      if (visited.has(part)) continue;
      visited.add(part);
      const link = partLinks(model, part, net);
      if (!link || !kinds.has(link.kind)) continue;
      const nextHops = link.kind === "through" ? hops : hops + 1;
      if (nextHops > MAX_HOPS) continue;
      for (const other of link.nets) {
        if (seen.has(other)) continue;
        seen.add(other);
        out.push({ net: other, via: part, from: net, kind: link.kind, depth: depth + 1 });
        queue.push([other, depth + 1, nextHops]);
      }
    }
  }
  return out;
}
