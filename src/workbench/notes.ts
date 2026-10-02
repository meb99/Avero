import { compareReadings, hasValues, HISTORY_MAX, QUANTITIES, type Comparison, type Conditions, type HistoryEntry, type Quantity, type Reading, type Value } from "./measure";
import { parsePhoto, type BoardPhoto, type PhotoSide } from "./photo";

export type CaseStatus = "open" | "waiting" | "repaired" | "unrepairable";
export const CASE_STATUSES: CaseStatus[] = ["open", "waiting", "repaired", "unrepairable"];

/** One device on the bench. */
export interface RepairCase {
  id: string;
  title: string;
  created: string;
  notes: string;
  /** Readings by net name. */
  readings: Record<string, Reading>;
  status?: CaseStatus;
  /** Device model, e.g. "Switch OLED HEG-001". */
  device?: string;
  serial?: string;
  customer?: string;
  /** Stored photo files (copied into Avero's data folder). */
  photos?: string[];
  /** Conditions new readings of this case are taken under. */
  conditions?: Conditions;
}

/** Fields of a case that are edited as a whole. */
export type CaseFields = Partial<Pick<RepairCase, "title" | "notes" | "status" | "device" | "serial" | "customer" | "photos">>;

/** A note pinned to a spot on the board, e.g. "short to ground here". */
export interface BoardMarker {
  id: string;
  /** Board position in mils. */
  x: number;
  y: number;
  side: "top" | "bottom";
  text: string;
  created: string;
}

export type DrawingKind = "line" | "area" | "jumper";

/**
 * Something drawn on the board: a line (a cut trace), an area (corrosion,
 * a burnt spot) or a jumper wire between two points, with an optional text.
 */
export interface Drawing {
  id: string;
  kind: DrawingKind;
  side: "top" | "bottom";
  /** Board positions in mils: two for a line or jumper, three or more for an area. */
  points: { x: number; y: number }[];
  text?: string;
  /** Jumper ends, e.g. "U7.3 · PP3V3". */
  from?: string;
  to?: string;
  created: string;
}

/**
 * Everything Avero remembers about a board: reference readings from a known
 * good board, repair cases and free notes. Stored per board key.
 */
export interface BoardNotes {
  version: 1;
  key: string;
  name: string;
  notes: string;
  reference: Record<string, Reading>;
  cases: RepairCase[];
  activeCase: string | null;
  /** Photos of the real board per side, aligned to the boardview. */
  photos?: Partial<Record<PhotoSide, BoardPhoto>>;
  /** Own net names: name in the file -> name to show (Net10 -> GND). */
  netNames?: Record<string, string>;
  /** Notes pinned to spots on the board. */
  markers?: BoardMarker[];
  /** Lines, areas and jumpers drawn on the board. */
  drawings?: Drawing[];
  /** OpenBoardData board (its ID, e.g. 820-00165) chosen for this board by hand. */
  obdata?: string;
  /** Conditions new reference readings are taken under. */
  referenceConditions?: Conditions;
  /** Lists of points to measure, worked through one after the other. */
  lists?: MeasureList[];
  /** The list being worked through. */
  activeList?: string;
  updated: string;
}

/** One point of a measurement list. */
export interface ListItem {
  net: string;
  quantity: Quantity;
  label?: string;
}

/** Points to measure in order, e.g. all rails around the charger. */
export interface MeasureList {
  id: string;
  title: string;
  items: ListItem[];
}

/** Where a reading goes: the reference or a repair case. */
export type Target = "reference" | { caseId: string };

/** Board number in a file name (`820-02100`, `nm-b481`), as in the Rust library code. */
export function idTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 5 && /\d/.test(t));
}

/**
 * Key under which notes for a board are stored. Files of the same board in
 * different formats share it through the board number.
 */
export function boardKey(source: { name: string; path?: string }): string {
  if (!source.path) return source.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const parts = source.path.split("/");
  const file = parts.pop() ?? "";
  const stem = file.replace(/\.[^.]+$/, "");
  const token = idTokens(stem)[0] ?? idTokens(parts.pop() ?? "")[0];
  return token ?? stem.toLowerCase();
}

