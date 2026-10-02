/**
 * Diagnosis flows: steps with measuring points, expected values and
 * branches. The built-in guides (notebook, consoles) and the user's own
 * saved repair routes all run through the same runner.
 *
 * Branches: after a step, "ok" goes to `onOk` (the next step when unset,
 * the end with null); a deviation goes to `onBad` when set, otherwise the
 * flow stops there and shows the step's hint.
 */
import { formatValue, type Quantity, type Value } from "./measure";
import type { BoardNotes } from "./notes";

export type FlowExpect =
  | { kind: "value"; value: number; tolerance: number }
  | { kind: "range"; min: number; max: number }
  /** A logic signal or rail that is on: at least 1 V. */
  | { kind: "high" }
  /** Off / pulled down: below 0.3 V. */
  | { kind: "low" }
  /** Something there at all (≥ 1 V for voltages, a reading otherwise). */
  | { kind: "present" }
  /** Open: the meter shows OL. */
  | { kind: "ol" }
  /** Diode or resistance reading that is no short to ground: above 0.1 V / 2 Ω, or OL. */
  | { kind: "noShort" };

export interface FlowPoint {
  /** Net name on the board. */
  net: string;
  quantity: Quantity;
  expect: FlowExpect;
  label?: string;
  /** Where the expected value comes from (shown with it). */
  source?: string;
}

export interface FlowStep {
  id: string;
  title: string;
  text?: string;
  /** Shown when the step deviates and the flow stops there. */
  hint?: string;
  points: FlowPoint[];
  /** Step id after "ok"; undefined = next step, null = end. */
  onOk?: string | null;
  /** Step id after a deviation; undefined = stop here and show the hint. */
  onBad?: string | null;
}

export interface Flow {
  id: string;
  title: string;
  /** Device or board family it is for ("Switch OLED"), shown in the list. */
  device?: string;
  /** Board it was made on; flows of other boards are offered when their nets exist. */
  boardKey?: string;
  created: string;
  steps: FlowStep[];
}

const FLOOR: Record<Quantity, number> = { diode: 0.015, voltage: 0.05, resistance: 2 };

/** Judges one value against an expectation. */
export function judgeFlow(e: FlowExpect, value: Value | undefined, q: Quantity): "ok" | "bad" | undefined {
  if (value === undefined) return undefined;
  if (e.kind === "ol") return value === "OL" ? "ok" : "bad";
  if (e.kind === "noShort") return value === "OL" || value > (q === "resistance" ? 2 : 0.1) ? "ok" : "bad";
  if (e.kind === "present") return value === "OL" ? (q === "voltage" ? "bad" : "ok") : q === "voltage" ? (value >= 1 ? "ok" : "bad") : "ok";
  if (value === "OL") return "bad";
  switch (e.kind) {
    case "value":
      return Math.abs(value - e.value) <= Math.max(Math.abs(e.value) * e.tolerance, FLOOR[q]) ? "ok" : "bad";
    case "range":
      return value >= e.min && value <= e.max ? "ok" : "bad";
    case "high":
      return value >= 1 ? "ok" : "bad";
    case "low":
      return value < 0.3 ? "ok" : "bad";
  }
}

export type StepState = "ok" | "bad" | "open" | "empty";

/** A step's state from its points' readings. */
export function stepState(step: FlowStep, value: (p: FlowPoint) => Value | undefined): StepState {
  if (step.points.length === 0) return "empty";
  const results = step.points.map((p) => judgeFlow(p.expect, value(p), p.quantity));
  if (results.includes("bad")) return "bad";
  return results.every((r) => r === "ok") ? "ok" : "open";
}

/**
 * The steps on the way through a flow, by index. A flow without branches
 * shows every step; branches skip what does not apply. The walk stops at a
 * deviation without `onBad` (the place to look) and never loops.
 */
