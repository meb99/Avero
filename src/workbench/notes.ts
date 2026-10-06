import { parseDocLinks, type DocLinks } from "../schematic/mapping";
import { expectedFor, hasMoreReferences, judgeExpected, parseLimits, type Limits } from "./expected";
import { compareReadings, condOf, hasValues, HISTORY_MAX, QUANTITIES, takenAt, type Comparison, type Conditions, type HistoryEntry, type Quantity, type Reading, type Value } from "./measure";
import { parsePhoto, type BoardPhoto, type PhotoSide } from "./photo";
import type { NetKind } from "../core/types";

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
  /** Readings at single points (pin "U7000.21", test point "TP:TP12", via "VIA@1200,850"), by point. */
  points?: Record<string, Reading>;
  status?: CaseStatus;
  /** Device model, e.g. "Switch OLED HEG-001". */
  device?: string;
  serial?: string;
  customer?: string;
  /** Stored photo files (copied into Avero's data folder). */
  photos?: string[];
  /** Conditions new readings of this case are taken under. */
  conditions?: Conditions;
  /** A known good board: its readings count towards what is expected, like the reference. */
  good?: boolean;
}

/**
 * Own facts about a part, laid over the file's (never changing them): a
 * value, package, function name, a note, and where it comes from.
 */
export interface OwnPart {
  value?: string;
  package?: string;
  function?: string;
  note?: string;
  source?: string;
}

/** Own facts about a pin: a name for it (VIN, EN, PGOOD), a note, a source. */
export interface OwnPin {
  label?: string;
  note?: string;
  source?: string;
}

/** Fields of a case that are edited as a whole. */
export type CaseFields = Partial<Pick<RepairCase, "title" | "notes" | "status" | "device" | "serial" | "customer" | "photos">>;

/** A note pinned to a spot on the board, e.g. "short to ground here". */
export interface BoardMarker {
  id: string;
  /** Board position in mils (for a bound note: where its object was when it was made). */
  x: number;
  y: number;
  side: "top" | "bottom";
  text: string;
  created: string;
  /**
   * What the note belongs to: a pin or test point by its point id
   * ("U7.21", "TP:TP12"), a part ("part:U7") or a net ("net:PP3V3"). A
   * bound note goes with its object, and is listed with it.
   */
  target?: string;
  /** Photos stored with the note. */
  photos?: string[];
}

export type DrawingKind = "line" | "area" | "jumper" | "arrow" | "rect" | "circle" | "text";

/** Points each kind of drawing needs. */
export const DRAWING_POINTS: Record<DrawingKind, number> = { line: 2, area: 3, jumper: 2, arrow: 2, rect: 2, circle: 2, text: 1 };

/** Colors a drawing can have, by name. */
export const DRAWING_COLORS = ["orange", "red", "green", "blue", "yellow", "white"] as const;
export type DrawingColor = (typeof DRAWING_COLORS)[number];

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
  color?: DrawingColor;
  /** Line width: 1 thin, 2 normal, 3 thick. */
  width?: 1 | 2 | 3;
  /** Locked: not moved, changed or deleted until unlocked. */
  locked?: boolean;
  /** Drawings of one group move and lock together. */
  group?: string;
}

