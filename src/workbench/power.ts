/**
 * The power tree as the repair knows it: what the copper suggests (see
 * core/powerTree), corrected and confirmed by hand with a source for each
 * statement (schematic page, datasheet, measured …), the expected power-up
 * sequence, and – kept apart from it – what was actually measured, in the
 * order it was measured.
 */
import type { BoardModel } from "../core/board";
import { railRank, type Converter, type ConverterKind, type PowerTree } from "../core/powerTree";
import { railVolts } from "./diagnosis";
import type { Reading, Value } from "./measure";

/** A statement and where it comes from ("Schaltplan S. 34", "Datenblatt TPS51285", "gemessen"). */
export interface Sourced<T> {
  value: T;
  source: string;
}

/** Corrections of one converter, by part name; nets by their name in the file. */
export interface ConverterEdit {
  part: string;
  /** Not a converter at all (the copper reading was wrong). */
  removed?: boolean;
  kind?: Sourced<ConverterKind>;
  input?: Sourced<string>;
  outputs?: Sourced<string[]>;
  enable?: Sourced<string>;
  powerGood?: Sourced<string>;
  /** The copper reading was checked and is right, with the source it was checked against. */
  confirmed?: string;
}

export interface PowerNotes {
  converters: ConverterEdit[];
  /** The expected power-up order (rails by file name, in steps), set by hand with its source. */
  sequence?: Sourced<string[][]>;
}

/** Where one statement about a converter comes from. */
export type Provenance = { from: "copper"; why: string } | { from: "user"; source: string } | { from: "none" };

export interface ResolvedConverter extends Converter {
  name: string;
  /** Added by hand (the copper reading did not find it). */
  added: boolean;
  confirmed?: string;
  prov: Record<"kind" | "input" | "outputs" | "enable" | "powerGood", Provenance>;
}

export interface ResolvedTree extends PowerTree {
  converters: ResolvedConverter[];
}

/**
 * The tree with the corrections laid over it. A net named in a correction
 * that the copper reading did not take for a rail becomes a supply of its
 * own; a converter marked "not a converter" goes; one added by hand comes in.
 */
export function resolvePower(model: BoardModel, tree: PowerTree, edits: PowerNotes | undefined): ResolvedTree {
  const supplies = [...tree.supplies];
  const supplyOf = new Map(tree.supplyOf);
  const supplyFor = (name: string): number | undefined => {
    const net = model.findNet(name);
    if (net === undefined) return undefined;
    const known = supplyOf.get(net);
    if (known !== undefined) return known;
    supplies.push({ nets: [net], volts: railVolts(model.nets[net].name) });
    supplyOf.set(net, supplies.length - 1);
    return supplies.length - 1;
  };
  const byPart = new Map((edits?.converters ?? []).map((e) => [e.part.toUpperCase(), e]));
  const copper = (why: string | undefined): Provenance => (why ? { from: "copper", why } : { from: "none" });
  const out: ResolvedConverter[] = [];
  const resolve = (c: Converter | undefined, part: number, edit: ConverterEdit | undefined) => {
    const base: Converter = c ?? { part, kind: "regulator", outputs: [] };
    const r: ResolvedConverter = {
      ...base,
      name: model.parts[part].name,
      added: !c,
      ...(edit?.confirmed && { confirmed: edit.confirmed }),
      prov: {
        kind: c ? copper("shape") : { from: "none" },
        input: base.input !== undefined ? copper(base.why?.input) : { from: "none" },
        outputs: base.outputs.length ? copper(base.why?.outputs) : { from: "none" },
        enable: base.enable !== undefined ? copper("name") : { from: "none" },
        powerGood: base.powerGood !== undefined ? copper("name") : { from: "none" },
      },
    };
    if (edit?.kind) {
      r.kind = edit.kind.value;
      r.prov.kind = { from: "user", source: edit.kind.source };
    }
    if (edit?.input) {
      const s = supplyFor(edit.input.value);
      r.input = s;
      r.prov.input = { from: "user", source: edit.input.source };
    }
    if (edit?.outputs) {
      r.outputs = edit.outputs.value.flatMap((n) => {
        const s = supplyFor(n);
        return s === undefined ? [] : [s];
      });
      r.prov.outputs = { from: "user", source: edit.outputs.source };
    }
    for (const k of ["enable", "powerGood"] as const) {
      const e = edit?.[k];
      if (!e) continue;
      const net = e.value ? model.findNet(e.value) : undefined;
      if (net === undefined) delete r[k];
      else r[k] = net;
      r.prov[k] = { from: "user", source: e.source };
    }
    out.push(r);
  };
  const seen = new Set<number>();
  for (const c of tree.converters) {
    seen.add(c.part);
    const edit = byPart.get(model.parts[c.part].name.toUpperCase());
    if (edit?.removed) continue;
    resolve(c, c.part, edit);
  }
  for (const edit of edits?.converters ?? []) {
    if (edit.removed) continue;
    const part = model.findPart(edit.part);
    if (part === undefined || seen.has(part)) continue;
    resolve(undefined, part, edit);
  }
  return { supplies, supplyOf, converters: out };
}