export function emptyNotes(key: string, name: string): BoardNotes {
  return { version: 1, key, name, notes: "", reference: {}, cases: [], activeCase: null, updated: new Date(0).toISOString() };
}

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function addCase(notes: BoardNotes, title: string): BoardNotes {
  const c: RepairCase = { id: newId(), title, created: now(), notes: "", readings: {} };
  return { ...notes, cases: [...notes.cases, c], activeCase: c.id, updated: now() };
}

export function updateCase(notes: BoardNotes, id: string, change: CaseFields): BoardNotes {
  return { ...notes, cases: notes.cases.map((c) => (c.id === id ? { ...c, ...change } : c)), updated: now() };
}

export function removeCase(notes: BoardNotes, id: string): BoardNotes {
  const cases = notes.cases.filter((c) => c.id !== id);
  return { ...notes, cases, activeCase: notes.activeCase === id ? (cases.at(-1)?.id ?? null) : notes.activeCase, updated: now() };
}

/**
 * Takes a case's readings as reference, e.g. once the board works again or
 * when it is a known good board. Values of the case win per quantity.
 */
export function caseToReference(notes: BoardNotes, id: string): BoardNotes {
  const c = notes.cases.find((x) => x.id === id);
  if (!c) return notes;
  const reference = { ...notes.reference };
  for (const [net, r] of Object.entries(c.readings)) {
    if (!hasValues(r)) continue;
    const merged: Reading = { ...reference[net] };
    for (const q of QUANTITIES) if (r[q] !== undefined) merged[q] = r[q];
    merged.updated = now();
    reference[net] = merged;
  }
  return { ...notes, reference, updated: now() };
}

export function activeCase(notes: BoardNotes): RepairCase | undefined {
  return notes.cases.find((c) => c.id === notes.activeCase);
}

export function readingsFor(notes: BoardNotes, target: Target): Record<string, Reading> {
  if (target === "reference") return notes.reference;
  return notes.cases.find((c) => c.id === target.caseId)?.readings ?? {};
}

/** Conditions new readings of a target are taken under. */
export function conditionsOf(notes: BoardNotes, target: Target): Conditions | undefined {
  if (target === "reference") return notes.referenceConditions;
  return notes.cases.find((c) => c.id === target.caseId)?.conditions;
}

export function setConditions(notes: BoardNotes, target: Target, conditions: Conditions): BoardNotes {
  const clean = Object.fromEntries(Object.entries(conditions).filter(([, v]) => v !== undefined && v !== "")) as Conditions;
  const value = Object.keys(clean).length ? clean : undefined;
  if (target === "reference") return { ...notes, referenceConditions: value, updated: now() };
  return { ...notes, cases: notes.cases.map((c) => (c.id === target.caseId ? { ...c, conditions: value } : c)), updated: now() };
}

function withReading(
  readings: Record<string, Reading>,
  net: string,
  change: Partial<Reading>,
  conditions?: Conditions,
): Record<string, Reading> {
  const old = readings[net];
  const valuesChange = QUANTITIES.some((q) => q in change && change[q] !== old?.[q]);
  // The values being replaced go to the history, so before and after a repair stay visible.
  let history = old?.history;
  if (valuesChange && old && hasValues(old)) {
    const entry: HistoryEntry = { at: old.updated ?? now() };
    for (const q of QUANTITIES) if (old[q] !== undefined) entry[q] = old[q];
    if (old.cond) entry.cond = old.cond;
    history = [...(old.history ?? []), entry].slice(-HISTORY_MAX);
  }
  // An explicit timestamp (from an import) wins over "now".
  const next: Reading = {
    ...old,
    updated: now(),
    ...(valuesChange && { cond: conditions }),
    ...(history && { history }),
    ...change,
  };
  if (next.cond === undefined) delete next.cond;
  for (const key of Object.keys(change) as (keyof Reading)[]) {
    if (change[key] === undefined) delete next[key];
  }
  const out = { ...readings };
  if (hasValues(next) || next.note) out[net] = next;
  else delete out[net];
  return out;
}

/** Sets (or clears, with `undefined`) one quantity for a net. */
export function setValue(notes: BoardNotes, target: Target, net: string, q: Quantity, value: Value | undefined): BoardNotes {
  return setReading(notes, target, net, { [q]: value });
}

