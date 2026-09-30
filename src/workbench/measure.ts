/**
 * Multimeter readings: parsing what people type, formatting for display and
 * comparing against reference values.
 */

export type Quantity = "diode" | "voltage" | "resistance";
export const QUANTITIES: Quantity[] = ["diode", "voltage", "resistance"];

/** A reading in base units (volts, ohms), or "OL" for an open/overload reading. */
export type Value = number | "OL";

export interface Reading {
  diode?: Value;
  voltage?: Value;
  resistance?: Value;
  note?: string;
  /** ISO timestamp of the last change. */
  updated?: string;
}

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

  const s = raw.replace(/\s+/g, "").replace(",", ".").replace(/(ohm|Ω|ω)$/i, "").replace(/V$/i, "");

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
  if (q === "diode" && unit === "" && Math.abs(value) > 3) value /= 1000;
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

/** Worst comparison over all quantities of two readings. */
export function compareReadings(reference: Reading | undefined, measured: Reading | undefined, tolerance: number): Comparison | undefined {
  let result: Comparison | undefined;
  for (const q of QUANTITIES) {
    const c = compare(reference?.[q], measured?.[q], q, tolerance);
    if (c === "deviation") return "deviation";
    if (c === "ok") result = "ok";
  }
  return result;
}

export function hasValues(r: Reading | undefined): boolean {
  return !!r && QUANTITIES.some((q) => r[q] !== undefined);
}