/** Sets (or with `undefined` removes) the corrections of one converter. */
export function setConverterEdit(power: PowerNotes | undefined, part: string, edit: Omit<ConverterEdit, "part"> | undefined): PowerNotes {
  const others = (power?.converters ?? []).filter((e) => e.part.toUpperCase() !== part.toUpperCase());
  return { ...power, converters: edit ? [...others, { part, ...edit }] : others };
}

export interface SequenceStep {
  /** Supplies coming up together. */
  supplies: number[];
}

export interface ExpectedSequence {
  steps: SequenceStep[];
  /** Set by hand (with its source), or worked out from the tree. */
  source: { from: "user"; source: string } | { from: "derived" };
}

/**
 * The expected power-up order. Set by hand, it is taken as it is. Else it is
 * worked out: a converter's outputs come after its input, and after the
 * rail or power-good that drives its enable (an enable named after a rail,
 * or wired to another converter's power-good). Supplies that cannot be
 * placed by either come first with the sources. Loops are cut, not guessed.
 */
export function expectedSequence(model: BoardModel, tree: ResolvedTree, set: PowerNotes["sequence"]): ExpectedSequence {
  if (set) {
    const steps = set.value
      .map((names) => ({ supplies: [...new Set(names.flatMap((n) => {
        const net = model.findNet(n);
        const s = net === undefined ? undefined : tree.supplyOf.get(net);
        return s === undefined ? [] : [s];
      }))] }))
      .filter((s) => s.supplies.length);
    return { steps, source: { from: "user", source: set.source } };
  }
  // Each supply waits for these.
  const after = new Map<number, Set<number>>();
  const need = (s: number, before: number) => {
    if (s === before) return;
    if (!after.has(s)) after.set(s, new Set());
    after.get(s)!.add(before);
  };
  // Power-good net → the supplies whose converter reports it.
  const goodOf = new Map<number, number[]>();
  for (const c of tree.converters) if (c.powerGood !== undefined) goodOf.set(c.powerGood, [...(goodOf.get(c.powerGood) ?? []), ...c.outputs]);
  for (const c of tree.converters) {
    for (const o of c.outputs) {
      if (c.input !== undefined) need(o, c.input);
      if (c.enable === undefined) continue;
      for (const s of goodOf.get(c.enable) ?? []) need(o, s);
      // An enable wired straight to a rail (a pull-up to 3V3_ALW).
      const railOfEnable = tree.supplyOf.get(c.enable);
      if (railOfEnable !== undefined) need(o, railOfEnable);
    }
  }
  const all = new Set<number>();
  for (const c of tree.converters) {
    if (c.input !== undefined) all.add(c.input);
    for (const o of c.outputs) all.add(o);
  }
  // Longest path from the sources, loops cut where they close.
  const level = new Map<number, number>();
  const visiting = new Set<number>();
  const depth = (s: number): number => {
    const known = level.get(s);
    if (known !== undefined) return known;
    if (visiting.has(s)) return 0;
    visiting.add(s);
    let d = 0;
    for (const b of after.get(s) ?? []) d = Math.max(d, depth(b) + 1);
    visiting.delete(s);
    level.set(s, d);
    return d;
  };
  const steps: SequenceStep[] = [];
  for (const s of all) {
    const d = depth(s);
    while (steps.length <= d) steps.push({ supplies: [] });
    steps[d].supplies.push(s);
  }
  const volts = (s: number) => tree.supplies[s].volts ?? -1;
  const rank = (s: number) => Math.max(...tree.supplies[s].nets.map((n) => railRank(model.nets[n].name)));
  for (const step of steps) step.supplies.sort((a, b) => rank(b) - rank(a) || volts(b) - volts(a));
  return { steps: steps.filter((s) => s.supplies.length), source: { from: "derived" } };
}

