/**
 * The readings of two boards side by side, net by net and point by point:
 * a revision against the one before, or a board against a donor. Nets are
 * paired as the comparison of the boards paired them, so a renamed net
 * keeps its readings. That the two are other revisions is the point of the
 * comparison, so the revision alone does not keep two readings apart;
 * other differing conditions do.
 */
import { compare, condOf, conditionsFit, QUANTITIES, type Conditions, type Quantity, type Reading, type Value } from "./measure";
import type { BoardNotes } from "./notes";

export type ReadingStatus = "deviation" | "conditions" | "onlyA" | "onlyB" | "ok";

export interface ReadingDifference {
  /** The net on A (B's name in `netB` when it is called otherwise there). */
  net: string;
  netB?: string;
  /** A pin or test point ("U7.21", "TP:TP12") for readings taken at one point. */
  point?: string;
  quantity: Quantity;
  a?: Value;
  b?: Value;
  status: ReadingStatus;
}

const ORDER: Record<ReadingStatus, number> = { deviation: 0, conditions: 1, onlyA: 2, onlyB: 3, ok: 4 };

const withoutRevision = (c: Conditions | undefined): Conditions | undefined => {
  if (!c) return c;
  const { revision: _, ...rest } = c;
  return rest;
};

/**
 * Reference readings of A against those of B. `netOnB` gives B's name of a
 * net of A (by A's name in the file), undefined when B has no such net.
 */
export function diffReadings(a: BoardNotes, b: BoardNotes, netOnB: (net: string) => string | undefined, tolerance: number): ReadingDifference[] {
  const out: ReadingDifference[] = [];
  const pair = (ra: Reading | undefined, rb: Reading | undefined, base: Pick<ReadingDifference, "net" | "netB" | "point">) => {
    for (const q of QUANTITIES) {
      const va = ra?.[q];
      const vb = rb?.[q];
      if (va === undefined && vb === undefined) continue;
      let status: ReadingStatus;
      if (va === undefined) status = "onlyB";
      else if (vb === undefined) status = "onlyA";
      else if (!conditionsFit(withoutRevision(condOf(ra, q)), withoutRevision(condOf(rb, q)), q)) status = "conditions";
      else status = compare(va, vb, q, tolerance) === "ok" ? "ok" : "deviation";
      out.push({ ...base, quantity: q, ...(va !== undefined && { a: va }), ...(vb !== undefined && { b: vb }), status });
    }
  };
  // Nets: A's, with B's under the name the net has there.
  const usedB = new Set<string>();
  for (const [net, ra] of Object.entries(a.reference)) {
    const onB = netOnB(net);
    const key = onB === undefined ? undefined : Object.keys(b.reference).find((k) => k.toUpperCase() === onB.toUpperCase());
    if (key !== undefined) usedB.add(key);
    pair(ra, key !== undefined ? b.reference[key] : undefined, { net, ...(onB !== undefined && onB.toUpperCase() !== net.toUpperCase() && { netB: onB }) });
  }
  for (const [net, rb] of Object.entries(b.reference)) if (!usedB.has(net)) pair(undefined, rb, { net });
  // Points: the same pin or test point on both.
  const pa = a.referencePoints ?? {};
  const pb = b.referencePoints ?? {};
  for (const point of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    const net = pa[point]?.net ?? pb[point]?.net ?? "";
    const netB = pb[point]?.net;
    pair(pa[point], pb[point], { net, point, ...(netB && netB.toUpperCase() !== net.toUpperCase() && { netB }) });
  }
  return out.sort((x, y) => ORDER[x.status] - ORDER[y.status] || x.net.localeCompare(y.net, undefined, { numeric: true }) || (x.point ?? "").localeCompare(y.point ?? ""));
}