export function setReading(notes: BoardNotes, target: Target, net: string, change: Partial<Reading>): BoardNotes {
  const conditions = conditionsOf(notes, target);
  if (target === "reference") return { ...notes, reference: withReading(notes.reference, net, change, conditions), updated: now() };
  return {
    ...notes,
    cases: notes.cases.map((c) => (c.id === target.caseId ? { ...c, readings: withReading(c.readings, net, change, conditions) } : c)),
    updated: now(),
  };
}

/** "mismatch": measured, but under other conditions than the reference. */
export type NetStatus = Comparison | "mismatch" | "measured" | "reference";

// --- measurement lists -------------------------------------------------------

export function addList(notes: BoardNotes, title: string, items: ListItem[] = []): BoardNotes {
  const list: MeasureList = { id: newId(), title, items: dedupeItems(items) };
  return { ...notes, lists: [...(notes.lists ?? []), list], updated: now() };
}

function dedupeItems(items: ListItem[]): ListItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.net}|${i.quantity}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function updateList(notes: BoardNotes, id: string, change: (list: MeasureList) => MeasureList): BoardNotes {
  return {
    ...notes,
    lists: (notes.lists ?? []).map((l) => {
      if (l.id !== id) return l;
      const next = change(l);
      return { ...next, items: dedupeItems(next.items) };
    }),
    updated: now(),
  };
}

export function removeList(notes: BoardNotes, id: string): BoardNotes {
  return { ...notes, lists: (notes.lists ?? []).filter((l) => l.id !== id), updated: now() };
}

/** Items of a list measured in the active case (or the reference without one). */
export function listProgress(notes: BoardNotes, list: MeasureList): { done: boolean[]; count: number } {
  const readings = activeCase(notes)?.readings ?? notes.reference;
  const done = list.items.map((i) => readings[i.net]?.[i.quantity] !== undefined);
  return { done, count: done.filter(Boolean).length };
}

/**
 * State of each measured net for the active case: compared with the
 * reference where both exist, otherwise just "measured" (case only) or
 * "reference" (reference only).
 */
export function netStatuses(notes: BoardNotes, tolerance: number): Map<string, NetStatus> {
  const out = new Map<string, NetStatus>();
  const current = activeCase(notes)?.readings ?? {};
  for (const [net, r] of Object.entries(notes.reference)) if (hasValues(r)) out.set(net, "reference");
  for (const [net, r] of Object.entries(current)) {
    if (!hasValues(r)) continue;
    out.set(net, compareReadings(notes.reference[net], r, tolerance) ?? "measured");
  }
  return out;
}

/** Validates stored or imported JSON. */
function parsePhotos(value: unknown): BoardNotes["photos"] {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const top = parsePhoto(v.top);
  const bottom = parsePhoto(v.bottom);
  return top || bottom ? { ...(top && { top }), ...(bottom && { bottom }) } : undefined;
}

/**
 * Gives a net its own name (or the file name back, when `to` is empty or
 * equal to it). Readings move along, so nothing measured gets lost.
 */
export function renameNet(notes: BoardNotes, fileName: string, current: string, to: string): BoardNotes {
  const target = to.trim() || fileName;
  if (target === current) return notes;
  const move = (readings: Record<string, Reading>) => {
    if (!(current in readings)) return readings;
    const { [current]: moved, ...rest } = readings;
    return { ...rest, [target]: { ...rest[target], ...moved } };
  };
  const netNames = { ...notes.netNames };
  if (target === fileName) delete netNames[fileName];
  else netNames[fileName] = target;
  return {
    ...notes,
    netNames,
    reference: move(notes.reference),
    cases: notes.cases.map((c) => ({ ...c, readings: move(c.readings) })),
    updated: now(),
  };
}

/** Id for a new marker; made outside state updates so it stays the same. */
export const newMarkerId = newId;

export function addMarker(notes: BoardNotes, marker: Omit<BoardMarker, "created">): BoardNotes {
  if (notes.markers?.some((m) => m.id === marker.id)) return notes;
  return { ...notes, markers: [...(notes.markers ?? []), { ...marker, created: now() }], updated: now() };
}

