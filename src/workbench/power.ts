/**
 * The power tree as the repair knows it: what the copper suggests (see
 * core/powerTree), corrected and confirmed by hand with a source for each
 * statement (schematic page, datasheet, measured …), the expected power-up
 * sequence, and – kept apart from it – what was actually measured, in the
 * order it was measured.
 */
import type { BoardModel } from "../core/board";
import { findPoint } from "../core/points";
import { railRank, type Converter, type ConverterKind, type PowerTree } from "../core/powerTree";
import { railVolts } from "./diagnosis";
import { condOf, type Conditions, type Reading, type Value } from "./measure";

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
  /**
   * What each supply needs to be there first: worked out, its input and the
   * rail or power good its enable hangs on; set by hand, everything in the
   * steps before it.
   */
  needs: Map<number, number[]>;
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
    const needs = new Map<number, number[]>();
    steps.forEach((step, i) => {
      const before = steps.slice(0, i).flatMap((x) => x.supplies);
      for (const sup of step.supplies) needs.set(sup, before.filter((b) => b !== sup));
    });
    return { steps, source: { from: "user", source: set.source }, needs };
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
  return {
    steps: steps.filter((s) => s.supplies.length),
    source: { from: "derived" },
    needs: new Map([...after].map(([sup, before]) => [sup, [...before]])),
  };
}

export type PowerState = "off" | "standby" | "on";
export type RailStatus = "ok" | "low" | "high" | "absent" | "measured";

export interface MeasuredPoint {
  supply: number;
  net: number;
  /** Where it was measured: a pin or test point ("U1.1"); absent for the net as a whole. */
  point?: string;
  value: Value;
  at?: string;
  /** The board's state noted with the value; undefined when none was noted. */
  power?: PowerState;
  cond?: Conditions;
  /** Against the supply's voltage, whatever the state it was taken in. */
  status: RailStatus;
}

/** How a voltage compares with a rail's: present within 10 %, absent below 10 % of it. */
export function railStatus(expected: number | undefined, v: Value): RailStatus {
  if (expected === undefined) return "measured";
  if (v === "OL") return "absent";
  if (v < expected * 0.1) return "absent";
  if (v < expected * 0.9) return "low";
  if (v > expected * 1.1) return "high";
  return "ok";
}

/**
 * What was measured on the rails, in the order it was measured: every
 * voltage of the case on a net of a supply and at a pin or test point of
 * one (found by the point, else by the net it was on), earlier values from
 * the history included, oldest first – each with the conditions it was
 * taken under. This is the actual course, kept apart from the expected
 * sequence.
 */
