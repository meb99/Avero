/**
 * What a reading should be, from every known good board measured: the
 * board's reference and each repair case marked as a good board, plus
 * limits set by hand (from a datasheet, say). Values are only pooled when
 * they were taken under the same revision, probe direction, power state,
 * fitted parts and modules; OL and missing readings never count as zero.
 */
import { conditionsFit, condOf, FLOOR, takenAt, type Comparison, type Conditions, type Quantity, type Reading, type Value } from "./measure";
import type { BoardNotes } from "./notes";

/** A value as one good board gave it. */
export interface RawValue {
  /** "reference" or the case id. */
  source: string;
  title: string;
  value: Value;
  cond?: Conditions;
  at?: string;
}

/** Values taken the same way, pooled. */
export interface ExpectedGroup {
  /** The conditions they share (fields they do not share are left out). */
  cond: Conditions;
  values: RawValue[];
  /** The numeric values, sorted; OL is not a number and not in here. */
  numbers: number[];
  /** How many boards read OL. */
  ol: number;
  min?: number;
  max?: number;
  median?: number;
}

/** A limit set by hand, with where it comes from. */
export interface Limit {
  min?: number;
  max?: number;
  source: string;
}

export interface Expected {
  groups: ExpectedGroup[];
  /** The groups that fit the conditions asked for. */
  fitting: ExpectedGroup[];
  limit?: Limit;
}

/** Limits per net name or point id, per quantity. */
export type Limits = Record<string, Partial<Record<Quantity, Limit>>>;

/** The known good boards: the reference, and the cases marked as good boards. */
export function goodBoards(notes: BoardNotes, referenceTitle: string): { id: string; title: string; readings: Record<string, Reading>; points?: Record<string, Reading> }[] {
  return [
    { id: "reference", title: referenceTitle, readings: notes.reference, points: notes.referencePoints },
    ...notes.cases.filter((c) => c.good).map((c) => ({ id: c.id, title: c.title, readings: c.readings, points: c.points })),
  ];
}

const norm = (s: string | undefined) => (s ?? "").toUpperCase().replace(/[\s,;]+/g, " ").trim();

/** The part of the conditions that decides whether values may be pooled, for a quantity. */
function poolKey(c: Conditions | undefined, q: Quantity): { key: string; cond: Conditions } {
  const cond: Conditions = {};
  const k = c ?? {};
  if (k.revision !== undefined) cond.revision = k.revision;
  if (k.power !== undefined) cond.power = k.power;
  if (q === "voltage" && k.battery !== undefined) cond.battery = k.battery;
  if (q !== "voltage" && k.polarity !== undefined) cond.polarity = k.polarity;
  if (k.assembly !== undefined) cond.assembly = k.assembly;
  if (k.removed !== undefined) cond.removed = k.removed;
  if (k.modules !== undefined) cond.modules = k.modules;
  const key = JSON.stringify([cond.revision, cond.power, cond.battery, cond.polarity, cond.assembly === "complete" ? "complete" : cond.assembly ? "off" : undefined, norm(cond.removed), norm(cond.modules)]);
  return { key, cond };
}

function finish(values: RawValue[], cond: Conditions): ExpectedGroup {
  const numbers = values.flatMap((v) => (typeof v.value === "number" ? [v.value] : [])).sort((a, b) => a - b);
  const ol = values.filter((v) => v.value === "OL").length;
  const mid = numbers.length >> 1;
  return {
    cond,
    values,
    numbers,
    ol,
    ...(numbers.length && {
      min: numbers[0],
      max: numbers[numbers.length - 1],
      median: numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2,
    }),
  };
}

/**
 * What a net (or, with `point`, a single point) should read for quantity
 * `q`, taken under `cond`: the good boards' values pooled by fitting
 * conditions, and a hand-set limit when there is one.
 */
export function expectedFor(notes: BoardNotes, referenceTitle: string, name: string, q: Quantity, cond: Conditions | undefined, point?: string): Expected {
  const byKey = new Map<string, { cond: Conditions; values: RawValue[] }>();
  for (const board of goodBoards(notes, referenceTitle)) {
    const r = point ? board.points?.[point] : board.readings[name];
    const value = r?.[q];
    if (value === undefined) continue;
    const c = condOf(r, q);
    const { key, cond: shared } = poolKey(c, q);
    let group = byKey.get(key);
    if (!group) byKey.set(key, (group = { cond: shared, values: [] }));
    group.values.push({ source: board.id, title: board.title, value, ...(c && { cond: c }), ...(takenAt(r, q) && { at: takenAt(r, q) }) });
  }
  const groups = [...byKey.values()].map((g) => finish(g.values, g.cond));
  const limit = notes.limits?.[point ?? name]?.[q];
  return { groups, fitting: groups.filter((g) => conditionsFit(g.cond, cond, q)), ...(limit && { limit }) };
}

/** Whether there is more to judge by than the one reference: good boards or limits. */
export function hasMoreReferences(notes: BoardNotes): boolean {
  return notes.cases.some((c) => c.good) || Object.keys(notes.limits ?? {}).length > 0;
}

const allowance = (v: number, q: Quantity, tolerance: number) => Math.max(Math.abs(v) * tolerance, FLOOR[q]);