export function updateMarker(notes: BoardNotes, id: string, text: string): BoardNotes {
  return { ...notes, markers: (notes.markers ?? []).map((m) => (m.id === id ? { ...m, text } : m)), updated: now() };
}

export function addDrawing(notes: BoardNotes, drawing: Omit<Drawing, "id" | "created">): BoardNotes {
  const d: Drawing = { ...drawing, id: newId(), created: now() };
  return { ...notes, drawings: [...(notes.drawings ?? []), d], updated: now() };
}

export function updateDrawing(notes: BoardNotes, id: string, text: string): BoardNotes {
  return { ...notes, drawings: (notes.drawings ?? []).map((d) => (d.id === id ? { ...d, text: text || undefined } : d)), updated: now() };
}

export function removeDrawing(notes: BoardNotes, id: string): BoardNotes {
  return { ...notes, drawings: (notes.drawings ?? []).filter((d) => d.id !== id), updated: now() };
}

function parseDrawings(value: unknown): Drawing[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.flatMap((d): Drawing[] => {
    if (!d || typeof d.id !== "string" || !["line", "area", "jumper"].includes(d.kind) || (d.side !== "top" && d.side !== "bottom")) return [];
    const points = Array.isArray(d.points) ? d.points.filter((p: { x: unknown; y: unknown }) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
    if (points.length < (d.kind === "area" ? 3 : 2)) return [];
    return [
      {
        id: d.id,
        kind: d.kind,
        side: d.side,
        points: points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })),
        ...(typeof d.text === "string" && d.text && { text: d.text }),
        ...(typeof d.from === "string" && { from: d.from }),
        ...(typeof d.to === "string" && { to: d.to }),
        created: typeof d.created === "string" ? d.created : new Date(0).toISOString(),
      },
    ];
  });
  return out.length ? out : undefined;
}

export function removeMarker(notes: BoardNotes, id: string): BoardNotes {
  return { ...notes, markers: (notes.markers ?? []).filter((m) => m.id !== id), updated: now() };
}

function parseMarkers(value: unknown): BoardMarker[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (m): m is BoardMarker =>
      !!m &&
      typeof m.id === "string" &&
      Number.isFinite(m.x) &&
      Number.isFinite(m.y) &&
      (m.side === "top" || m.side === "bottom") &&
      typeof m.text === "string",
  );
  return out.length ? out.map((m) => ({ ...m, created: typeof m.created === "string" ? m.created : new Date(0).toISOString() })) : undefined;
}

function parseNetNames(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  return Object.keys(out).length ? out : undefined;
}

/** Sets or (with `undefined`) removes the photo of one side. */
export function setPhoto(notes: BoardNotes, side: PhotoSide, photo: BoardPhoto | undefined): BoardNotes {
  const photos = { ...notes.photos };
  if (photo) photos[side] = photo;
  else delete photos[side];
  return { ...notes, photos, updated: now() };
}

/** Uses an OpenBoardData board for this board; null goes back to matching by board number. */
export function linkObdata(notes: BoardNotes, id: string | null): BoardNotes {
  return { ...notes, obdata: id ?? undefined, updated: now() };
}

function parseConditions(value: unknown): Conditions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const out: Conditions = {};
  if (typeof v.revision === "string" && v.revision) out.revision = v.revision;
  if (v.power === "off" || v.power === "standby" || v.power === "on") out.power = v.power;
  if (typeof v.battery === "boolean") out.battery = v.battery;
  if (v.polarity === "red-gnd" || v.polarity === "black-gnd") out.polarity = v.polarity;
  if (typeof v.meter === "string" && v.meter) out.meter = v.meter;
  return Object.keys(out).length ? out : undefined;
}

function parseLists(value: unknown): MeasureList[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lists = value
    .filter((l): l is MeasureList => !!l && typeof l.id === "string" && typeof l.title === "string" && Array.isArray(l.items))
    .map((l) => ({
      id: l.id,
      title: l.title,
      items: l.items.filter(
        (i): i is ListItem => !!i && typeof i.net === "string" && (QUANTITIES as string[]).includes(i.quantity as string),
      ),
    }));
  return lists.length ? lists : undefined;
}

