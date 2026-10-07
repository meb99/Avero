/**
 * Explained hints for the next test step (F37): what a net's readings in the repair case
 * say, measured against what – with the source and the conditions of every value – which
 * parts come into question and why, what is still open, what does not fit together, and
 * which measurement would tell the alternatives apart. A hint never names a culprit on a
 * single reading: a low resistance makes candidates, not a verdict.
 */
import type { BoardModel } from "../core/board";
import { shortCandidates, type ShortCandidate } from "../core/shortFinder";
import { expectedFor, judgeExpected, type Expected } from "./expected";
import { condOf, conditionsFit, QUANTITIES, takenAt, type Conditions, type Quantity, type Value } from "./measure";
import { activeCase, type BoardNotes } from "./notes";

export type Finding =
  /** Next to nothing to ground: a short. */
  | "short"
  /** Lower than the good boards, but not a short. */
  | "low"
  /** Open where the good boards read a value. */
  | "open"
  | "deviation"
  | "fits"
  /** Values there, but nothing to judge them by under these conditions. */
  | "unjudged"
  | "noValue";

/** A value the hint rests on, with where and how it was taken. */
export interface HintValue {
  q: Quantity;
  value: Value;
  cond?: Conditions;
  /** Case title. */
  source: string;
  at?: string;
  judged?: "ok" | "deviation" | "mismatch";
}

export type Contradiction =
  /** The good boards were measured under other conditions: not comparable. */
  | "conditions"
  /** Diode mode and resistance tell different stories. */
  | "diodeVsResistance"
  /** The same reading moved a lot between takes (a big capacitor charging, a loose probe). */
  | "unstable"
  /** The good boards disagree among themselves. */
  | "goodBoardsDisagree";

/** A measurement that would tell the alternatives apart, or that is missing to judge at all. */
export type NeededStep =
  | "measureDiode"
  | "measureResistance"
  | "reference"
  | "sameConditions"
  | "remeasureBoth"
  | "isolate"
  | "injection"
  | "consumers"
  | "settle";

/** The things that could be behind the finding, none of them confirmed by it. */
export type Alternative = "capacitor" | "chip" | "transistorDiode" | "bridge" | "consumer" | "conditions" | "probe";

export interface HintCandidate {
  part: number;
  kind: ShortCandidate["kind"];
  size: number;
  /** An earlier case fixed this net by working on this part. */
  confirmed?: { caseTitle: string; action: string };
}

export interface NetHint {
  net: string;
  finding: Finding;
  values: HintValue[];
  /** What the good boards say, per quantity measured. */
  expected: Partial<Record<Quantity, Expected>>;
  contradictions: Contradiction[];
  candidates: HintCandidate[];
  alternatives: Alternative[];
  needed: NeededStep[];
  /** Isolate this part first: the most likely candidate that can be lifted and measured again. */
  isolateFirst?: number;
}

const SHORT = { diode: 0.05, resistance: 2 };