/** A saved place on the board: the view, the side, and what was selected. */
export interface Bookmark {
  id: string;
  name: string;
  side: "top" | "bottom";
  view: { centerX: number; centerY: number; scale: number };
  /** The selection as searchable text ("U3000", "U3000.21", "PP3V3"), so it survives a re-export of the file. */
  target?: string;
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
  /** Reference readings at single points, by point (see RepairCase.points). */
  referencePoints?: Record<string, Reading>;
  cases: RepairCase[];
  activeCase: string | null;
  /** Photos of the real board per side, aligned to the boardview. */
  photos?: Partial<Record<PhotoSide, BoardPhoto>>;
  /** Own net names: name in the file -> name to show (Net10 -> GND). */
  netNames?: Record<string, string>;
  /** Parts hidden from view (shields, parts only on ground …) and whether their pads go too. */
  hidden?: { parts: string[]; mode: "body" | "all" };
  /** Own net kinds by file net name, where the file is wrong (a signal that is ground). */
  netKinds?: Record<string, NetKind>;
  /** Places in the documents confirmed or blocked per part, and the parts' other names there. */
  docLinks?: DocLinks;
  /** The board's own origin (a connector corner, say), in board units. */
  origin?: { x: number; y: number };
  /** Limits set by hand per net or point, with their source (a datasheet, the schematic). */
  limits?: Limits;
  /** Own facts per part (upper-case name) and per pin (pin id, see pinKey), over the file's. */
  ownParts?: Record<string, OwnPart>;
  ownPins?: Record<string, OwnPin>;
  /** Notes pinned to spots on the board. */
  markers?: BoardMarker[];
  /** Lines, areas and jumpers drawn on the board. */
  drawings?: Drawing[];
  /** Saved places on the board (⌘D). */
  bookmarks?: Bookmark[];
  /** OpenBoardData board (its ID, e.g. 820-00165) chosen for this board by hand. */
  obdata?: string;
  /**
   * Readings taken over from the board file, per source (`XZZ 阻值`): a
   * fingerprint of what was taken, so the same file is not taken again
   * (values deleted here stay deleted) but a changed one is.
   */
  fileImports?: Record<string, string>;
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
  /** A single point to measure (pin "U7000.21", test point, via) instead of anywhere on the net. */
  point?: string;
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

/** How much a token looks like a board number: hyphens and many digits ("820-02100", "edm-010") over words ("playstation5"). */
function idScore(token: string): number {
  const digits = token.replace(/\D/g, "").length;
  return (token.includes("-") ? 2 : 0) + (3 * digits) / token.length;
}

function bestId(name: string): string | undefined {
  let best: string | undefined;
  let score = 0;
  for (const t of idTokens(name)) {
    const s = idScore(t);
    if (s > score) [best, score] = [t, s];
  }
  return best;
}

/** File names that say nothing about the board ("Board.brd", "pins.asc"). */
const GENERIC_STEM = /^(board|boardview|main|mainboard|motherboard|mobo|mb|pcb|bv|pins|format|nails|untitled|layout|file|top|bottom|new|test|\d{1,4})$/;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Key under which notes for a board are stored. Files of the same board in
 * different formats share it through the board number; the token that looks
 * most like one wins ("PlayStation5 EDM-010" → "edm-010", not "playstation5").
 * Generic file names take their folder along ("Trinity/Board.brd").
 */
export function boardKey(source: { name: string; path?: string }): string {
  if (!source.path) return source.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const parts = source.path.split(/[\\/]/);
  const file = parts.pop() ?? "";
  const folder = parts.pop() ?? "";
  const stem = file.replace(/\.[^.]+$/, "");
  const token = bestId(stem) ?? bestId(folder);
  if (token) return token;
  const name = stem.toLowerCase();
  return GENERIC_STEM.test(name) && slug(folder) ? `${slug(folder)}-${name}` : name;
}

/** The key Avero used up to 0.9.23 (first id token), to find notes saved under it. */
export function legacyBoardKey(source: { name: string; path?: string }): string {
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
  let reference = notes.reference;
  // Each value with the conditions and time it was taken under; the replaced reference goes to the history.
  for (const [net, r] of Object.entries(c.readings)) {
    for (const q of QUANTITIES) {
      if (r[q] === undefined) continue;
      reference = withReading(reference, net, { [q]: r[q] }, condOf(r, q), { stamp: takenAt(r, q), origin: c.title });
    }
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

const sameConditions = (a: Conditions | undefined, b: Conditions | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** Per-quantity maps without empty entries, or undefined when nothing is left. */
function tidy<T>(map: Partial<Record<Quantity, T>> | undefined): Partial<Record<Quantity, T>> | undefined {
  if (!map) return undefined;
  const out: Partial<Record<Quantity, T>> = {};
  for (const q of QUANTITIES) if (map[q] !== undefined) out[q] = map[q];
  return Object.keys(out).length ? out : undefined;
}

/**
 * One net's reading after a change. Every quantity keeps its own conditions,
 * time and origin, so a voltage taken with the board on never relabels a
 * diode value taken with it off. A value replaced by another (or by the same
 * number under other conditions) and a value cleared go to the history; the
 * entry stays while it has a value, a note or a history.
 */
function withReading(
  readings: Record<string, Reading>,
  net: string,
  change: Partial<Reading>,
  conditions?: Conditions,
  meta: { stamp?: string; origin?: string } = {},
): Record<string, Reading> {
  const old = readings[net];
  const next: Reading = { ...old };
  // Readings from before 0.9.24 share one set of conditions: give each value its own.
  if (old?.cond) {
    const conds = { ...old.conds };
    for (const q of QUANTITIES) if (old[q] !== undefined && !conds[q]) conds[q] = old.cond;
    next.conds = conds;
    delete next.cond;
  }
  const stamp = meta.stamp ?? change.updated ?? now();
  const history = [...(old?.history ?? [])];
  for (const q of QUANTITIES) {
    if (!(q in change)) continue;
    const value = change[q];
    const before = old?.[q];
    const beforeCond = condOf(old, q);
    const replaced = before !== undefined && (value === undefined || before !== value || !sameConditions(beforeCond, conditions));
    if (replaced) {
      const entry: HistoryEntry = { at: takenAt(old, q) ?? stamp, [q]: before };
      if (beforeCond) entry.cond = beforeCond;
      history.push(entry);
    }
    if (value === undefined) {
      delete next[q];
      next.conds = { ...next.conds, [q]: undefined };
      next.at = { ...next.at, [q]: undefined };
      next.origin = { ...next.origin, [q]: undefined };
      continue;
    }
    next[q] = value;
    next.conds = { ...next.conds, [q]: conditions };
    next.at = { ...next.at, [q]: stamp };
    next.origin = { ...next.origin, [q]: meta.origin };
  }
  if ("note" in change) {
    if (change.note) next.note = change.note;
    else delete next.note;
  }
  next.updated = stamp;
  next.conds = tidy(next.conds);
  next.at = tidy(next.at);
  next.origin = tidy(next.origin);
  for (const k of ["conds", "at", "origin"] as const) if (next[k] === undefined) delete next[k];
  if (history.length) next.history = history.slice(-HISTORY_MAX);
  else delete next.history;
  const out = { ...readings };
  if (hasValues(next) || next.note || next.history?.length) out[net] = next;
  else delete out[net];
  return out;
}

/** Forgets a net's earlier values (the current ones stay). */
export function clearHistory(notes: BoardNotes, target: Target, net: string): BoardNotes {
  const strip = (readings: Record<string, Reading>) => {
    const r = readings[net];
    if (!r?.history) return readings;
    const { history: _, ...rest } = r;
    const out = { ...readings };
    if (hasValues(rest) || rest.note) out[net] = rest;
    else delete out[net];
    return out;
  };
  if (target === "reference") return { ...notes, reference: strip(notes.reference), updated: now() };
  return { ...notes, cases: notes.cases.map((c) => (c.id === target.caseId ? { ...c, readings: strip(c.readings) } : c)), updated: now() };
}

// --- readings at single points ------------------------------------------------

export function pointReadingsFor(notes: BoardNotes, target: Target): Record<string, Reading> {
  if (target === "reference") return notes.referencePoints ?? {};
  return notes.cases.find((c) => c.id === target.caseId)?.points ?? {};
}

function withPoints(notes: BoardNotes, target: Target, change: (points: Record<string, Reading>) => Record<string, Reading>): BoardNotes {
  const tidyPoints = (p: Record<string, Reading>) => (Object.keys(p).length ? p : undefined);
  if (target === "reference") return { ...notes, referencePoints: tidyPoints(change(notes.referencePoints ?? {})), updated: now() };
  return {
    ...notes,
    cases: notes.cases.map((c) => (c.id === target.caseId ? { ...c, points: tidyPoints(change(c.points ?? {})) } : c)),
    updated: now(),
  };
}

/**
 * A reading at one point (a pin, test point or via) of `net`, kept apart from
 * the net's reading: two points of one net may differ (a broken trace, a bad
 * contact), each with its own conditions and history.
 */
export function setPointReading(notes: BoardNotes, target: Target, point: string, net: string, change: Partial<Reading>): BoardNotes {
  const conditions = conditionsOf(notes, target);
  return withPoints(notes, target, (points) => {
    const out = withReading(points, point, change, conditions);
    if (out[point]) out[point] = { ...out[point], net };
    return out;
  });
}

export function setPointValue(notes: BoardNotes, target: Target, point: string, net: string, q: Quantity, value: Value | undefined): BoardNotes {
  return setPointReading(notes, target, point, net, { [q]: value });
}

/** A reading the board file carries for one point. */
export interface FilePointReading {
  point: string;
  net: string;
  quantity: Quantity;
  value: Value;
}

export interface FileImport {
  notes: BoardNotes;
  /** New, changed in the file since the last time, kept (a value of one's own is there), of which differ. */
  added: number;
  updated: number;
  kept: number;
  differ: number;
  /** The same file was taken before: nothing done. */
  already: boolean;
}

/** A short fingerprint of what a file holds. */
function fingerprint(entries: readonly FilePointReading[]): string {
  let h = 0x811c9dc5;
  for (const e of entries) for (const c of `${e.point}|${e.quantity}|${e.value};`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return `${entries.length}:${(h >>> 0).toString(16)}`;
}

/**
 * Takes the readings a board file carries into the reference, each at its
 * pin and marked with where it came from (`source`). A value of one's own
 * (typed, measured, or from another source) is never replaced; a value
 * from this source is brought up to date when the file changed. The same
 * file is taken once: values deleted afterwards stay deleted.
 */
export function takeFileReadings(notes: BoardNotes, entries: readonly FilePointReading[], source: string): FileImport {
  const print = fingerprint(entries);
  const result: FileImport = { notes, added: 0, updated: 0, kept: 0, differ: 0, already: notes.fileImports?.[source] === print };
  if (result.already) return result;
  let points = notes.referencePoints ?? {};
  for (const e of entries) {
    const old = points[e.point];
    const before = old?.[e.quantity];
    if (before !== undefined && old?.origin?.[e.quantity] !== source) {
      result.kept++;
      if (before !== e.value) result.differ++;
      continue;
    }
    if (before === e.value) continue;
    if (before === undefined) result.added++;
    else result.updated++;
    // The file says nothing about the conditions, so none are claimed.
    points = withReading(points, e.point, { [e.quantity]: e.value }, undefined, { origin: source });
    points[e.point] = { ...points[e.point], net: e.net };
  }
  result.notes = { ...notes, referencePoints: points, fileImports: { ...notes.fileImports, [source]: print }, updated: now() };
  return result;
}

export function clearPointHistory(notes: BoardNotes, target: Target, point: string): BoardNotes {
  return withPoints(notes, target, (points) => {
    const r = points[point];
    if (!r?.history) return points;
    const { history: _, ...rest } = r;
    const out = { ...points };
    if (hasValues(rest) || rest.note) out[point] = rest;
    else delete out[point];
    return out;
  });
}

/** Points measured on a net, by point id. */
export function pointsOnNet(notes: BoardNotes, target: Target, net: string): [string, Reading][] {
  return Object.entries(pointReadingsFor(notes, target)).filter(([, r]) => r.net === net && hasValues(r));
}

/** Lowest and highest value of a quantity over points (OL and missing values left out), with how many there were. */
export function spread(readings: Reading[], q: Quantity): { min: number; max: number; count: number; open: number } | undefined {
  const numbers = readings.map((r) => r[q]).filter((v): v is number => typeof v === "number");
  const open = readings.filter((r) => r[q] === "OL").length;
  if (numbers.length === 0 && open === 0) return undefined;
  return { min: Math.min(...numbers), max: Math.max(...numbers), count: numbers.length, open };
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
    const k = `${i.point ?? i.net}|${i.quantity}`;
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
  const c = activeCase(notes);
  const readings = c?.readings ?? notes.reference;
  const points = (c ? c.points : notes.referencePoints) ?? {};
  // A point item is done by a reading at that point, a net item by one on the net.
  const done = list.items.map((i) => (i.point ? points[i.point]?.[i.quantity] : readings[i.net]?.[i.quantity]) !== undefined);
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
  // Several good boards or limits: judged against what they expect, per quantity.
  const pooled = hasMoreReferences(notes);
  for (const [net, r] of Object.entries(current)) {
    if (!hasValues(r)) continue;
    if (!pooled) {
      out.set(net, compareReadings(notes.reference[net], r, tolerance) ?? "measured");
      continue;
    }
    let status: NetStatus = "measured";
    for (const q of QUANTITIES) {
      const result = judgeExpected(expectedFor(notes, "", net, q, condOf(r, q)), r[q], q, tolerance);
      if (result === "deviation") status = "deviation";
      else if (result === "ok" && status !== "deviation") status = "ok";
      else if (result === "mismatch" && status === "measured") status = "mismatch";
    }
    out.set(net, status);
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
  // Points measured on the net carry its new name.
  const renamePoints = (points: Record<string, Reading> | undefined) =>
    points && Object.fromEntries(Object.entries(points).map(([k, r]) => [k, r.net === current ? { ...r, net: target } : r]));
  // Measuring lists follow the net, so their progress stays right.
  const lists = notes.lists?.map((l) => ({ ...l, items: dedupeItems(l.items.map((i) => (i.net === current ? { ...i, net: target } : i))) }));
  return {
    ...notes,
    netNames,
    reference: move(notes.reference),
    referencePoints: renamePoints(notes.referencePoints),
    cases: notes.cases.map((c) => ({ ...c, readings: move(c.readings), points: renamePoints(c.points) })),
    ...(lists && { lists }),
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
  return setDrawingFields(notes, id, { text: text || undefined });
}

/** The drawing and the others of its group. */
const groupOf = (all: Drawing[], id: string): Set<string> => {
  const d = all.find((x) => x.id === id);
  if (!d) return new Set();
  return new Set(d.group ? all.filter((x) => x.group === d.group).map((x) => x.id) : [id]);
};

/** Changes style, text, group or lock of one drawing (a locked one only by unlocking it). */
export function setDrawingFields(
  notes: BoardNotes,
  id: string,
  fields: Partial<Pick<Drawing, "text" | "color" | "width" | "group" | "locked">>,
): BoardNotes {
  const drawings = (notes.drawings ?? []).map((d) => {
    if (d.id !== id || (d.locked && fields.locked !== false)) return d;
    const next: Drawing = { ...d, ...fields };
    for (const k of Object.keys(fields) as (keyof Drawing)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    return next;
  });
  return { ...notes, drawings, updated: now() };
}

/** Locks or unlocks a drawing with its group. */
export function lockDrawing(notes: BoardNotes, id: string, locked: boolean): BoardNotes {
  const ids = groupOf(notes.drawings ?? [], id);
  return { ...notes, drawings: (notes.drawings ?? []).map((d) => (ids.has(d.id) ? { ...d, locked: locked || undefined } : d)), updated: now() };
}

/** Moves a drawing and its group by dx, dy (locked ones stay). */
export function moveDrawing(notes: BoardNotes, id: string, dx: number, dy: number): BoardNotes {
  const all = notes.drawings ?? [];
  const ids = groupOf(all, id);
  if (all.some((d) => ids.has(d.id) && d.locked)) return notes;
  return {
    ...notes,
    drawings: all.map((d) => (ids.has(d.id) ? { ...d, points: d.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : d)),
    updated: now(),
  };
}

export function removeDrawing(notes: BoardNotes, id: string): BoardNotes {
  if (notes.drawings?.find((d) => d.id === id)?.locked) return notes;
  return { ...notes, drawings: (notes.drawings ?? []).filter((d) => d.id !== id), updated: now() };
}

/** Adds or removes a photo of a note. */
export function setMarkerPhotos(notes: BoardNotes, id: string, photos: string[]): BoardNotes {
  return { ...notes, markers: (notes.markers ?? []).map((m) => (m.id === id ? { ...m, photos: photos.length ? photos : undefined } : m)), updated: now() };
}

function parseDrawings(value: unknown): Drawing[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.flatMap((d): Drawing[] => {
    if (!d || typeof d.id !== "string" || !(d.kind in DRAWING_POINTS) || (d.side !== "top" && d.side !== "bottom")) return [];
    const points = Array.isArray(d.points) ? d.points.filter((p: { x: unknown; y: unknown }) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
    if (points.length < DRAWING_POINTS[d.kind as DrawingKind]) return [];
    return [
      {
        id: d.id,
        kind: d.kind,
        side: d.side,
        points: points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })),
        ...(typeof d.text === "string" && d.text && { text: d.text }),
        ...(typeof d.from === "string" && { from: d.from }),
        ...(typeof d.to === "string" && { to: d.to }),
        ...(DRAWING_COLORS.includes(d.color) && { color: d.color }),
        ...([1, 2, 3].includes(d.width) && { width: d.width }),
        ...(d.locked === true && { locked: true }),
        ...(typeof d.group === "string" && d.group && { group: d.group }),
        created: typeof d.created === "string" ? d.created : new Date(0).toISOString(),
      },
    ];
  });
  return out.length ? out : undefined;
}

export function addBookmark(notes: BoardNotes, b: Omit<Bookmark, "id" | "created">): BoardNotes {
  return { ...notes, bookmarks: [...(notes.bookmarks ?? []), { ...b, id: newId(), created: now() }], updated: now() };
}

export function renameBookmark(notes: BoardNotes, id: string, name: string): BoardNotes {
  return { ...notes, bookmarks: (notes.bookmarks ?? []).map((b) => (b.id === id ? { ...b, name } : b)), updated: now() };
}

export function removeBookmark(notes: BoardNotes, id: string): BoardNotes {
  return { ...notes, bookmarks: (notes.bookmarks ?? []).filter((b) => b.id !== id), updated: now() };
}

function parseBookmarks(value: unknown): Bookmark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.flatMap((b): Bookmark[] => {
    const v = b?.view;
    if (!b || typeof b.id !== "string" || typeof b.name !== "string" || (b.side !== "top" && b.side !== "bottom")) return [];
    if (!v || ![v.centerX, v.centerY, v.scale].every(Number.isFinite) || v.scale <= 0) return [];
    return [
      {
        id: b.id,
        name: b.name,
        side: b.side,
        view: { centerX: v.centerX, centerY: v.centerY, scale: v.scale },
        ...(typeof b.target === "string" && b.target && { target: b.target }),
        created: typeof b.created === "string" ? b.created : new Date(0).toISOString(),
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
  return out.length
    ? out.map((m) => ({
        id: m.id,
        x: m.x,
        y: m.y,
        side: m.side,
        text: m.text,
        created: typeof m.created === "string" ? m.created : new Date(0).toISOString(),
        ...(typeof m.target === "string" && m.target && { target: m.target }),
        ...(Array.isArray(m.photos) && m.photos.some((p) => typeof p === "string") && { photos: m.photos.filter((p) => typeof p === "string") }),
      }))
    : undefined;
}

function parseHidden(value: unknown): BoardNotes["hidden"] {
  if (!isRecord(value) || !Array.isArray(value.parts)) return undefined;
  const parts = [...new Set(value.parts.filter((p): p is string => typeof p === "string" && p !== ""))];
  return parts.length ? { parts, mode: value.mode === "all" ? "all" : "body" } : undefined;
}

/** Hides parts by name (added to those hidden already). */
export function hideParts(notes: BoardNotes, names: readonly string[]): BoardNotes {
  const parts = [...new Set([...(notes.hidden?.parts ?? []), ...names])];
  return { ...notes, hidden: parts.length ? { parts, mode: notes.hidden?.mode ?? "body" } : undefined, updated: now() };
}

/** Shows parts again; without names, all of them. */
export function showParts(notes: BoardNotes, names?: readonly string[]): BoardNotes {
  const parts = names ? (notes.hidden?.parts ?? []).filter((p) => !names.includes(p)) : [];
  return { ...notes, hidden: parts.length ? { parts, mode: notes.hidden!.mode } : undefined, updated: now() };
}

export function setHideMode(notes: BoardNotes, mode: "body" | "all"): BoardNotes {
  return notes.hidden ? { ...notes, hidden: { ...notes.hidden, mode }, updated: now() } : notes;
}

function parseNetKinds(value: unknown): Record<string, NetKind> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, NetKind> = {};
  for (const [k, v] of Object.entries(value)) if (v === "signal" || v === "power" || v === "ground") out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Marks a case as a known good board (its readings then count towards what is expected), or not. */
export function setCaseGood(notes: BoardNotes, id: string, good: boolean): BoardNotes {
  return { ...notes, cases: notes.cases.map((c) => (c.id === id ? { ...c, good: good || undefined } : c)), updated: now() };
}

/** Own facts with only the string fields given, empty ones dropped. */
function parseOwn<T extends object>(value: unknown, fields: (keyof T & string)[]): Record<string, T> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!isRecord(v)) continue;
    const entry: Record<string, string> = {};
    for (const f of fields) if (typeof v[f] === "string" && (v[f] as string).trim()) entry[f] = (v[f] as string).trim();
    if (Object.keys(entry).length) out[key] = entry as T;
  }
  return Object.keys(out).length ? out : undefined;
}

const tidyOwn = <T extends object>(info: T | undefined): T | undefined => {
  if (!info) return undefined;
  const out = Object.fromEntries(Object.entries(info).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
  return Object.keys(out).length ? (out as T) : undefined;
};

/** Sets a part's own facts; `undefined` (or all empty) goes back to the file's. */
export function setOwnPart(notes: BoardNotes, part: string, info: OwnPart | undefined): BoardNotes {
  const all = { ...notes.ownParts };
  const clean = tidyOwn(info);
  if (clean) all[part.toUpperCase()] = clean;
  else delete all[part.toUpperCase()];
  return { ...notes, ownParts: Object.keys(all).length ? all : undefined, updated: now() };
}

/** Sets a pin's own facts (by pin id); `undefined` (or all empty) removes them. */
export function setOwnPin(notes: BoardNotes, pin: string, info: OwnPin | undefined): BoardNotes {
  const all = { ...notes.ownPins };
  const clean = tidyOwn(info);
  if (clean) all[pin] = clean;
  else delete all[pin];
  return { ...notes, ownPins: Object.keys(all).length ? all : undefined, updated: now() };
}

/** Sets (or, with `undefined`, removes) the board's own origin. */
export function setOrigin(notes: BoardNotes, origin: { x: number; y: number } | undefined): BoardNotes {
  return { ...notes, origin, updated: now() };
}

/** Changes the corrections of document matches. */
export function updateDocLinks(notes: BoardNotes, change: (all: DocLinks | undefined) => DocLinks | undefined): BoardNotes {
  return { ...notes, docLinks: change(notes.docLinks), updated: now() };
}

/** Corrects (or, with `undefined`, resets) the kind of a net. */
export function setNetKind(notes: BoardNotes, fileName: string, kind: NetKind | undefined): BoardNotes {
  const netKinds = { ...notes.netKinds };
  if (kind) netKinds[fileName] = kind;
  else delete netKinds[fileName];
  return { ...notes, netKinds: Object.keys(netKinds).length ? netKinds : undefined, updated: now() };
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

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseValue(v: unknown): Value | undefined {
  if (v === "OL") return "OL";
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function perQuantity<T>(v: unknown, item: (x: unknown) => T | undefined): Partial<Record<Quantity, T>> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Partial<Record<Quantity, T>> = {};
  for (const q of QUANTITIES) {
    const x = item(v[q]);
    if (x !== undefined) out[q] = x;
  }
  return Object.keys(out).length ? out : undefined;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** A reading as stored, with every field checked; null when nothing usable is left. */
export function parseReading(value: unknown): Reading | null {
  if (!isRecord(value)) return null;
  const r: Reading = {};
  for (const q of QUANTITIES) {
    const v = parseValue(value[q]);
    if (v !== undefined) r[q] = v;
  }
  if (str(value.note)) r.note = value.note as string;
  if (str(value.updated)) r.updated = value.updated as string;
  const cond = parseConditions(value.cond);
  if (cond) r.cond = cond;
  const conds = perQuantity(value.conds, parseConditions);
  if (conds) r.conds = conds;
  const at = perQuantity(value.at, str);
  if (at) r.at = at;
  const origin = perQuantity(value.origin, str);
  if (origin) r.origin = origin;
  if (str(value.net)) r.net = value.net as string;
  if (Array.isArray(value.history)) {
    const history = value.history.flatMap((h): HistoryEntry[] => {
      if (!isRecord(h) || !str(h.at)) return [];
      const e: HistoryEntry = { at: h.at as string };
      for (const q of QUANTITIES) {
        const v = parseValue(h[q]);
        if (v !== undefined) e[q] = v;
      }
      const c = parseConditions(h.cond);
      if (c) e.cond = c;
      return QUANTITIES.some((q) => e[q] !== undefined) ? [e] : [];
    });
    if (history.length) r.history = history.slice(-HISTORY_MAX);
  }
  return hasValues(r) || r.note || r.history ? r : null;
}

/** Readings by net name; anything that is not a reading is left out. */
export function parseReadings(value: unknown): Record<string, Reading> {
  const out: Record<string, Reading> = {};
  if (!isRecord(value)) return out;
  for (const [net, v] of Object.entries(value)) {
    const r = parseReading(v);
    if (r && net) out[net] = r;
  }
  return out;
}

function optionalReadings(value: unknown): Record<string, Reading> | undefined {
  const r = parseReadings(value);
  return Object.keys(r).length ? r : undefined;
}

function parseCase(value: unknown): RepairCase | null {
  if (!isRecord(value) || !str(value.id) || !isRecord(value.readings)) return null;
  const c = value as unknown as RepairCase;
  return {
    ...c,
    title: typeof c.title === "string" ? c.title : "",
    created: typeof c.created === "string" ? c.created : new Date(0).toISOString(),
    notes: typeof c.notes === "string" ? c.notes : "",
    readings: parseReadings(value.readings),
    points: optionalReadings(value.points),
    photos: Array.isArray(c.photos) ? c.photos.filter((p) => typeof p === "string") : undefined,
    conditions: parseConditions(c.conditions),
    ...(c.good === true && { good: true }),
  };
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
  if (v.assembly === "complete" || v.assembly === "ic-removed" || v.assembly === "parts-removed") out.assembly = v.assembly;
  if (typeof v.removed === "string" && v.removed) out.removed = v.removed;
  if (typeof v.temperature === "number" && Number.isFinite(v.temperature)) out.temperature = v.temperature;
  if (typeof v.modules === "string" && v.modules) out.modules = v.modules;
  if (typeof v.range === "string" && v.range) out.range = v.range;
  if (typeof v.leadsNulled === "boolean") out.leadsNulled = v.leadsNulled;
  return Object.keys(out).length ? out : undefined;
}

function parseLists(value: unknown): MeasureList[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lists = value
    .filter((l): l is MeasureList => !!l && typeof l.id === "string" && typeof l.title === "string" && Array.isArray(l.items))
    .map((l) => ({
      id: l.id,
      title: l.title,
      items: l.items
        .filter((i): i is ListItem => !!i && typeof i.net === "string" && (QUANTITIES as string[]).includes(i.quantity as string))
        .map((i) => ({
          net: i.net,
          quantity: i.quantity,
          ...(typeof i.label === "string" && i.label && { label: i.label }),
          ...(typeof i.point === "string" && i.point && { point: i.point }),
        })),
    }));
  return lists.length ? lists : undefined;
}

export function parseNotes(json: string): BoardNotes | null {
  try {
    const d = JSON.parse(json) as Partial<BoardNotes>;
    if (!isRecord(d) || d.version !== 1 || typeof d.key !== "string" || !isRecord(d.reference) || !Array.isArray(d.cases)) return null;
    return {
      version: 1,
      key: d.key,
      name: typeof d.name === "string" ? d.name : d.key,
      notes: typeof d.notes === "string" ? d.notes : "",
      reference: parseReadings(d.reference),
      referencePoints: optionalReadings(d.referencePoints),
      cases: d.cases.map(parseCase).filter((c): c is RepairCase => c !== null),
      activeCase: typeof d.activeCase === "string" ? d.activeCase : null,
      photos: parsePhotos(d.photos),
      netNames: parseNetNames(d.netNames),
      netKinds: parseNetKinds(d.netKinds),
      docLinks: parseDocLinks(d.docLinks),
      limits: parseLimits(d.limits),
      ownParts: parseOwn(d.ownParts, ["value", "package", "function", "note", "source"]),
      ownPins: parseOwn(d.ownPins, ["label", "note", "source"]),
      origin: isRecord(d.origin) && Number.isFinite(d.origin.x) && Number.isFinite(d.origin.y) ? { x: Number(d.origin.x), y: Number(d.origin.y) } : undefined,
      hidden: parseHidden(d.hidden),
      markers: parseMarkers(d.markers),
      drawings: parseDrawings(d.drawings),
      bookmarks: parseBookmarks(d.bookmarks),
      obdata: typeof d.obdata === "string" && d.obdata ? d.obdata : undefined,
      fileImports: isRecord(d.fileImports)
        ? Object.fromEntries(Object.entries(d.fileImports).filter((e): e is [string, string] => typeof e[1] === "string"))
        : undefined,
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
      const points = mergeReadings(cases[i].points ?? {}, c.points ?? {});
      cases[i] = {
        ...c,
        ...cases[i],
        readings: mergeReadings(cases[i].readings, c.readings),
        points: Object.keys(points).length ? points : undefined,
        photos: photos.length ? photos : undefined,
      };
    }
  }
  const notes = theirs.notes && !mine.notes.includes(theirs.notes) ? [mine.notes, theirs.notes].filter(Boolean).join("\n\n") : mine.notes;
  return {
    ...mine,
    notes,
    reference: mergeReadings(mine.reference, theirs.reference),
    referencePoints:
      mine.referencePoints || theirs.referencePoints ? mergeReadings(mine.referencePoints ?? {}, theirs.referencePoints ?? {}) : undefined,
    netNames: theirs.netNames || mine.netNames ? { ...theirs.netNames, ...mine.netNames } : undefined,
    netKinds: theirs.netKinds || mine.netKinds ? { ...theirs.netKinds, ...mine.netKinds } : undefined,
    docLinks: theirs.docLinks || mine.docLinks ? { ...theirs.docLinks, ...mine.docLinks } : undefined,
    origin: mine.origin ?? theirs.origin,
    limits: theirs.limits || mine.limits ? { ...theirs.limits, ...mine.limits } : undefined,
    ownParts: theirs.ownParts || mine.ownParts ? { ...theirs.ownParts, ...mine.ownParts } : undefined,
    ownPins: theirs.ownPins || mine.ownPins ? { ...theirs.ownPins, ...mine.ownPins } : undefined,
    hidden: mine.hidden ?? theirs.hidden,
    markers: mergeMarkers(mine.markers, theirs.markers),
    drawings: mergeById(mine.drawings, theirs.drawings),
    bookmarks: mergeById(mine.bookmarks, theirs.bookmarks),
    obdata: mine.obdata ?? theirs.obdata,
    ...((mine.fileImports || theirs.fileImports) && { fileImports: { ...theirs.fileImports, ...mine.fileImports } }),
    referenceConditions: mine.referenceConditions ?? theirs.referenceConditions,
    lists: mergeLists(mine.lists, theirs.lists),
    cases,
    activeCase: mine.activeCase ?? theirs.activeCase,
    updated: now(),
  };
}
