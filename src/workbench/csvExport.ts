/**
 * Lists of the open board as CSV for spreadsheets: parts (a bill of
 * materials with schematic values), nets, and the readings of the
 * reference and the active repair case. Semicolons and a byte order mark,
 * so Excel and Numbers open them right in German locales too.
 */
import { partCenter, type BoardModel } from "../core/board";
import type { SchematicFacts } from "../schematic/partInfo";
import { QUANTITIES, type Value } from "./measure";
import { activeCase, type BoardNotes } from "./notes";

const cell = (v: string | number | undefined | null): string => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function csv(rows: (string | number | undefined | null)[][]): Uint8Array {
  const text = rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
  return new TextEncoder().encode(`﻿${text}`);
}

const mm = (mils: number) => String(Math.round((mils * 25.4) / 10) / 100).replace(".", ",");
const val = (v: Value | undefined) => (v === undefined ? "" : v === "OL" ? "OL" : String(v).replace(".", ","));

export function partsCsv(model: BoardModel, facts: SchematicFacts | null): Uint8Array {
  const rows: (string | number | undefined)[][] = [["Part", "Device", "Value", "Part number", "Side", "X mm", "Y mm", "Pins"]];
  model.parts.forEach((p) => {
    const f = facts?.parts.get(p.name.toUpperCase());
    const c = partCenter(p);
    rows.push([p.name, p.device, f?.value, f?.partNumber, p.side, mm(c.x), mm(c.y), p.pinCount]);
  });
  return csv(rows);
}

export function netsCsv(model: BoardModel): Uint8Array {
  const rows: (string | number)[][] = [["Net", "Kind", "Pins", "Parts"]];
  model.nets.forEach((n, i) => {
    if (n.kind === "unconnected") return;
    const parts = model.netMembers(i).map((m) => model.parts[m.part].name);
    rows.push([n.name, n.kind, n.pins.length, parts.join(" ")]);
  });
  return csv(rows);
}

export function readingsCsv(notes: BoardNotes): Uint8Array {
  const c = activeCase(notes);
  const head = ["Net", ...QUANTITIES.map((q) => `Reference ${q}`), ...(c ? QUANTITIES.map((q) => `${c.title} ${q}`) : []), "Note"];
  const nets = [...new Set([...Object.keys(notes.reference), ...Object.keys(c?.readings ?? {})])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows: string[][] = [head];
  for (const net of nets) {
    const r = notes.reference[net];
    const m = c?.readings[net];
    rows.push([net, ...QUANTITIES.map((q) => val(r?.[q])), ...(c ? QUANTITIES.map((q) => val(m?.[q])) : []), m?.note ?? r?.note ?? ""]);
  }
  return csv(rows);
}