/** A value against one group: inside its range (widened by the tolerance) or not. */
function judgeGroup(g: ExpectedGroup, value: Value, q: Quantity, tolerance: number): Comparison | undefined {
  if (value === "OL") return g.ol > 0 ? "ok" : g.numbers.length ? "deviation" : undefined;
  if (g.min === undefined || g.max === undefined) return g.ol > 0 ? "deviation" : undefined;
  return value >= g.min - allowance(g.min, q, tolerance) && value <= g.max + allowance(g.max, q, tolerance) ? "ok" : "deviation";
}

/**
 * A measured value against what is expected: a hand-set limit first, else
 * the fitting group. Several fitting groups that disagree, or none: the
 * value is not judged ("mismatch": not comparable as taken).
 */
export function judgeExpected(e: Expected, value: Value | undefined, q: Quantity, tolerance: number): Comparison | "mismatch" | undefined {
  if (value === undefined) return undefined;
  if (e.limit && (e.limit.min !== undefined || e.limit.max !== undefined)) {
    if (value === "OL") return e.limit.max === undefined ? "ok" : "deviation";
    return (e.limit.min === undefined || value >= e.limit.min) && (e.limit.max === undefined || value <= e.limit.max) ? "ok" : "deviation";
  }
  if (e.groups.length === 0) return undefined;
  if (e.fitting.length === 0) return "mismatch";
  const results = new Set(e.fitting.map((g) => judgeGroup(g, value, q, tolerance)));
  if (results.size === 1) return [...results][0];
  return "mismatch";
}

/** "0,41–0,45 V · Median 0,43 · 3 Boards" style facts of a group, for display. */
export function groupFacts(g: ExpectedGroup): { boards: number; min?: number; max?: number; median?: number; ol: number } {
  return { boards: g.values.length, min: g.min, max: g.max, median: g.median, ol: g.ol };
}

/** Parses "0.40-0.50 Datenblatt" / "0,4 … 0,5 mV TPS51" / ">= 3.2 Schaltplan" into a limit. */
export function parseLimit(text: string): Limit | undefined {
  const t = text.trim();
  const num = String.raw`(-?\d+(?:[.,]\d+)?)`;
  const range = new RegExp(String.raw`^${num}\s*(?:-|–|…|\.\.\.?|bis|to)\s*${num}\s*(.*)$`, "i").exec(t);
  const toNumber = (s: string) => Number.parseFloat(s.replace(",", "."));
  if (range) {
    const [a, b] = [toNumber(range[1]), toNumber(range[2])].sort((x, y) => x - y);
    return { min: a, max: b, source: range[3].trim() || "?" };
  }
  const bound = new RegExp(String.raw`^(>=?|≥|<=?|≤)\s*${num}\s*(.*)$`).exec(t);
  if (bound) {
    const v = toNumber(bound[2]);
    const lower = bound[1].startsWith(">") || bound[1] === "≥";
    return { ...(lower ? { min: v } : { max: v }), source: bound[3].trim() || "?" };
  }
  return undefined;
}

/** Sets (or, with `undefined`, removes) a hand-set limit. */
export function setLimit(notes: BoardNotes, name: string, q: Quantity, limit: Limit | undefined): BoardNotes {
  const limits: Limits = { ...notes.limits };
  const entry = { ...limits[name] };
  if (limit) entry[q] = limit;
  else delete entry[q];
  if (Object.keys(entry).length) limits[name] = entry;
  else delete limits[name];
  return { ...notes, limits: Object.keys(limits).length ? limits : undefined, updated: new Date().toISOString() };
}

/** Stored limits, checked. */
export function parseLimits(value: unknown): Limits | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Limits = {};
  for (const [name, per] of Object.entries(value as Record<string, unknown>)) {
    if (!per || typeof per !== "object") continue;
    const entry: Partial<Record<Quantity, Limit>> = {};
    for (const q of ["diode", "voltage", "resistance"] as Quantity[]) {
      const l = (per as Record<string, unknown>)[q] as Record<string, unknown> | undefined;
      if (!l || typeof l !== "object" || typeof l.source !== "string") continue;
      const min = typeof l.min === "number" && Number.isFinite(l.min) ? l.min : undefined;
      const max = typeof l.max === "number" && Number.isFinite(l.max) ? l.max : undefined;
      if (min === undefined && max === undefined) continue;
      entry[q] = { ...(min !== undefined && { min }), ...(max !== undefined && { max }), source: l.source };
    }
    if (Object.keys(entry).length) out[name] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The expected value in short ("0,41–0,45 V", "≥ 3,2 V"), when there is one to show. */
export function expectedShort(e: Expected, format: (v: Value) => string): string | undefined {
  if (e.limit) {
    const { min, max } = e.limit;
    if (min !== undefined && max !== undefined) return `${format(min)} – ${format(max)}`;
    if (min !== undefined) return `≥ ${format(min)}`;
    if (max !== undefined) return `≤ ${format(max)}`;
  }
  if (e.fitting.length !== 1) return undefined;
  const g = e.fitting[0];
  if (g.min === undefined || g.max === undefined) return g.ol ? format("OL") : undefined;
  return g.min === g.max ? format(g.min) : `${format(g.min)} – ${format(g.max)}`;
}