export function parseNotes(json: string): BoardNotes | null {
  try {
    const d = JSON.parse(json) as Partial<BoardNotes>;
    if (d.version !== 1 || typeof d.key !== "string" || typeof d.reference !== "object" || !Array.isArray(d.cases)) return null;
    return {
      version: 1,
      key: d.key,
      name: typeof d.name === "string" ? d.name : d.key,
      notes: typeof d.notes === "string" ? d.notes : "",
      reference: d.reference ?? {},
      cases: d.cases
        .filter((c): c is RepairCase => !!c && typeof c.id === "string" && typeof c.readings === "object")
        .map((c) => ({
          ...c,
          photos: Array.isArray(c.photos) ? c.photos.filter((p) => typeof p === "string") : undefined,
          conditions: parseConditions(c.conditions),
        })),
      activeCase: typeof d.activeCase === "string" ? d.activeCase : null,
      photos: parsePhotos(d.photos),
      netNames: parseNetNames(d.netNames),
      markers: parseMarkers(d.markers),
      drawings: parseDrawings(d.drawings),
      obdata: typeof d.obdata === "string" && d.obdata ? d.obdata : undefined,
      referenceConditions: parseConditions(d.referenceConditions),
      lists: parseLists(d.lists),
      activeList: typeof d.activeList === "string" ? d.activeList : undefined,
      updated: typeof d.updated === "string" ? d.updated : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function mergeReadings(a: Record<string, Reading>, b: Record<string, Reading>): Record<string, Reading> {
  const out = { ...a };
  for (const [net, r] of Object.entries(b)) {
    const mine = out[net];
    if (!mine || (r.updated ?? "") > (mine.updated ?? "")) out[net] = r;
  }
  return out;
}

function mergeById<T extends { id: string }>(mine: T[] | undefined, theirs: T[] | undefined): T[] | undefined {
  if (!mine && !theirs) return undefined;
  const ids = new Set((mine ?? []).map((x) => x.id));
  return [...(mine ?? []), ...(theirs ?? []).filter((x) => !ids.has(x.id))];
}

function mergeLists(mine: MeasureList[] | undefined, theirs: MeasureList[] | undefined): MeasureList[] | undefined {
  if (!mine && !theirs) return undefined;
  const ids = new Set((mine ?? []).map((l) => l.id));
  return [...(mine ?? []), ...(theirs ?? []).filter((l) => !ids.has(l.id))];
}

function mergeMarkers(mine: BoardMarker[] | undefined, theirs: BoardMarker[] | undefined): BoardMarker[] | undefined {
  if (!mine && !theirs) return undefined;
  const ids = new Set((mine ?? []).map((m) => m.id));
  return [...(mine ?? []), ...(theirs ?? []).filter((m) => !ids.has(m.id))];
}

/**
 * Merges an import (e.g. reference values from a colleague) into existing
 * notes: newer readings win, cases are matched by id, notes are appended.
 */
export function mergeNotes(mine: BoardNotes, theirs: BoardNotes): BoardNotes {
  const cases = [...mine.cases];
  for (const c of theirs.cases) {
    const i = cases.findIndex((x) => x.id === c.id);
    if (i < 0) cases.push(c);
    else {
      const photos = [...new Set([...(cases[i].photos ?? []), ...(c.photos ?? [])])];
      cases[i] = { ...c, ...cases[i], readings: mergeReadings(cases[i].readings, c.readings), photos: photos.length ? photos : undefined };
    }
  }
  const notes = theirs.notes && !mine.notes.includes(theirs.notes) ? [mine.notes, theirs.notes].filter(Boolean).join("\n\n") : mine.notes;
  return {
    ...mine,
    notes,
    reference: mergeReadings(mine.reference, theirs.reference),
    netNames: theirs.netNames || mine.netNames ? { ...theirs.netNames, ...mine.netNames } : undefined,
    markers: mergeMarkers(mine.markers, theirs.markers),
    drawings: mergeById(mine.drawings, theirs.drawings),
    obdata: mine.obdata ?? theirs.obdata,
    referenceConditions: mine.referenceConditions ?? theirs.referenceConditions,
    lists: mergeLists(mine.lists, theirs.lists),
    cases,
    activeCase: mine.activeCase ?? theirs.activeCase,
    updated: now(),
  };
}
