import type { BoardModel } from "./board";
import type { Selection } from "./types";

export interface SearchResult {
  selection: Selection;
  label: string;
  detail: string;
  kind: "part" | "net" | "pin";
}

/**
 * Finds parts, nets and pins by name.
 *
 * `U1000.A12`, `U1000:A12` and `U1000 A12` address a single pin. Otherwise
 * exact matches come first, then prefixes, then substrings; within a tier,
 * shorter names first so `C1` ranks above `C1000`.
 */
export function search(model: BoardModel, query: string, limit = 50): SearchResult[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const results: SearchResult[] = [];
  const pinRef = /^([^\s.:]+)[.:\s]+([^\s.:]+)$/.exec(q);
  if (pinRef) {
    const part = model.findPart(pinRef[1]);
    if (part !== undefined) {
      const pin = model.findPin(part, pinRef[2]);
      if (pin !== undefined) {
        results.push({
          selection: { kind: "pin", pin },
          label: model.pinLabel(pin),
          detail: model.nets[model.pins[pin].net].name,
          kind: "pin",
        });
      } else {
        // No such pin (a BGA names its balls A1, B2 …): offer the part.
        results.push({ selection: { kind: "part", part }, label: model.parts[part].name, detail: model.parts[part].device ?? "", kind: "part" });
      }
    }
  }

  // Only the best `limit` hits are kept, in order, while going through the names once: on a
  // board with tens of thousands of nets, sorting every hit on each key press was the slow part.
  interface Hit {
    tier: number;
    label: string;
    kind: "part" | "net";
    index: number;
  }
  const room = limit - results.length;
  const best: Hit[] = [];
  const after = (a: Hit, b: Hit) => a.tier - b.tier || a.label.length - b.label.length || a.label.localeCompare(b.label);
  const offer = (name: string, kind: "part" | "net", index: number) => {
    const n = name.toUpperCase();
    const tier = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : -1;
    if (tier < 0 || room <= 0) return;
    const hit: Hit = { tier, label: name, kind, index };
    // Equal hits stay in the order they were found: a part before a net of the same name.
    if (best.length === room && after(hit, best[room - 1]) >= 0) return;
    let at = best.length;
    while (at > 0 && after(hit, best[at - 1]) < 0) at--;
    best.splice(at, 0, hit);
    if (best.length > room) best.pop();
  };
  model.parts.forEach((p, i) => offer(p.name, "part", i));
  model.nets.forEach((n, i) => n.kind !== "unconnected" && offer(n.name, "net", i));

  for (const h of best) {
    if (h.kind === "part") results.push({ selection: { kind: "part", part: h.index }, label: h.label, detail: model.parts[h.index].device ?? "", kind: "part" });
    else results.push({ selection: { kind: "net", net: h.index }, label: h.label, detail: String(model.nets[h.index].pins.length), kind: "net" });
  }
  return results;
}

/** How a name must match, as in FlexBV's search: anywhere, at its start, or all of it. */
export type SearchMode = "substring" | "prefix" | "strict";

/**
 * The search for component / network: parts and nets (as chosen) whose name holds the query
 * in the given way, in name order, a part before a net of the same name. `U10.A3` finds that
 * pin first. Unconnected nets are left out. `details` looks at a part's value and type, too.
 */
export function findNames(
  model: BoardModel,
  query: string,
  options: { parts: boolean; nets: boolean; mode: SearchMode; limit?: number; details?: boolean },
): SearchResult[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const limit = options.limit ?? 500;
  const matches = (name: string) => {
    const n = name.toUpperCase();
    return options.mode === "strict" ? n === q : options.mode === "prefix" ? n.startsWith(q) : n.includes(q);
  };
  // With details a part is found by its value and type too ("10K", "TPS62130"), word by word
  // where the mode looks at the start or the whole.
  const inDetails = (device: string | undefined) =>
    !!options.details && !!device && (options.mode === "substring" ? matches(device) : device.split(/[\s·_,;/]+/).some(matches));
  const out: SearchResult[] = [];
  const pinRef = /^([^\s.:]+)[.:\s]+([^\s.:]+)$/.exec(q);
  if (pinRef && options.parts) {
    const part = model.findPart(pinRef[1]);
    const pin = part === undefined ? undefined : model.findPin(part, pinRef[2]);
    if (pin !== undefined) out.push({ selection: { kind: "pin", pin }, label: model.pinLabel(pin), detail: model.nets[model.pins[pin].net].name, kind: "pin" });
    // No such pin (a BGA names its balls A1, B2 …): offer the part.
    else if (part !== undefined) out.push({ selection: { kind: "part", part }, label: model.parts[part].name, detail: model.parts[part].device ?? "", kind: "part" });
  }
  const named: SearchResult[] = [];
  if (options.parts)
    for (const i of model.sortedParts) {
      const p = model.parts[i];
      if (matches(p.name) || inDetails(p.device)) named.push({ selection: { kind: "part", part: i }, label: p.name, detail: p.device ?? "", kind: "part" });
    }
  if (options.nets)
    for (const i of model.sortedNets) {
      const n = model.nets[i];
      if (n.kind !== "unconnected" && matches(n.name)) named.push({ selection: { kind: "net", net: i }, label: n.name, detail: String(n.pins.length), kind: "net" });
    }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  named.sort((a, b) => collator.compare(a.label, b.label) || (a.kind === "part" ? -1 : 1));
  return [...out, ...named].slice(0, limit);
}