export function flowPath(steps: FlowStep[], states: StepState[]): number[] {
  const index = new Map(steps.map((s, i) => [s.id, i]));
  const path: number[] = [];
  const seen = new Set<number>();
  let i = steps.length ? 0 : -1;
  while (i >= 0 && i < steps.length && !seen.has(i)) {
    seen.add(i);
    path.push(i);
    const step = steps[i];
    const state = states[i];
    let next: string | null | undefined;
    if (state === "bad") {
      if (step.onBad === undefined) break;
      next = step.onBad;
    } else if (state === "ok") next = step.onOk;
    else next = undefined;
    if (next === null) break;
    i = next === undefined ? i + 1 : (index.get(next) ?? -1);
  }
  return path;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Expected value from a known-good reading. */
function expectFrom(value: Value): FlowExpect {
  if (value === "OL") return { kind: "ol" };
  return { kind: "value", value, tolerance: 0.1 };
}

/**
 * A repair as a reusable route: one step per net measured in the case, in
 * the order measured, expecting the reference (or, without one, the value
 * the repaired board shows now). The case's findings become the hint.
 */
export function flowFromCase(notes: BoardNotes, caseId: string, title: string, device?: string): Flow | null {
  const c = notes.cases.find((x) => x.id === caseId);
  if (!c) return null;
  const nets = Object.entries(c.readings)
    .filter(([, r]) => r.diode !== undefined || r.voltage !== undefined || r.resistance !== undefined)
    .sort((a, b) => (a[1].history?.[0]?.at ?? a[1].updated ?? "").localeCompare(b[1].history?.[0]?.at ?? b[1].updated ?? ""));
  if (nets.length === 0) return null;
  const steps: FlowStep[] = nets.map(([net, r]) => {
    const ref = notes.reference[net];
    const points: FlowPoint[] = [];
    for (const q of ["diode", "voltage", "resistance"] as const) {
      const good = ref?.[q] ?? r[q];
      if (good !== undefined) points.push({ net, quantity: q, expect: expectFrom(good), source: ref?.[q] !== undefined ? "reference" : "case" });
    }
    return { id: newId(), title: net, text: r.note, hint: c.notes || undefined, points };
  });
  return { id: newId(), title, device: device ?? c.device, boardKey: notes.key, created: new Date().toISOString(), steps };
}

export function newStep(title: string): FlowStep {
  return { id: newId(), title, points: [] };
}

export function newFlow(title: string, boardKey?: string): Flow {
  return { id: newId(), title, boardKey, created: new Date().toISOString(), steps: [newStep("1")] };
}

const KINDS = new Set(["value", "range", "high", "low", "present", "ol", "noShort"]);

function parseExpect(v: unknown): FlowExpect | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (typeof e.kind !== "string" || !KINDS.has(e.kind)) return null;
  if (e.kind === "value") return Number.isFinite(e.value) ? { kind: "value", value: e.value as number, tolerance: Number.isFinite(e.tolerance) ? (e.tolerance as number) : 0.1 } : null;
  if (e.kind === "range") return Number.isFinite(e.min) && Number.isFinite(e.max) ? { kind: "range", min: e.min as number, max: e.max as number } : null;
  return { kind: e.kind } as FlowExpect;
}

/** Validates stored flows; broken entries are dropped, not the whole file. */
export function parseFlows(json: string | null): Flow[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json) as unknown;
    const list = Array.isArray(data) ? data : (data as { flows?: unknown[] })?.flows;
    if (!Array.isArray(list)) return [];
    return list.flatMap((f): Flow[] => {
      if (!f || typeof f.id !== "string" || typeof f.title !== "string" || !Array.isArray(f.steps)) return [];
      const steps = (f.steps as unknown[]).flatMap((s): FlowStep[] => {
        const st = s as Partial<FlowStep>;
        if (!st || typeof st.id !== "string" || typeof st.title !== "string") return [];
        const points = (Array.isArray(st.points) ? st.points : []).flatMap((p): FlowPoint[] => {
          const expect = parseExpect(p?.expect);
          if (!p || typeof p.net !== "string" || !["diode", "voltage", "resistance"].includes(p.quantity) || !expect) return [];
          return [{ net: p.net, quantity: p.quantity, expect, ...(typeof p.label === "string" && { label: p.label }), ...(typeof p.source === "string" && { source: p.source }) }];
        });
        const branch = (b: unknown) => (b === null ? null : typeof b === "string" ? b : undefined);
        return [
          {
            id: st.id,
            title: st.title,
            ...(typeof st.text === "string" && { text: st.text }),
            ...(typeof st.hint === "string" && { hint: st.hint }),
            points,
            ...(branch(st.onOk) !== undefined && { onOk: branch(st.onOk) }),
            ...(branch(st.onBad) !== undefined && { onBad: branch(st.onBad) }),
          },
        ];
      });
      return [
        {
          id: f.id,
          title: f.title,
          ...(typeof f.device === "string" && { device: f.device }),
          ...(typeof f.boardKey === "string" && { boardKey: f.boardKey }),
          created: typeof f.created === "string" ? f.created : new Date(0).toISOString(),
          steps,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** "0,42 V ± 10 %", "≥ 1 V", "OL" … */
export function expectText(e: FlowExpect, q: Quantity, lang: string, words: { high: string; low: string; present: string; noShort: string }): string {
  switch (e.kind) {
    case "value":
      return `${formatValue(e.value, q, lang)} ± ${Math.round(e.tolerance * 100)} %`;
    case "range":
      return `${formatValue(e.min, q, lang)} – ${formatValue(e.max, q, lang)}`;
    case "ol":
      return "OL";
    case "high":
      return words.high;
    case "low":
      return words.low;
    case "present":
      return words.present;
    case "noShort":
      return words.noShort;
  }
}
