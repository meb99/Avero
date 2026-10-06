/**
 * Multimeter readings: parsing what people type, formatting for display and
 * comparing against reference values.
 */

export type Quantity = "diode" | "voltage" | "resistance";
export const QUANTITIES: Quantity[] = ["diode", "voltage", "resistance"];

/** A reading in base units (volts, ohms), or "OL" for an open/overload reading. */
export type Value = number | "OL";

/**
 * How a reading was taken. Readings are only compared when their conditions
 * fit: a diode value with the red probe on ground is not comparable with one
 * taken the other way round, a voltage with the board on not with one off.
 */
export interface Conditions {
  /** Board revision, e.g. "Rev 2.0". */
  revision?: string;
  power?: "off" | "standby" | "on";
  /** Battery connected. */
  battery?: boolean;
  /** Diode mode: the probe on ground (red on ground gives the usual positive "diode readings"). */
  polarity?: "red-gnd" | "black-gnd";
  /** Meter used, e.g. "Owon XDM1241". */
  meter?: string;
  /** What is fitted: all of it, or with an IC or other parts taken off. */
  assembly?: "complete" | "ic-removed" | "parts-removed";
  /** Which parts were taken off, e.g. "U7000". */
  removed?: string;
  /** Board temperature in °C (diode readings move about 2 mV per degree). */
  temperature?: number;
  /** Modules, cables or boards connected, e.g. "display, keyboard off". */
  modules?: string;
  /** Meter range, e.g. "auto", "2 V", "200 Ω". */
  range?: string;
  /** Test leads nulled (relative mode) before low resistance readings. */
  leadsNulled?: boolean;
}

/** Degrees apart beyond which diode and resistance readings are not compared. */
const TEMPERATURE_SPAN = 15;

const norm = (s: string | undefined) => (s ?? "").toUpperCase().replace(/[\s,;]+/g, " ").trim();
/** Parts named in a free text, sorted ("U7000, u7001" = "U7001 U7000"). */
const partSet = (s: string | undefined) => [...new Set(norm(s).split(" ").filter(Boolean))].sort().join(" ");

/** An earlier value of a reading, kept when it changed. */
export interface HistoryEntry {
  at: string;
  diode?: Value;
  voltage?: Value;
  resistance?: Value;
  cond?: Conditions;
}

export interface Reading {
  diode?: Value;
  voltage?: Value;
  resistance?: Value;
  note?: string;
  /** ISO timestamp of the last change. */
  updated?: string;
  /** Conditions each current value was taken under. */
  conds?: Partial<Record<Quantity, Conditions>>;
  /** When each current value was taken. */
  at?: Partial<Record<Quantity, string>>;
  /** Where a value came from when it was not typed here ("Fall: Lenovo 1"). */
  origin?: Partial<Record<Quantity, string>>;
  /** For a reading at one point (a pin, test point or via): the net it was on when measured. */
  net?: string;
  /** Conditions of all values, as files before 0.9.24 stored them; read through `condOf`. */
  cond?: Conditions;
  /** Earlier values, oldest first. */
  history?: HistoryEntry[];
}

/** The conditions a reading's value of `q` was taken under. */
export function condOf(r: Reading | undefined, q: Quantity): Conditions | undefined {
  return r?.conds?.[q] ?? r?.cond;
}

/** When a reading's value of `q` was taken. */
export function takenAt(r: Reading | undefined, q: Quantity): string | undefined {
  return r?.at?.[q] ?? r?.updated;
}

/** Most earlier values kept per reading. */
export const HISTORY_MAX = 50;

export type Comparison = "ok" | "deviation";

const OPEN_WORDS = new Set(["OL", "O.L", "O.L.", "OPEN", "OFFEN", "∞", "INF", "OVERLOAD", "1"]);

const PREFIX: Record<string, number> = { "": 1, m: 1e-3, u: 1e-6, "µ": 1e-6, k: 1e3, K: 1e3, M: 1e6 };

/**
 * Parses a typed reading. Returns `undefined` for an empty field (clears the
 * value) and `null` for input that makes no sense.
 *
 * Accepts `0,452`, `0.452`, `452mV`, `3.3V`, `4.7k`, `4k7`, `2R2`, `1.2MΩ`,
 * `OL`. A bare diode reading above 3 is taken as millivolts (`452`), which is
 * how many meters show it.
 */
