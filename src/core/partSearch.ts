/**
 * Finding parts by what they are: value, voltage rating, package and type
 * together ("10 µF 16V 0603", "kondensator 100nF 0402", "4k7 0201").
 * The facts come from the part's device text in the board file and, where
 * known, from the schematic.
 */
import { classify, partKind, type SchematicPart } from "../schematic/partInfo";

type Unit = "F" | "Ω" | "H";
type Kind = ReturnType<typeof partKind>;

export interface PartSpecs {
  kind: Kind;
  value?: { v: number; unit: Unit };
  /** Voltage rating in volts. */
  volts?: number;
  package?: string;
  partNumber?: string;
}

export interface PartQuery {
  kind?: Kind;
  value?: { v: number; unit: Unit };
  minVolts?: number;
  maxVolts?: number;
  package?: string;
  /** Other words, matched against name and device text. */
  words: string[];
}

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, "": 1 };

/** "10 µF", "4.7 kΩ", "6.8 µH", "0 Ω" (as written by `classify`) → number and unit. */
export function parseNormalized(text: string): { v: number; unit: Unit } | undefined {
  const m = /^([\d.]+)\s*([pnuµmkKM]?)(F|Ω|H)$/.exec(text.trim());
  if (!m) return undefined;
  const v = Number(m[1]) * (PREFIX[m[2]] ?? 1);
  return Number.isFinite(v) ? { v, unit: m[3] as Unit } : undefined;
}

const PACKAGE = /^(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512|(QFN|DFN|SON|SOT|SOIC|TSSOP|MSOP|BGA|LGA|WLCSP|CSP|SC70)[\dA-Z-]*)$/i;
const TYPE_WORDS: [RegExp, Kind][] = [
  [/^(kondensator(en)?|kerko|elko|cap(acitor)?s?|c)$/i, "C"],
  [/^(widerst(a|ä)nd(e)?|resistors?|res|r)$/i, "R"],
  [/^(spulen?|induktivit(ä|a)t(en)?|inductors?|coils?|ferrite?s?|l)$/i, "L"],
  [/^(ic|ics|chips?|mosfets?|transistor(en|s)?|dioden?|diodes?)$/i, "chip"],
];

/** A typed value: "10µF", "10uf", "100n", "4k7", "4.7k", "100R", "10kΩ", "6.8uH". */
function queryValue(token: string): { v: number; unit: Unit } | undefined {
  const t = token.replace(/ohms?$/i, "Ω");
  let m = /^(\d+)([kKMR])(\d+)$/.exec(t);
  if (m) return { v: Number(`${m[1]}.${m[3]}`) * (m[2] === "R" ? 1 : PREFIX[m[2]]), unit: "Ω" };
  m = /^([\d.]+)([pnuµm]?)(f|F)$/.exec(t);
  if (m) return { v: Number(m[1]) * PREFIX[m[2]], unit: "F" };
  m = /^([\d.]+)([pnuµm])$/.exec(t);
  if (m) return { v: Number(m[1]) * PREFIX[m[2]], unit: "F" };
  m = /^([\d.]+)([nuµm]?)(h|H)$/.exec(t);
  if (m) return { v: Number(m[1]) * PREFIX[m[2]], unit: "H" };
  m = /^([\d.]+)([kKM]?)(Ω|R|r)?$/.exec(t);
  if (m && (m[2] || m[3])) return { v: Number(m[1]) * PREFIX[m[2] || ""], unit: "Ω" };
  return undefined;
}

/**
 * Reads a search like "10 µF mindestens 16 V 0603". Returns null when it
 * holds no value, rating, package or type, so plain name searches stay as
 * they are.
 */
export function parsePartQuery(input: string): PartQuery | null {
  // "10 µF" → "10µF", "16 V" → "16V", "≥ 16" → "≥16".
  const text = input.replace(/,/g, " ").replace(/(\d)\s+(?=[a-zA-ZµΩ%])/g, "$1").replace(/([≥≤<>]=?)\s+(?=\d)/g, "$1");
  const tokens = text.split(/\s+/).filter(Boolean);
  const q: PartQuery = { words: [] };
  let found = false;
  let bound: "min" | "max" = "min";
  for (const raw of tokens) {
    const token = raw.trim();
    if (/^(mindestens|min\.?|ab|at-?least)$/i.test(token)) {
      bound = "min";
      continue;
    }
    if (/^(höchstens|max\.?|bis|at-?most)$/i.test(token)) {
      bound = "max";
      continue;
    }
    const volts = /^(≥|>=|>|≤|<=|<)?(\d+(?:\.\d+)?)v$/i.exec(token);
    if (volts) {
      const isMax = volts[1] ? volts[1].startsWith("≤") || volts[1].startsWith("<") : bound === "max";
      if (isMax) q.maxVolts = Number(volts[2]);
      else q.minVolts = Number(volts[2]);
      bound = "min";
      found = true;
      continue;
    }
    if (PACKAGE.test(token)) {
      q.package = token.toUpperCase();
      found = true;
      continue;
    }
    const type = TYPE_WORDS.find(([re]) => re.test(token));
    if (type && tokens.length > 1) {
      q.kind = type[1];
      found = true;
      continue;
    }
    const value = queryValue(token);
    if (value) {
      q.value = value;
      if (!q.kind) q.kind = value.unit === "F" ? "C" : value.unit === "Ω" ? "R" : "L";
      found = true;
      continue;
    }
    q.words.push(token.toUpperCase());
  }
  return found ? q : null;
}

/** What a part is, from its device text and the schematic (which wins). */
export function partSpecs(name: string, device: string | undefined, schematic?: SchematicPart): PartSpecs {
  const kind = partKind(name);
  const specs: PartSpecs = { kind };
  for (const token of (device ?? "").toUpperCase().split(/[\s_/,]+/).filter(Boolean)) {
    const f = classify(token, kind);
    if (!f) continue;
    if (f.field === "value" && !specs.value) specs.value = parseNormalized(f.text);
    else if (f.field === "rating" && /V$/i.test(f.text) && specs.volts === undefined) specs.volts = Number.parseFloat(f.text);
    else if (f.field === "package" && !specs.package) specs.package = f.text;
    else if (f.field === "partNumber" && !specs.partNumber) specs.partNumber = f.text;
  }
  if (schematic?.value) specs.value = parseNormalized(schematic.value) ?? specs.value;
  if (schematic?.rating && /V$/i.test(schematic.rating)) specs.volts = Number.parseFloat(schematic.rating);
  if (schematic?.package) specs.package = schematic.package;
  if (schematic?.partNumber) specs.partNumber = schematic.partNumber;
  return specs;
}

const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.01 + 1e-15;

export function matchesQuery(specs: PartSpecs, q: PartQuery, name: string, device?: string): boolean {
  if (q.kind && specs.kind !== q.kind) return false;
  if (q.value && !(specs.value && specs.value.unit === q.value.unit && same(specs.value.v, q.value.v))) return false;
  if (q.minVolts !== undefined && !(specs.volts !== undefined && specs.volts >= q.minVolts)) return false;
  if (q.maxVolts !== undefined && !(specs.volts !== undefined && specs.volts <= q.maxVolts)) return false;
  if (q.package && !(specs.package?.toUpperCase().startsWith(q.package) || device?.toUpperCase().includes(q.package))) return false;
  const hay = `${name} ${device ?? ""} ${specs.partNumber ?? ""}`.toUpperCase();
  return q.words.every((w) => hay.includes(w));
}
