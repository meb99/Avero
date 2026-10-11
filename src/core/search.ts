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

  type Scored = SearchResult & { tier: number; len: number };
  const scored: Scored[] = [];
  const tier = (name: string): number => {
    const n = name.toUpperCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return -1;
  };

  model.parts.forEach((p, i) => {
    const t = tier(p.name);
    if (t >= 0) {
      scored.push({
        selection: { kind: "part", part: i },
        label: p.name,
        detail: p.device ?? "",
        kind: "part",
        tier: t,
        len: p.name.length,
      });
    }
  });
  model.nets.forEach((n, i) => {
    if (n.kind === "unconnected") return;
    const t = tier(n.name);
    if (t >= 0) {
      scored.push({
        selection: { kind: "net", net: i },
        label: n.name,
        detail: String(n.pins.length),
        kind: "net",
        tier: t,
        len: n.name.length,
      });
    }
  });

  scored.sort((a, b) => a.tier - b.tier || a.len - b.len || a.label.localeCompare(b.label));
  for (const s of scored) {
    if (results.length >= limit) break;
    results.push({ selection: s.selection, label: s.label, detail: s.detail, kind: s.kind });
  }
  return results;
}

/** How a name must match, as in FlexBV's search: anywhere, at its start, or all of it. */
export type SearchMode = "substring" | "prefix" | "strict";

/**
 * The search for component / network: parts and nets (as chosen) whose name holds the query
 * in the given way, in name order, a part before a net of the same name. `U10.A3` finds that
 * pin first. Unconnected nets are left out.
 */
export function findNames(
  model: BoardModel,
  query: string,
  options: { parts: boolean; nets: boolean; mode: SearchMode; limit?: number },
): SearchResult[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const limit = options.limit ?? 500;
  const matches = (name: string) => {
    const n = name.toUpperCase();
    return options.mode === "strict" ? n === q : options.mode === "prefix" ? n.startsWith(q) : n.includes(q);
  };
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
      if (matches(p.name)) named.push({ selection: { kind: "part", part: i }, label: p.name, detail: p.device ?? "", kind: "part" });
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