/** The hint for one net in the active case (none without a case). */
export function netHint(model: BoardModel, notes: BoardNotes, net: number, tolerance: number, referenceTitle: string): NetHint | null {
  const repair = activeCase(notes);
  if (!repair) return null;
  const name = model.nets[net].name;
  const r = repair.readings[name];
  const values: HintValue[] = [];
  const expected: NetHint["expected"] = {};
  const contradictions = new Set<Contradiction>();
  const needed = new Set<NeededStep>();
  for (const q of QUANTITIES) {
    const value = r?.[q];
    if (value === undefined) continue;
    const cond = condOf(r, q);
    const e = expectedFor(notes, referenceTitle, name, q, cond);
    expected[q] = e;
    const judged = judgeExpected(e, value, q, tolerance);
    values.push({ q, value, ...(cond && { cond }), source: repair.title, ...(takenAt(r, q) && { at: takenAt(r, q) }), ...(judged && { judged }) });
    if (judged === "mismatch" && e.fitting.length > 1) contradictions.add("goodBoardsDisagree");
    else if (judged === "mismatch") {
      contradictions.add("conditions");
      needed.add("sameConditions");
    }
    // The same quantity under the same conditions, read quite differently a moment ago.
    const earlier = [...(r?.history ?? [])].reverse().find((h) => h[q] !== undefined && conditionsFit(h.cond, cond, q));
    const before = earlier?.[q];
    if (typeof before === "number" && typeof value === "number" && Math.max(before, value) > 0) {
      const ratio = Math.min(before, value) / Math.max(before, value);
      if (ratio < 0.5 && Math.abs(before - value) > (q === "resistance" ? 5 : 0.05)) {
        contradictions.add("unstable");
        needed.add("settle");
      }
    }
  }

  const v = (q: Quantity) => values.find((x) => x.q === q);
  const num = (q: Quantity) => (typeof v(q)?.value === "number" ? (v(q)!.value as number) : undefined);
  const diode = num("diode");
  const ohms = num("resistance");
  const shortByDiode = diode !== undefined && diode < SHORT.diode;
  const shortByOhms = ohms !== undefined && ohms < SHORT.resistance;
  if ((shortByDiode && ohms !== undefined && ohms > 100) || (shortByOhms && diode !== undefined && diode > 0.2)) {
    contradictions.add("diodeVsResistance");
    needed.add("remeasureBoth");
  }

  let finding: Finding;
  if (values.length === 0) finding = "noValue";
  else if ((shortByDiode || shortByOhms) && !contradictions.has("diodeVsResistance")) finding = "short";
  else {
    const deviating = values.filter((x) => x.judged === "deviation");
    const goodOf = (x: HintValue) => expected[x.q]?.fitting[0];
    if (deviating.some((x) => x.value === "OL" && (goodOf(x)?.numbers.length ?? 0) > 0)) finding = "open";
    else if (deviating.some((x) => typeof x.value === "number" && goodOf(x)?.min !== undefined && x.value < goodOf(x)!.min! && x.q !== "voltage")) finding = "low";
    else if (deviating.length > 0) finding = "deviation";
    else if (values.some((x) => x.judged === "ok")) finding = "fits";
    else finding = "unjudged";
  }

  // What is missing to judge at all.
  if (finding === "noValue") {
    needed.add("measureDiode");
    needed.add("measureResistance");
  } else {
    if (diode === undefined && v("diode") === undefined) needed.add("measureDiode");
    if (ohms === undefined && v("resistance") === undefined && finding !== "fits") needed.add("measureResistance");
    if (values.every((x) => !x.judged || x.judged === "mismatch") && Object.values(expected).every((e) => !e || (e.groups.length === 0 && !e.limit))) needed.add("reference");
  }

  // Who comes into question, earlier confirmed repairs first.
  let candidates: HintCandidate[] = [];
  const alternatives: Alternative[] = [];
  if (finding === "short" || finding === "low") {
    const confirmed = new Map<string, { caseTitle: string; action: string }>();
    for (const c of notes.cases) {
      if (c.id === repair.id || c.status !== "repaired") continue;
      for (const s of c.steps ?? [])
        if (s.target && s.nets?.includes(name) && s.result !== "fail" && (s.action === "replaced" || s.action === "removed"))
          confirmed.set(s.target.toUpperCase(), { caseTitle: c.title, action: s.action });
    }
    candidates = shortCandidates(model, net).map((c) => {
      const hit = confirmed.get(model.parts[c.part].name.toUpperCase());
      return { ...c, ...(hit && { confirmed: hit }) };
    });
    candidates.sort((a, b) => Number(!!b.confirmed) - Number(!!a.confirmed));
    if (candidates.some((c) => c.kind === "capacitor")) alternatives.push("capacitor");
    if (candidates.some((c) => c.kind === "chip")) alternatives.push("chip");
    if (candidates.some((c) => c.kind === "transistor" || c.kind === "diode")) alternatives.push("transistorDiode");
    alternatives.push("bridge");
    if (finding === "low") alternatives.push("consumer");
    // Lift the likeliest part that can come off easily and measure again: a capacitor, not the chip.
    const isolate = candidates.find((c) => c.confirmed && c.kind === "capacitor") ?? candidates.find((c) => c.kind === "capacitor");
    if (isolate) needed.add("isolate");
    needed.add("injection");
    if (finding === "low") needed.add("consumers");
    if (contradictions.has("conditions")) alternatives.push("conditions");
    return { net: name, finding, values, expected, contradictions: [...contradictions], candidates, alternatives, needed: [...needed], ...(isolate && { isolateFirst: isolate.part }) };
  }
  if (finding === "open") alternatives.push("consumer", "probe");
  if (contradictions.has("conditions")) alternatives.push("conditions");
  if (contradictions.has("unstable") || contradictions.has("diodeVsResistance")) alternatives.push("probe");
  return { net: name, finding, values, expected, contradictions: [...contradictions], candidates, alternatives, needed: [...needed] };
}

/** The nets of the active case worth a look, the worst first. */
export function caseHints(model: BoardModel, notes: BoardNotes, tolerance: number, referenceTitle: string): NetHint[] {
  const repair = activeCase(notes);
  if (!repair) return [];
  const byName = new Map(model.nets.map((n, i) => [n.name, i]));
  const order: Finding[] = ["short", "low", "open", "deviation", "unjudged"];
  const rank = (h: NetHint) => (order.includes(h.finding) ? order.indexOf(h.finding) : order.length);
  return Object.keys(repair.readings)
    .flatMap((name) => {
      const i = byName.get(name);
      const h = i === undefined || model.nets[i].kind === "ground" ? null : netHint(model, notes, i, tolerance, referenceTitle);
      return h && (order.includes(h.finding) || h.contradictions.length > 0) ? [h] : [];
    })
    .sort((a, b) => rank(a) - rank(b) || a.net.localeCompare(b.net, undefined, { numeric: true }));
}
