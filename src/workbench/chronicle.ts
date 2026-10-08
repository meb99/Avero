/**
 * The repair chronicle (F54): the work steps of a case and its readings in the order they
 * happened, and for each step the values its nets and points had before and after it.
 */
import { QUANTITIES, takenAt, type Conditions, type Quantity, type Reading, type Value } from "./measure";
import type { RepairCase, RepairStep } from "./notes";

/** One value as it was taken: now or earlier (from the reading's history). */
export interface MeasureEvent {
  at: string;
  /** Net name, or point key for a reading at a single point. */
  subject: string;
  point: boolean;
  q: Quantity;
  value: Value;
  cond?: Conditions;
}

function eventsOf(readings: Record<string, Reading> | undefined, point: boolean): MeasureEvent[] {
  const out: MeasureEvent[] = [];
  for (const [subject, r] of Object.entries(readings ?? {})) {
    for (const h of r.history ?? [])
      for (const q of QUANTITIES) {
        const value = h[q];
        if (value !== undefined) out.push({ at: h.at, subject, point, q, value, ...(h.cond && { cond: h.cond }) });
      }
    for (const q of QUANTITIES) {
      const value = r[q];
      const at = takenAt(r, q);
      if (value !== undefined && at) out.push({ at, subject, point, q, value, ...(r.conds?.[q] && { cond: r.conds[q] }) });
    }
  }
  return out;
}

/** Every value of the case with when it was taken, oldest first. */
export function measureEvents(c: RepairCase): MeasureEvent[] {
  return [...eventsOf(c.readings, false), ...eventsOf(c.points, true)].sort((a, b) => a.at.localeCompare(b.at));
}

/** What a step touches: its nets, its point, and the points on its part ("C7012" → "C7012.1"). */
function touches(step: RepairStep, e: MeasureEvent): boolean {
  if (!e.point) return step.nets?.includes(e.subject) ?? false;
  if (!step.target) return false;
  const t = step.target.toUpperCase();
  const s = e.subject.toUpperCase();
  return s === t || s.startsWith(`${t}.`);
}

/** A value before a step and the next one after it, for one net or point and quantity. */
export interface Evidence {
  subject: string;
  point: boolean;
  q: Quantity;
  before?: MeasureEvent;
  after?: MeasureEvent;
}

/**
 * Before and after a step: the last value taken before it, and the first taken after it
 * and before the next step that touches the same net or point – a value taken after a
 * later change says nothing about this one.
 */
export function stepEvidence(c: RepairCase, step: RepairStep, events = measureEvents(c)): Evidence[] {
  const steps = c.steps ?? [];
  const groups = new Map<string, MeasureEvent[]>();
  for (const e of events) {
    if (!touches(step, e)) continue;
    const key = `${e.point ? "p" : "n"}|${e.subject}|${e.q}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: Evidence[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const nextStep = steps.find((s) => s.at > step.at && s.id !== step.id && touches(s, first));
    // A value taken at the very moment of the step follows from it, as the chronicle lists it.
    const before = [...list].reverse().find((e) => e.at < step.at);
    const after = list.find((e) => e.at >= step.at && (!nextStep || e.at < nextStep.at));
    if (before || after) out.push({ subject: first.subject, point: first.point, q: first.q, before, after });
  }
  return out.sort((a, b) => a.subject.localeCompare(b.subject, undefined, { numeric: true }) || QUANTITIES.indexOf(a.q) - QUANTITIES.indexOf(b.q));
}

export type ChronicleEntry = { kind: "step"; at: string; step: RepairStep; evidence: Evidence[] } | { kind: "measure"; at: string; event: MeasureEvent };

/** Steps and readings of the case in the order they happened. */
export function chronicle(c: RepairCase): ChronicleEntry[] {
  const events = measureEvents(c);
  const entries: ChronicleEntry[] = [
    ...(c.steps ?? []).map((step): ChronicleEntry => ({ kind: "step", at: step.at, step, evidence: stepEvidence(c, step, events) })),
    ...events.map((event): ChronicleEntry => ({ kind: "measure", at: event.at, event })),
  ];
  // At the same moment a step comes before the readings that follow from it.
  return entries.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === b.kind ? 0 : a.kind === "step" ? -1 : 1));
}
