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
