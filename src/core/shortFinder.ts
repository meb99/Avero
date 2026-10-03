/**
 * Where a short on a net is likely: the parts on it that can short it to
 * ground. Ceramic capacitors fail shorted most often, the big ones first
 * (more layers, more stress); then chips, MOSFETs and diodes on the rail.
 * Resistors and coils rarely short to ground and are left out.
 */
import type { BoardModel } from "./board";
import { partRole } from "./partRole";

export interface ShortCandidate {
  part: number;
  kind: "capacitor" | "chip" | "transistor" | "diode";
  /** Package size rank (0201 = 2, 0402 = 3 … 1206 = 6), 0 when unknown. */
  size: number;
}

/** Imperial case codes (and the metric names of the common ones), small to big. */
const SIZES: [RegExp, number][] = [
  [/(^|[^0-9])01005([^0-9]|$)/, 1],
  [/(^|[^0-9])(0201|0603M)([^0-9]|$)/, 2],
  [/(^|[^0-9])(0402|1005M?)([^0-9]|$)/, 3],
  [/(^|[^0-9])(0603|1608M?)([^0-9]|$)/, 4],
  [/(^|[^0-9])(0805|2012M?)([^0-9]|$)/, 5],
  [/(^|[^0-9])(1206|3216M?)([^0-9]|$)/, 6],
  [/(^|[^0-9])(1210|3225M?)([^0-9]|$)/, 7],
  [/(^|[^0-9])(1812|2220|4532|5750)([^0-9]|$)/, 8],
];

export function packageSize(device: string | undefined): number {
  if (!device) return 0;
  for (const [re, rank] of SIZES) if (re.test(device)) return rank;
  return 0;
}

export function shortCandidates(model: BoardModel, net: number): ShortCandidate[] {
  const out: ShortCandidate[] = [];
  const seen = new Set<number>();
  for (const pin of model.nets[net].pins) {
    const part = model.pins[pin].part;
    if (seen.has(part)) continue;
    seen.add(part);
    const p = model.parts[part];
    const role = partRole(p.name, p.device, p.pinCount);
    // A part only shorts this net to ground if it also touches ground.
    let touchesGround = false;
    for (let i = p.firstPin; i < p.firstPin + p.pinCount && !touchesGround; i++) touchesGround = model.nets[model.pins[i].net].kind === "ground";
    if (!touchesGround) continue;
    const kind = role === "capacitor" ? "capacitor" : role === "ic" ? "chip" : role === "transistor" ? "transistor" : role === "diode" ? "diode" : null;
    if (kind) out.push({ part, kind, size: packageSize(p.device) });
  }
  const order = { capacitor: 0, chip: 1, transistor: 2, diode: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || b.size - a.size || model.parts[a.part].name.localeCompare(model.parts[b.part].name, undefined, { numeric: true }));
}
