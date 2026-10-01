/**
 * OpenBoardData (openboarddata.org) files: known-good diode, voltage and
 * resistance values of nets, component values and diagnosis notes for a
 * board. The data is licensed under the Open Database Licence (ODbL 1.0).
 *
 *   HEADER_DATA_START … ID 820-00165 … HEADER_DATA_END
 *   DIAGNOSIS_DATA_START  SECT_START name / NOTE_START title / text / NOTE_END / SECT_END
 *   COMPONENTS_DATA_START C1000 v 1UF
 *   NETS_DATA_START       PP3V3_S5/Default d 0.42 'comment'
 *
 * Conditions and texts are URL-encoded with "+" for spaces.
 */
import { LINK_CLOSE, LINK_MID, LINK_OPEN, type Block } from "./wikitext";

export type ObdKind = "d" | "v" | "r" | "a" | "t";

export interface ObdNetValue {
  net: string;
  /** Board condition the value holds for, "Default" unless stated. */
  condition: string;
  kind: ObdKind;
  value: string;
  comment: string;
}

export interface ObdPartValue {
  part: string;
  /** v value, p package, c maker code, r rating, m misc, s status. */
  kind: string;
  value: string;
}

export interface ObdData {
  id: string;
  /** "laptops/apple/820-00165" */
  path: string;
  brand: string;
  category: string;
  nets: ObdNetValue[];
  parts: ObdPartValue[];
}

export const OBD_LICENSE = "ODbL 1.0";
export const OBD_SITE = "https://openboarddata.org";

/** "If+voltage+below+3.35" → "If voltage below 3.35"; text that is not valid encoding stays as it is. */
function decode(s: string): string {
  const spaced = s.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced).trim();
  } catch {
    return spaced.trim();
  }
}

/** Conditions are sometimes encoded twice: "TP%2Band%2BKB" → "TP+and+KB" → "TP and KB". */
function decodeCondition(s: string): string {
  const once = decode(s);
  return /\+/.test(once) && !/\s/.test(once) ? once.replace(/\+/g, " ") : once;
}

/**
 * "ol" → "OL", "15.70R" → "15.70 Ω", "2.80k" → "2.80 kΩ", "3.4" volts → "3.4 V".
 * A resistance without a unit stays as written: guessing one would invent data.
 */
export function obdValue(kind: ObdKind, raw: string): string {
  const v = decode(raw);
  if (/^ol$/i.test(v)) return "OL";
  if (/^n\/?a$/i.test(v)) return "n/a";
  if (kind === "r") {
    const m = /^([\d.]+)\s*([rRΩkKM])$/.exec(v);
    if (m) return `${m[1]} ${/[kK]/.test(m[2]) ? "kΩ" : m[2] === "M" ? "MΩ" : "Ω"}`;
  }
  if (kind === "v" && /^-?[\d.]+$/.test(v)) return `${v} V`;
  return v;
}

const linkTo = (label: string, target: string) => `${LINK_OPEN}${label}${LINK_MID}${target}${LINK_CLOSE}`;

/** "[n:PP3V3_S5]" and "[p:U7701:3]" in note text become links to the board. */
export function obdText(line: string): string {
  return line
    .replace(/\[n:([^\]\s]+)\]/g, (_, net: string) => linkTo(net, `net:${net}`))
    .replace(/\[p:([^\]:\s]+)(?::([^\]\s]+))?\]/g, (_, part: string, pin?: string) =>
      linkTo(pin ? `${part}.${pin}` : part, pin ? `part:${part}:${pin}` : `part:${part}`),
    );
}

export function isObdata(text: string): boolean {
  return /^﻿?\s*HEADER_DATA_START/.test(text);
}

