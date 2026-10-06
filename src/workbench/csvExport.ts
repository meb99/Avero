/**
 * Lists of the open board as CSV for spreadsheets: parts (a bill of
 * materials with schematic values), nets, and the readings of the
 * reference and the active repair case. Semicolons and a byte order mark,
 * so Excel and Numbers open them right in German locales too.
 */
import { partCenter, type BoardModel } from "../core/board";
import type { BoardDiff } from "../core/diff";
import type { SchematicFacts } from "../schematic/partInfo";
import { QUANTITIES, type Reading, type Value } from "./measure";
import { activeCase, type BoardNotes } from "./notes";
import type { ReadingDifference } from "./readingDiff";

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
  const head = ["Net", "Point", ...QUANTITIES.map((q) => `Reference ${q}`), ...(c ? QUANTITIES.map((q) => `${c.title} ${q}`) : []), "Note"];
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const nets = [...new Set([...Object.keys(notes.reference), ...Object.keys(c?.readings ?? {})])].sort(byName);
  const rows: string[][] = [head];
  const row = (net: string, point: string, r: Reading | undefined, m: Reading | undefined) =>
    rows.push([net, point, ...QUANTITIES.map((q) => val(r?.[q])), ...(c ? QUANTITIES.map((q) => val(m?.[q])) : []), m?.note ?? r?.note ?? ""]);
  for (const net of nets) row(net, "", notes.reference[net], c?.readings[net]);
  // Readings at single points, after the nets.
  const refPoints = notes.referencePoints ?? {};
  const casePoints = c?.points ?? {};
  for (const point of [...new Set([...Object.keys(refPoints), ...Object.keys(casePoints)])].sort(byName)) {
    const r = refPoints[point];
    const m = casePoints[point];
    row(m?.net ?? r?.net ?? "", point, r, m);
  }
  return csv(rows);
}

/**
 * Notes and drawings with what they belong to: kind, side, the part, pin or
 * net a note is bound to, text, group, style, whether locked, photos, and
 * the positions in mm.
 */
export function annotationsCsv(notes: BoardNotes): Uint8Array {
  const rows: (string | number | undefined)[][] = [["Kind", "Side", "Bound to", "Text", "Group", "Color", "Width", "Locked", "Photos", "Points (mm)", "Created"]];
  const at = (pts: { x: number; y: number }[]) => pts.map((p) => `${mm(p.x)}/${mm(p.y)}`).join(" ");
  for (const m of notes.markers ?? []) {
    rows.push(["note", m.side, m.target ?? "", m.text, "", "", "", "", (m.photos ?? []).length || "", at([m]), m.created]);
  }
  for (const d of notes.drawings ?? []) {
    const text = d.kind === "jumper" && d.from && d.to ? [d.text, `${d.from} → ${d.to}`].filter(Boolean).join(" · ") : d.text;
    rows.push([d.kind, d.side, "", text ?? "", d.group ?? "", d.color ?? "", d.width ?? "", d.locked ? "yes" : "", "", at(d.points), d.created]);
  }
  return csv(rows);
}

/**
 * The differences of two boards as one list: population, connections and
 * readings, each row with the part, pin or net it is about.
 */
export function differencesCsv(d: BoardDiff, readings: ReadingDifference[], nameA: string, nameB: string): Uint8Array {
  const rows: (string | number | undefined)[][] = [["Area", "Kind", "Reference", `A: ${nameA}`, `B: ${nameB}`, "Detail"]];
  for (const c of d.changed) {
    const fitted = c.changes.filter((x) => x !== "nets");
    if (fitted.length) rows.push(["population", "changed", c.name, c.deviceA, c.deviceB, fitted.join(", ")]);
  }
  for (const c of d.onlyA) rows.push(["population", "only A", c.name, c.deviceA, "", ""]);
  for (const c of d.onlyB) rows.push(["population", "only B", c.name, "", c.deviceB, ""]);
  for (const p of d.pins) rows.push(["connections", "pin on other net", `${p.part}.${p.pin}`, p.netA, p.netB, ""]);
  for (const n of d.netChanges)
    rows.push(["connections", n.renamedTo ? "net renamed and changed" : "net changed", n.name, n.name, n.renamedTo ?? n.name, [...n.added.map((x) => `+${x}`), ...n.removed.map((x) => `-${x}`)].join(" ")]);
  for (const r of d.renamed) rows.push(["connections", "net renamed", r.a, r.a, r.b, "same pins"]);
  for (const n of d.netsOnlyA) rows.push(["connections", "net only A", n, n, "", ""]);
  for (const n of d.netsOnlyB) rows.push(["connections", "net only B", n, "", n, ""]);
  for (const r of readings) rows.push(["readings", `${r.quantity} ${r.status}`, r.point ?? r.net, val(r.a), val(r.b), r.netB ? `B: ${r.netB}` : ""]);
  return csv(rows);
}
