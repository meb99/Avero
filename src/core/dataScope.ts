/**
 * What a board's data holds, and where each part of it comes from: read
 * from the file, not in the file, there but hidden, added or reconstructed
 * by Avero, estimated, from text recognition, or set by hand. Shown after
 * opening so it is clear what the board can do, and so a reconstruction is
 * never taken for a fully read original.
 */
import type { BoardModel } from "./board";

export type ScopeState =
  /** Read from the file. */
  | "yes"
  /** Not in this file. */
  | "none"
  /** In the file, switched off in the view. */
  | "hidden"
  /** Added from another reading or reconstructed by Avero. */
  | "derived"
  /** Estimated (no data for it in the file). */
  | "estimated"
  /** From text recognition or PDF text, not checked. */
  | "text"
  /** Set by hand. */
  | "manual"
  /** The file may have it, Avero does not read it. */
  | "notRead"
  /** Your own data (readings, documents): none yet. */
  | "empty";

export interface ScopeRow {
  id:
    | "parts"
    | "estimatedParts"
    | "lockedParts"
    | "connections"
    | "traces"
    | "innerLayers"
    | "copperAreas"
    | "holes"
    | "testPoints"
    | "outline"
    | "bottomSide"
    | "ground"
    | "readings"
    | "fileReadings"
    | "schematic"
    | "schematicValues"
    | "manual";
  state: ScopeState;
  /** Main count. */
  n?: number;
  /** Second count (layers, cases …). */
  m?: number;
  /** How a derived part was made, as the reader put it. */
  how?: string;
}

export interface ScopeContext {
  showTraces: boolean;
  hiddenLayers: ReadonlySet<number>;
  /** The board's notes, if loaded. */
  notes?: {
    reference: Record<string, unknown>;
    referencePoints?: Record<string, unknown>;
    cases: { good?: boolean }[];
    netNames?: Record<string, string>;
    netKinds?: Record<string, unknown>;
    docLinks?: Record<string, unknown>;
    hidden?: { parts: string[] };
    limits?: Record<string, unknown>;
  } | null;
  /** Documents open for the board, with pages read by text recognition. */
  docs: { pageCount: number; recognisedPages: number }[];
  /** Part values read from the schematic's text. */
  schematicValues: number;
}

export function dataScope(model: BoardModel, ctx: ScopeContext): ScopeRow[] {
  const b = model.board;
  const derived = (what: string) => b.derived?.find((d) => d.what === what);
  const rows: ScopeRow[] = [];

  const estimatedParts = b.parts.filter((p) => p.estimated).length;
  rows.push({ id: "parts", state: b.parts.length === 0 ? "none" : "yes", n: b.parts.length - estimatedParts });
  if (estimatedParts) rows.push({ id: "estimatedParts", state: "estimated", n: estimatedParts });
  if (b.lockedParts) rows.push({ id: "lockedParts", state: "none", n: b.lockedParts });

  const connected = b.nets.filter((n) => n.kind !== "unconnected" && n.pins.length >= 2).length;
  rows.push({ id: "connections", state: connected ? "yes" : "none", n: connected, m: b.pins.length });

  const traces = b.traces ?? [];
  const copper = derived("copper");
  const layers = b.layers ?? [];
  rows.push({
    id: "traces",
    state: traces.length === 0 ? "none" : copper ? "derived" : !ctx.showTraces ? "hidden" : "yes",
    n: traces.length,
    m: layers.length,
    ...(copper && { how: copper.how }),
  });

  const inner = layers.map((l, i) => ({ l, i })).filter(({ l }) => l.side === "both");
  const innerShown = inner.filter(({ i }) => !ctx.hiddenLayers.has(i)).length;
  rows.push({
    id: "innerLayers",
    state: inner.length === 0 ? "none" : !ctx.showTraces || innerShown === 0 ? "hidden" : copper ? "derived" : "yes",
    n: inner.length,
    m: innerShown,
  });

  // Copper pours are not part of Avero's board model.
  rows.push({ id: "copperAreas", state: "notRead" });

  const vias = b.testPoints.filter((t) => t.kind === "via").length;
  const throughHole = b.parts.filter((p) => p.mount === "th").length;
  rows.push({ id: "holes", state: vias + throughHole ? "yes" : "none", n: vias, m: throughHole });

  const nails = b.testPoints.length - vias;
  rows.push({ id: "testPoints", state: nails ? "yes" : "none", n: nails });

  const outline = derived("outline");
  rows.push({ id: "outline", state: outline ? "estimated" : b.outline.length ? "yes" : "none", n: b.outline.length, ...(outline && { how: outline.how }) });

  const bottom = derived("bottom-side");
  if (bottom) rows.push({ id: "bottomSide", state: "derived", n: bottom.count, how: bottom.how });

  const assumed = b.nets.filter((n) => n.assumedGround).length;
  if (assumed) rows.push({ id: "ground", state: "estimated", n: assumed });

  const notes = ctx.notes;
  const measured = notes ? Object.keys(notes.reference).length + Object.keys(notes.referencePoints ?? {}).length : 0;
  rows.push({
    id: "readings",
    state: notes && (measured || notes.cases.length) ? "yes" : "empty",
    n: measured,
    m: notes ? notes.cases.filter((c) => c.good).length + (measured ? 1 : 0) : 0,
  });

  // Readings the file itself carries (XZZ diode values per pin), taken into the reference with their source.
  if (b.readings?.length) rows.push({ id: "fileReadings", state: "yes", n: b.readings.length, m: new Set(b.readings.map((r) => r.part)).size });

  const pages = ctx.docs.reduce((s, d) => s + d.pageCount, 0);
  const recognised = ctx.docs.reduce((s, d) => s + d.recognisedPages, 0);
  rows.push({ id: "schematic", state: ctx.docs.length === 0 ? "empty" : recognised ? "text" : "yes", n: ctx.docs.length, m: recognised || pages });
  if (ctx.schematicValues) rows.push({ id: "schematicValues", state: "text", n: ctx.schematicValues });

  const own =
    Object.keys(notes?.netNames ?? {}).length +
    Object.keys(notes?.netKinds ?? {}).length +
    Object.keys(notes?.docLinks ?? {}).length +
    (notes?.hidden?.parts.length ?? 0) +
    Object.keys(notes?.limits ?? {}).length;
  if (own) rows.push({ id: "manual", state: "manual", n: own });
  return rows;
}