export interface MeasuredPoint {
  supply: number;
  net: number;
  value: Value;
  at?: string;
  /** Against the supply's voltage, when it has one. */
  status: "ok" | "low" | "high" | "absent" | "measured";
}

/** How a voltage compares with a rail's: present within 10 %, absent below 10 % of it. */
export function railStatus(expected: number | undefined, v: Value): MeasuredPoint["status"] {
  if (expected === undefined) return "measured";
  if (v === "OL") return "absent";
  if (v < expected * 0.1) return "absent";
  if (v < expected * 0.9) return "low";
  if (v > expected * 1.1) return "high";
  return "ok";
}

/**
 * What was measured on the rails, in the order it was measured: every
 * voltage of the case on a net of a supply, earlier values from the
 * history included, oldest first. This is the actual course, kept apart
 * from the expected sequence.
 */
export function measuredCourse(model: BoardModel, tree: ResolvedTree, readings: Record<string, Reading> | undefined): MeasuredPoint[] {
  if (!readings) return [];
  const out: MeasuredPoint[] = [];
  for (const [name, r] of Object.entries(readings)) {
    const net = model.findNet(name);
    const supply = net === undefined ? undefined : tree.supplyOf.get(net);
    if (net === undefined || supply === undefined) continue;
    const expected = tree.supplies[supply].volts;
    for (const h of r.history ?? []) if (h.voltage !== undefined) out.push({ supply, net, value: h.voltage, at: h.at, status: railStatus(expected, h.voltage) });
    if (r.voltage !== undefined) out.push({ supply, net, value: r.voltage, ...((r.at?.voltage ?? r.updated) && { at: r.at?.voltage ?? r.updated }), status: railStatus(expected, r.voltage) });
  }
  return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/**
 * Where the expected sequence stops in what was measured: the first step
 * with a supply measured absent or low while every step before it is
 * present. Undefined when nothing stops it (or too little was measured).
 */
export function sequenceBreak(sequence: ExpectedSequence, latest: Map<number, MeasuredPoint["status"]>): { step: number; supplies: number[] } | undefined {
  for (let i = 0; i < sequence.steps.length; i++) {
    const bad = sequence.steps[i].supplies.filter((s) => latest.get(s) === "absent" || latest.get(s) === "low");
    if (bad.length) return { step: i, supplies: bad };
    if (!sequence.steps[i].supplies.some((s) => latest.get(s) === "ok")) return undefined;
  }
  return undefined;
}

/** The latest status of each supply from the measured course. */
export function latestStatus(course: readonly MeasuredPoint[]): Map<number, MeasuredPoint["status"]> {
  const out = new Map<number, MeasuredPoint["status"]>();
  for (const p of course) out.set(p.supply, p.status);
  return out;
}

export function parsePower(value: unknown): PowerNotes | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : undefined);
  const sourced = <T,>(x: unknown, ok: (y: unknown) => y is T): Sourced<T> | undefined => {
    if (!x || typeof x !== "object") return undefined;
    const o = x as Record<string, unknown>;
    return ok(o.value) && typeof o.source === "string" ? { value: o.value, source: o.source } : undefined;
  };
  const isStr = (y: unknown): y is string => typeof y === "string";
  const isStrs = (y: unknown): y is string[] => Array.isArray(y) && y.every(isStr);
  const isSteps = (y: unknown): y is string[][] => Array.isArray(y) && y.every(isStrs);
  const kinds: ConverterKind[] = ["regulator", "linear", "switch", "boost", "charger"];
  const isKind = (y: unknown): y is ConverterKind => kinds.includes(y as ConverterKind);
  const converters = Array.isArray(v.converters)
    ? v.converters.flatMap((c): ConverterEdit[] => {
        if (!c || typeof c !== "object") return [];
        const o = c as Record<string, unknown>;
        const part = str(o.part);
        if (!part) return [];
        const e: ConverterEdit = { part };
        if (o.removed === true) e.removed = true;
        const kind = sourced(o.kind, isKind);
        if (kind) e.kind = kind;
        for (const k of ["input", "enable", "powerGood"] as const) {
          const s = sourced(o[k], isStr);
          if (s) e[k] = s;
        }
        const outputs = sourced(o.outputs, isStrs);
        if (outputs) e.outputs = outputs;
        const confirmed = str(o.confirmed);
        if (confirmed) e.confirmed = confirmed;
        return [e];
      })
    : [];
  const sequence = sourced(v.sequence, isSteps);
  return converters.length || sequence ? { converters, ...(sequence && { sequence }) } : undefined;
}
