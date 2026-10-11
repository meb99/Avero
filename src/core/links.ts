/**
 * The nets joined to a net by link parts – coils, ferrites, fuses, jumpers, 0 Ω resistors –
 * in levels, as FlexBV expands a selection: level 1 is the net alone, level 2 adds the nets
 * one link part away, level 3 those two away. Ground and unconnected nets end the way.
 */
import type { BoardModel } from "./board";
import { partLinks } from "./trace";

export type LinkDepth = 1 | 2 | 3;

export interface LinkedNets {
  /** Each net reached, with how many link parts away it is. */
  nets: Map<number, number>;
  /** The link parts passed on the way. */
  parts: Set<number>;
}

export function linkedNets(model: BoardModel, net: number, depth: LinkDepth): LinkedNets {
  const nets = new Map<number, number>();
  const parts = new Set<number>();
  const seen = new Set([net]);
  let frontier = [net];
  for (let hop = 1; hop < depth && frontier.length > 0; hop++) {
    const next: number[] = [];
    for (const from of frontier) {
      const kind = model.nets[from].kind;
      if (kind === "ground" || kind === "unconnected") continue;
      for (const pin of model.nets[from].pins) {
        const part = model.pins[pin].part;
        const link = partLinks(model, part, from);
        if (link?.kind !== "through") continue;
        parts.add(part);
        for (const other of link.nets) {
          if (seen.has(other)) continue;
          seen.add(other);
          nets.set(other, hop);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return { nets, parts };
}