/** The board data and its diagnosis notes as page blocks. */
export function parseObdata(text: string): { data: ObdData; blocks: Block[] } {
  const lines = text.replace(/\r/g, "").split("\n");
  const header: Record<string, string> = {};
  const blocks: Block[] = [];
  const nets: ObdNetValue[] = [];
  const parts: ObdPartValue[] = [];
  let section = "";
  let note: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^(HEADER|DIAGNOSIS|COMPONENTS|NETS)_DATA_(START|END)$/.test(line)) {
      section = line.endsWith("START") ? line.replace(/_DATA_START$/, "") : "";
      continue;
    }
    if (line.startsWith("###")) continue;
    if (section === "HEADER") {
      const m = /^(\w+)\s*(.*)$/.exec(line);
      if (m) header[m[1]] = m[2].trim();
    } else if (section === "DIAGNOSIS") {
      if (line.startsWith("SECT_START")) blocks.push({ type: "heading", level: 2, text: line.slice(10).trim() || "–" });
      else if (line.startsWith("NOTE_START")) {
        blocks.push({ type: "heading", level: 3, text: line.slice(10).trim() || "–" });
        note = [];
      } else if (line === "NOTE_END") {
        if (note?.length) blocks.push({ type: "list", ordered: false, items: note });
        note = null;
      } else if (note && line.trim()) note.push(obdText(line.trim()));
    } else if (section === "COMPONENTS") {
      const m = /^(\S+)\s+(\S)\s+(.*)$/.exec(line);
      if (m) parts.push({ part: m[1], kind: m[2], value: decode(m[3]) });
    } else if (section === "NETS") {
      // NET/CONDITION kind value 'comment'
      const m = /^(\S+?)(?:\/(\S+))?\s+([dvrat])\s+(.*?)\s*(?:'([^']*)')?$/.exec(line);
      if (!m) continue;
      const kind = m[3] as ObdKind;
      nets.push({
        net: m[1],
        condition: decodeCondition(m[2] ?? "Default"),
        kind,
        value: kind === "t" || kind === "a" ? decode(m[4]) : obdValue(kind, m[4]),
        comment: decode(m[5] ?? ""),
      });
    }
  }
  if (!header.ID && !header.BOARDPATH) throw new Error("not an OpenBoardData file");
  // Placeholder sections ("New Section" / "New Title" / "Testing") carry nothing.
  const cleaned = blocks.filter((b, i) => {
    const next = blocks[i + 1];
    if (b.type === "list" && b.items.length === 1 && /^testing$/i.test(b.items[0])) return false;
    if (b.type === "heading" && /^new (section|title)$/i.test(b.text)) return next?.type === "list" && !/^testing$/i.test(next.items[0] ?? "");
    return true;
  });
  return {
    data: {
      id: header.ID ?? header.BOARDPATH.split("/").pop() ?? "",
      path: header.BOARDPATH ?? "",
      brand: header.BRAND ?? "",
      category: header.CATEGORY ?? "",
      nets,
      parts,
    },
    blocks: cleaned,
  };
}

export interface NetReading {
  condition: string;
  d: string;
  v: string;
  r: string;
  notes: string[];
}

/** Notes that say nothing ("-", "+" from an empty encoded comment). */
const EMPTY_NOTE = /^[\s+\-–]*$/;

/**
 * Values of one net, one row per board condition, and the nets the file
 * links it to ("a" entries: related nets such as a current-sense pair,
 * each with values of its own — not a second name of the same net).
 */
export function netReadings(data: ObdData, netName: string): { rows: NetReading[]; related: string[] } {
  const name = netName.toUpperCase();
  const rows = new Map<string, NetReading>();
  const related = new Set<string>();
  for (const e of data.nets) {
    const own = e.net.toUpperCase() === name;
    if (e.kind === "a") {
      if (own) related.add(e.value);
      else if (e.value.toUpperCase() === name) related.add(e.net);
      continue;
    }
    if (!own) continue;
    const row = rows.get(e.condition) ?? { condition: e.condition, d: "", v: "", r: "", notes: [] };
    if (e.kind === "d" || e.kind === "v" || e.kind === "r") row[e.kind] = e.value;
    for (const text of [e.kind === "t" ? e.value : "", e.comment]) if (text && !EMPTY_NOTE.test(text)) row.notes.push(text);
    rows.set(e.condition, row);
  }
  return {
    rows: [...rows.values()]
      .filter((r) => r.d || r.v || r.r || r.notes.length)
      .sort((a, b) => (a.condition === "Default" ? -1 : b.condition === "Default" ? 1 : a.condition.localeCompare(b.condition))),
    related: [...related].sort(),
  };
}

/** Values of one part (value, package, rating …). */
export function partValues(data: ObdData, partName: string): ObdPartValue[] {
  const name = partName.toUpperCase();
  return data.parts.filter((p) => p.part.toUpperCase() === name);
}
