/**
 * Own trace rules: which parts pass a signal on, and from which pins to which. The built-in
 * guesses in `trace.ts` know two-pin parts and simple load switches; a rule also covers parts
 * with many pins – a DrMOS from its VIN pins to its phase node, a buck regulator from VIN to
 * its output, a four-pin shunt from one side to the other.
 *
 * The text form is the CSV of NexusBV's trace definitions (`tracedef.txt`), so a file can be
 * taken over in either direction:
 *
 *     Enabled,Marker,Type,Number of pins,Contains,Pins In,Pins Out,Package
 *     1,PQ,Mosfet,8,AON6403,5-8,1-3,DFN-8
 *
 * - Marker: designator letters, several separated by commas ("PL, L").
 * - Number of pins: the part's pin count; empty matches any.
 * - Contains: part numbers, one of which the device text must contain; empty matches any.
 * - Pins In / Pins Out: pin numbers and ranges ("1-3", "11-12,16"). Both empty: every pin
 *   passes to every other, as a coil or fuse does.
 * - Package is kept for the list; device texts rarely carry it, so it does not decide.
 */

export interface TraceRule {
  enabled: boolean;
  markers: string[];
  type: string;
  pinCount?: number;
  contains: string[];
  pinsIn: string[];
  pinsOut: string[];
  package: string;
}

export const TRACE_RULE_HEADER = "Enabled,Marker,Type,Number of pins,Contains,Pins In,Pins Out,Package";

/** One CSV line into fields; quotes as in RFC 4180. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

const list = (field: string) =>
  field
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** "5-8", "1,3", "11-12,16" into pin numbers; a range of letters or more than 512 pins stays as written. */
export function pinSpec(field: string): string[] {
  const out: string[] = [];
  for (const item of list(field)) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(item);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (b >= a && b - a < 512) {
        for (let n = a; n <= b; n++) out.push(String(n));
        continue;
      }
    }
    out.push(item);
  }
  return out;
}

export interface ParsedRules {
  rules: TraceRule[];
  /** Line numbers (1-based) that could not be read. */
  skipped: number[];
}

/** Rules from NexusBV's CSV form; the header line and blank lines are left out. */
export function parseTraceRules(text: string): ParsedRules {
  const rules: TraceRule[] = [];
  const skipped: number[] = [];
  text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (!line.trim() || /^\s*enabled\s*,/i.test(line)) return;
      const f = csvFields(line);
      const markers = list(f[1] ?? "").map((m) => m.toUpperCase());
      const count = (f[3] ?? "").trim();
      if (f.length < 7 || markers.length === 0 || (count !== "" && !/^\d+$/.test(count))) {
        skipped.push(i + 1);
        return;
      }
      rules.push({
        enabled: f[0] !== "0" && f[0].toLowerCase() !== "false",
        markers,
        type: f[2] ?? "",
        pinCount: count === "" ? undefined : Number(count),
        contains: list(f[4] ?? ""),
        pinsIn: pinSpec(f[5] ?? ""),
        pinsOut: pinSpec(f[6] ?? ""),
        package: f[7] ?? "",
      });
    });
  return { rules, skipped };
}

const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Pin numbers back into ranges: 5,6,7,8 → "5-8". */
function joinPins(pins: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < pins.length; i++) {
    let j = i;
    while (j + 1 < pins.length && /^\d+$/.test(pins[j]) && /^\d+$/.test(pins[j + 1]) && Number(pins[j + 1]) === Number(pins[j]) + 1) j++;
    out.push(j > i ? `${pins[i]}-${pins[j]}` : pins[i]);
    i = j;
  }
  return out.join(",");
}

/** Rules in NexusBV's CSV form, with its header. */
export function serializeTraceRules(rules: readonly TraceRule[]): string {
  const lines = rules.map((r) =>
    [r.enabled ? "1" : "0", r.markers.join(", "), r.type, r.pinCount === undefined ? "" : String(r.pinCount), r.contains.join(","), joinPins(r.pinsIn), joinPins(r.pinsOut), r.package]
      .map(quote)
      .join(","),
  );
  return [TRACE_RULE_HEADER, ...lines].join("\n") + "\n";
}

export interface RulePart {
  name: string;
  device?: string;
  pinCount: number;
}

/**
 * The rule for a part: enabled, marker and pin count fitting, and the device text containing
 * one of the listed part numbers. A rule naming part numbers wins over a general one; among
 * equals the first in the list.
 */
export function ruleFor(rules: readonly TraceRule[], part: RulePart): TraceRule | undefined {
  const letters = (/^[A-Za-z]+/.exec(part.name.trim())?.[0] ?? "").toUpperCase();
  if (!letters) return undefined;
  const device = (part.device ?? "").toUpperCase();
  let general: TraceRule | undefined;
  for (const r of rules) {
    if (!r.enabled || !r.markers.includes(letters)) continue;
    if (r.pinCount !== undefined && r.pinCount !== part.pinCount) continue;
    if (r.contains.length === 0) {
      general ??= r;
      continue;
    }
    if (r.contains.some((c) => device.includes(c.toUpperCase()))) return r;
  }
  return general;
}

/**
 * The pins a signal on `fromPins` reaches through a part under `rule`: in → out and out → in;
 * a rule without pins joins every pin to every other. Pins on neither list pass nothing.
 */
export function rulePassage(rule: TraceRule, fromPins: readonly string[]): { pins: string[] | "others" } {
  if (rule.pinsIn.length === 0 && rule.pinsOut.length === 0) return { pins: "others" };
  const pins = new Set<string>();
  for (const p of fromPins) {
    if (rule.pinsIn.includes(p)) rule.pinsOut.forEach((o) => pins.add(o));
    if (rule.pinsOut.includes(p)) rule.pinsIn.forEach((i) => pins.add(i));
  }
  return { pins: [...pins] };
}

let cache: { text: string; rules: TraceRule[] } | null = null;

/** The rules of the text stored in the settings, read once per change of the text. */
export function storedRules(text: string | undefined): TraceRule[] {
  if (!text?.trim()) return [];
  if (cache?.text !== text) cache = { text, rules: parseTraceRules(text).rules };
  return cache.rules;
}

/** The trace kind a rule's type stands for, so its steps are coloured like the built-in ones. */
export function ruleKind(rule: TraceRule): "through" | "switch" | "diode" | "resistor" | "coupling" | "rule" {
  const t = rule.type.toLowerCase();
  const pinned = rule.pinsIn.length > 0 || rule.pinsOut.length > 0;
  if (/inductor|choke|coil|ferrite|bead|fuse|jumper/.test(t)) return "through";
  if (/resistor/.test(t)) return pinned ? "through" : "resistor";
  if (/diode/.test(t)) return "diode";
  if (/capacitor/.test(t)) return "coupling";
  if (/mosfet|switch|transistor/.test(t)) return "switch";
  return "rule";
}
