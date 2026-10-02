/** Several parts at once: the nets they share. */
import type { BoardModel } from "./board";

export interface SharedNet {
  net: number;
  /** The selected parts on this net, in selection order. */
  parts: number[];
}

/**
 * Nets that connect at least two of the parts, the ones shared by most parts
 * first. Ground and unconnected pins are left out unless `withGround`.
 */
export function sharedNets(model: BoardModel, parts: readonly number[], withGround = false): SharedNet[] {
  const byNet = new Map<number, number[]>();
  for (const part of parts) {
    const p = model.parts[part];
    const seen = new Set<number>();
    for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
      const net = model.pins[i].net;
      const kind = model.nets[net].kind;
      if (seen.has(net) || kind === "unconnected" || (kind === "ground" && !withGround)) continue;
      seen.add(net);
      const list = byNet.get(net);
      if (list) list.push(part);
      else byNet.set(net, [part]);
    }
  }
  return [...byNet]
    .filter(([, list]) => list.length >= 2)
    .map(([net, list]) => ({ net, parts: list }))
    .sort((a, b) => b.parts.length - a.parts.length || model.nets[a.net].name.localeCompare(model.nets[b.net].name));
}