export function parseValue(input: string, q: Quantity): Value | undefined | null {
  const raw = input.trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase().replace(/\s+/g, "");
  // A lone "1" is how older meters display overload; only accept it for diode mode.
  if (OPEN_WORDS.has(upper) && (upper !== "1" || q === "diode")) return "OL";
  if (/^(SHORT|KURZ|KURZSCHLUSS)$/.test(upper)) return 0;

  const compact = raw.replace(/\s+/g, "").replace(",", ".");
  // A unit typed out ("4V", "452mV", "10Ω") is taken as given; only bare numbers are guessed.
  const unitGiven = /(ohm|Ω|ω|V)$/i.test(compact);
  const s = compact.replace(/(ohm|Ω|ω)$/i, "").replace(/V$/i, "");

  // Resistor code notation: 4k7, 2R2, 1M5.
  const code = /^(\d+)([RkKM])(\d+)$/.exec(s);
  if (code && q === "resistance") {
    const mult = code[2] === "R" ? 1 : PREFIX[code[2]];
    return Number(`${code[1]}.${code[3]}`) * mult;
  }

  const m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([mMuµkKR]?)$/i.exec(s);
  if (!m) return null;
  let value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  let unit = m[2];
  if (unit === "R") unit = "";
  // "m" is milli; "M" is mega (only meaningful for resistance).
  if (unit === "M" && q !== "resistance") return null;
  value *= PREFIX[unit] ?? 1;
  if (q === "diode" && unit === "" && !unitGiven && Math.abs(value) > 3) value /= 1000;
  return value;
}

/** Formats a value for display in the given language. */
export function formatValue(value: Value | undefined, q: Quantity, lang = "en"): string {
  if (value === undefined) return "";
  if (value === "OL") return "OL";
  const num = (v: number, digits: number) =>
    new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  if (q === "resistance") {
    const a = Math.abs(value);
    if (a >= 1e6) return `${num(value / 1e6, 2)} MΩ`;
    if (a >= 1e3) return `${num(value / 1e3, 2)} kΩ`;
    return `${num(value, a < 10 ? 2 : 1)} Ω`;
  }
  if (q === "voltage" && Math.abs(value) >= 1) return `${num(value, 2)} V`;
  return `${num(value, 3)} V`;
}

/** Smallest difference that counts as a deviation, whatever the tolerance. */
const FLOOR: Record<Quantity, number> = { diode: 0.015, voltage: 0.05, resistance: 2 };

/**
 * Compares a measurement with the reference. `tolerance` is relative
 * (0.1 = 10 %). Returns undefined when either side is missing.
 */
export function compare(reference: Value | undefined, measured: Value | undefined, q: Quantity, tolerance: number): Comparison | undefined {
  if (reference === undefined || measured === undefined) return undefined;
  if (reference === "OL" || measured === "OL") return reference === measured ? "ok" : "deviation";
  const allowed = Math.max(Math.abs(reference) * tolerance, FLOOR[q]);
  return Math.abs(measured - reference) <= allowed ? "ok" : "deviation";
}

/**
 * Whether two readings of quantity `q` were taken under fitting conditions.
 * Unknown conditions fit anything; only conditions stated on both sides and
 * different rule a comparison out.
 */
export function conditionsFit(a: Conditions | undefined, b: Conditions | undefined, q: Quantity): boolean {
  if (!a && !b) return true;
  a ??= {};
  b ??= {};
  const differ = <K extends keyof Conditions>(k: K) => a[k] !== undefined && b[k] !== undefined && a[k] !== b[k];
  if (differ("revision")) return false;
  // Parts taken off change what a net sees: such a reading only compares with one taken the same way.
  // (Unknown stays unknown: it is not taken as "complete", but it is not "removed" either.)
  const offA = a.assembly === "ic-removed" || a.assembly === "parts-removed";
  const offB = b.assembly === "ic-removed" || b.assembly === "parts-removed";
  if (offA !== offB) return false;
  if (offA && offB && a.removed && b.removed && partSet(a.removed) !== partSet(b.removed)) return false;
  if (a.modules !== undefined && b.modules !== undefined && norm(a.modules) !== norm(b.modules)) return false;
  if (q !== "voltage" && a.temperature !== undefined && b.temperature !== undefined && Math.abs(a.temperature - b.temperature) > TEMPERATURE_SPAN) return false;
  if (q === "voltage") return !differ("power") && !differ("battery");
  // Diode and resistance readings: probe direction, and the board off (or not) on both sides.
  return !differ("polarity") && !differ("power");
}

/**
 * Worst comparison over all quantities of two readings; "mismatch" when the
 * readings exist but were taken under conditions that do not fit.
 */
export function compareReadings(
  reference: Reading | undefined,
  measured: Reading | undefined,
  tolerance: number,
): Comparison | "mismatch" | undefined {
  let result: Comparison | "mismatch" | undefined;
  for (const q of QUANTITIES) {
    if (reference?.[q] === undefined || measured?.[q] === undefined) continue;
    if (!conditionsFit(condOf(reference, q), condOf(measured, q), q)) {
      result ??= "mismatch";
      continue;
    }
    const c = compare(reference[q], measured[q], q, tolerance);
    if (c === "deviation") return "deviation";
    if (c === "ok") result = "ok";
  }
  return result;
}

export function hasValues(r: Reading | undefined): boolean {
  return !!r && QUANTITIES.some((q) => r[q] !== undefined);
}