export function measuredCourse(
  model: BoardModel,
  tree: ResolvedTree,
  readings: Record<string, Reading> | undefined,
  points?: Record<string, Reading>,
): MeasuredPoint[] {
  const out: MeasuredPoint[] = [];
  const add = (net: number | undefined, r: Reading, point?: string) => {
    const supply = net === undefined ? undefined : tree.supplyOf.get(net);
    if (net === undefined || supply === undefined) return;
    const expected = tree.supplies[supply].volts;
    const entry = (value: Value, at: string | undefined, cond: Conditions | undefined): MeasuredPoint => ({
      supply,
      net,
      ...(point && { point }),
      value,
      ...(at && { at }),
      ...(cond?.power && { power: cond.power }),
      ...(cond && { cond }),
      status: railStatus(expected, value),
    });
    for (const h of r.history ?? []) if (h.voltage !== undefined) out.push(entry(h.voltage, h.at, h.cond));
    if (r.voltage !== undefined) out.push(entry(r.voltage, r.at?.voltage ?? r.updated, condOf(r, "voltage")));
  };
  for (const [name, r] of Object.entries(readings ?? {})) add(model.findNet(name), r);
  for (const [point, r] of Object.entries(points ?? {})) {
    // The point's net on this board; the net noted with the value when the point is not found.
    const at = findPoint(model, point);
    const net = at?.kind === "pin" ? model.pins[at.pin].net : at?.kind === "testPoint" ? model.testPoints[at.testPoint].net : r.net ? model.findNet(r.net) : undefined;
    add(net, r, point);
  }
  return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/**
 * The state the diagnosis judges by: on, when anything was measured with
 * the board on; else standby; else the values without a noted state. Values
 * taken with the board off never show a supply missing.
 */
export function diagnosisState(course: readonly MeasuredPoint[]): PowerState | undefined {
  if (course.some((p) => p.power === "on")) return "on";
  if (course.some((p) => p.power === "standby")) return "standby";
  return undefined;
}

/** A supply as measured in one state: one status, or a conflict between measuring points. */
export interface SupplyState {
  status: RailStatus | "conflict" | "idle";
  /** The latest value at each place it was measured (pin, test point, net) in that state. */
  places: MeasuredPoint[];
}

/**
 * Each supply's state from the values that fit `state` (those noted with it,
 * and those with no state noted); values taken with the board off are left
 * out unless the state asked for is "off". The latest value of each place
 * counts; places that disagree (one present, one missing) are a conflict,
 * named with their places. In standby, a supply that is not always-on is
 * expected to be off ("idle"), not missing.
 */
export function supplyStates(model: BoardModel, tree: ResolvedTree, course: readonly MeasuredPoint[], state: PowerState | undefined): Map<number, SupplyState> {
  const fits = (p: MeasuredPoint) => p.power === state || (p.power === undefined && state !== "off");
  const latest = new Map<number, Map<string, MeasuredPoint>>();
  for (const p of course) {
    if (!fits(p)) continue;
    const places = latest.get(p.supply) ?? new Map<string, MeasuredPoint>();
    places.set(p.point ?? `net:${p.net}`, p);
    latest.set(p.supply, places);
  }
  const out = new Map<number, SupplyState>();
  for (const [supply, places] of latest) {
    const list = [...places.values()];
    const statuses = new Set(list.map((p) => p.status));
    let status: SupplyState["status"] = statuses.size === 1 ? list[0].status : "conflict";
    if (status === "absent" && state === "standby") {
      const alwaysOn = Math.max(...tree.supplies[supply].nets.map((n) => railRank(model.nets[n].name))) >= 3;
      if (!alwaysOn) status = "idle";
    }
    out.set(supply, { status, places: list });
  }
  return out;
}

export type SequenceFinding =
  /** The supplies are missing while everything they need is present: the order stops here. */
  | { kind: "break"; step: number; supplies: number[] }
  /** The first supply measured missing, with what it needs that is not checked (or missing itself). */
  | { kind: "unchecked"; step: number; supply: number; unchecked: number[]; missing: number[] };

/**
 * Where the expected order stops, as far as the measurements show it. A
 * stop is only stated where a missing supply's every requirement (see
 * `needs`) is measured present. Otherwise the first missing supply is named
 * with the requirements still unchecked – nothing more is claimed.
 */
export function sequenceFinding(sequence: ExpectedSequence, states: Map<number, SupplyState>): SequenceFinding | undefined {
  const status = (s: number) => states.get(s)?.status;
  const missing = (s: number) => status(s) === "absent" || status(s) === "low";
  let first: SequenceFinding | undefined;
  for (let i = 0; i < sequence.steps.length; i++) {
    const established: number[] = [];
    for (const s of sequence.steps[i].supplies) {
      if (!missing(s)) continue;
      const needs = sequence.needs.get(s) ?? [];
      const notPresent = needs.filter((n) => status(n) !== "ok");
      if (notPresent.length === 0) established.push(s);
      else
        first ??= {
          kind: "unchecked",
          step: i,
          supply: s,
          unchecked: notPresent.filter((n) => !missing(n)),
          missing: notPresent.filter(missing),
        };
    }
    if (established.length) return first && first.step < i ? first : { kind: "break", step: i, supplies: established };
    if (first) return first;
  }
  return undefined;
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
