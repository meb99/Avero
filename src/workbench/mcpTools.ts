/**
 * The tools an AI assistant may use over MCP (see src-tauri/src/mcp.rs):
 * reading the board open in Avero, its measurements and fault-finding
 * steps, and selecting things to show them. Answers are plain data; the
 * assistant explains them. Nothing here changes notes or files.
 */
import type { BoardModel } from "../core/board";
import { search } from "../core/search";
import { traceNet } from "../core/trace";
import type { Selection } from "../core/types";
import type { Translate } from "../i18n";
import type { SchematicDocument } from "../schematic/document";
import type { SchematicFacts } from "../schematic/partInfo";
import { consoleGuides } from "./consoleGuides";
import { judge, noPowerGuide, railVolts, type Expect } from "./diagnosis";
import { judgeFlow, type FlowExpect } from "./flows";
import { QUANTITIES, type Reading, type Value } from "./measure";
import { activeCase, type BoardNotes } from "./notes";

export interface McpContext {
  model: BoardModel | null;
  fileName?: string;
  side: string;
  selection: Selection;
  notes: BoardNotes | null;
  facts: SchematicFacts | null;
  schematic: SchematicDocument | null;
  t: Translate;
  /** Shows something in Avero (select and zoom). */
  select(selection: Selection): void;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(ctx: McpContext, args: Record<string, unknown>): unknown;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`"${name}" is required`);
  return v.trim();
};

class ToolError extends Error {}

const needBoard = (ctx: McpContext): BoardModel => {
  if (!ctx.model) throw new ToolError("No board is open in Avero. Ask the user to open one.");
  return ctx.model;
};

const valueOut = (v: Value | undefined) => (v === undefined ? undefined : v === "OL" ? "OL" : v);

function readingOut(r: Reading | undefined) {
  if (!r) return undefined;
  const out: Record<string, unknown> = {};
  for (const q of QUANTITIES) if (r[q] !== undefined) out[q === "voltage" ? "voltage_V" : q === "diode" ? "diode_V" : "resistance_ohm"] = valueOut(r[q]);
  if (r.note) out.note = r.note;
  return Object.keys(out).length ? out : undefined;
}

function readingsFor(ctx: McpContext, net: string) {
  const n = ctx.notes;
  if (!n) return undefined;
  const c = activeCase(n);
  const reference = readingOut(n.reference[net]);
  const measured = c ? readingOut(c.readings[net]) : undefined;
  return reference || measured ? { reference, measured, repair_case: c?.title } : undefined;
}

function partOf(model: BoardModel, name: string): number {
  const i = model.findPart(name);
  if (i === undefined) throw new ToolError(`No part "${name}" on this board. Use the search tool to find names.`);
  return i;
}

function netOf(model: BoardModel, name: string): number {
  const i = model.findNet(name);
  if (i === undefined) throw new ToolError(`No net "${name}" on this board. Use the search tool to find names.`);
  return i;
}

function selectionText(model: BoardModel, sel: Selection): string | undefined {
  if (sel.kind === "part") return model.parts[sel.part].name;
  if (sel.kind === "net") return model.nets[sel.net].name;
  if (sel.kind === "pin") return `${model.parts[model.pins[sel.pin].part].name}.${model.pins[sel.pin].number}`;
  return undefined;
}

const expectText = (e: Expect | FlowExpect): string => {
  switch (e.kind) {
    case "volts":
      return `${e.volts} V`;
    case "value":
      return `${e.value} ± ${Math.round(e.tolerance * 100)} %`;
    case "range":
      return `${e.min} … ${e.max}`;
    case "high":
      return "high (≥ 1 V)";
    case "low":
      return "low (< 0.3 V)";
    case "present":
      return "present";
    case "ol":
      return "OL (open)";
    case "noShort":
      return "no short to ground (diode mode)";
  }
};

export const MCP_TOOLS: Tool[] = [
  {
    name: "get_board",
    title: "Open board",
    description: "The board open in Avero: file, format, size, counts, the open schematic, the side in view and what is selected.",
    inputSchema: { type: "object", properties: {} },
    run(ctx) {
      const m = needBoard(ctx);
      const b = m.board.bounds;
      return {
        file: ctx.fileName,
        format: m.board.formatName,
        size_mm: [Math.round(((b.maxX - b.minX) * 25.4) / 100) / 10, Math.round(((b.maxY - b.minY) * 25.4) / 100) / 10],
        parts: m.parts.length,
        pins: m.pins.length,
        nets: m.nets.length,
        schematic: ctx.schematic?.name ?? null,
        side: ctx.side,
        selected: selectionText(m, ctx.selection) ?? null,
        repair_case: ctx.notes ? (activeCase(ctx.notes)?.title ?? null) : null,
      };
    },
  },
  {
    name: "search",
    title: "Search parts, nets, pins",
    description: "Finds parts, nets and pins by name or part of a name (\"U7\", \"PP3V3\", \"VBUS\", \"U3000.21\"). Best matches first.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number", description: "At most this many (default 25)" } },
      required: ["query"],
    },
    run(ctx, args) {
      const m = needBoard(ctx);
      const limit = typeof args.limit === "number" ? Math.max(1, Math.min(200, args.limit)) : 25;
      return search(m, str(args.query, "query"), limit).map((r) => ({ kind: r.kind, name: r.label, detail: r.detail }));
    },
  },
  {
    name: "get_part",
    title: "Part details",
    description: "A part: device text, side, value and part number from the schematic, and every pin with its net and the readings of that net.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Designator, e.g. U7000" } }, required: ["name"] },
    run(ctx, args) {
      const m = needBoard(ctx);
      const i = partOf(m, str(args.name, "name"));
      const p = m.parts[i];
      const f = ctx.facts?.parts.get(p.name.toUpperCase());
      const pins = [];
      for (let k = p.firstPin; k < p.firstPin + p.pinCount; k++) {
        const pin = m.pins[k];
        const net = m.nets[pin.net];
        pins.push({ pin: pin.number, ...(pin.name && { name: pin.name }), net: net.name, kind: net.kind, readings: net.kind === "unconnected" ? undefined : readingsFor(ctx, net.name) });
      }
      return {
        name: p.name,
        device: p.device ?? null,
        side: p.side,
        schematic: f ? { value: f.value, rating: f.rating, part_number: f.partNumber, package: f.package, page: f.page + 1 } : undefined,
        pins,
      };
    },
  },
  {
    name: "get_net",
    title: "Net details",
    description:
      "A net: kind (power, ground, signal), the voltage its name or the schematic states, the parts and pins on it, where it leads on (through coils, fuses, jumpers, switches, diodes, series resistors, coupling capacitors) and its readings (reference and repair case).",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Net name, e.g. PP3V3_S5" } }, required: ["name"] },
    run(ctx, args) {
      const m = needBoard(ctx);
      const i = netOf(m, str(args.name, "name"));
      const n = m.nets[i];
      const members = m.netMembers(i);
      return {
        name: n.name,
        kind: n.kind,
        voltage_from_name: railVolts(n.name) ?? null,
        voltage_in_schematic: ctx.facts?.netVoltages.get(n.name.toUpperCase()) ?? null,
        pin_count: n.pins.length,
        parts: members.slice(0, 120).map((x) => `${m.parts[x.part].name}.${x.pins.map((pin) => m.pins[pin].number).join(",")}`),
        signal_path: traceNet(m, i)
          .slice(0, 60)
          .map((l) => ({ net: m.nets[l.net].name, via: m.parts[l.via].name, kind: l.kind, steps: l.depth })),
        readings: readingsFor(ctx, n.name),
      };
    },
  },
  {
    name: "get_measurements",
    title: "Measurements",
    description: "All readings of the active repair case next to the reference values of a known good board, with the ones that differ by more than 10 %.",
    inputSchema: { type: "object", properties: {} },
    run(ctx) {
      needBoard(ctx);
      const n = ctx.notes;
      if (!n) return { readings: [] };
      const c = activeCase(n);
      const nets = new Set([...Object.keys(n.reference), ...Object.keys(c?.readings ?? {})]);
      const rows = [...nets].sort().map((net) => {
        const ref = n.reference[net];
        const got = c?.readings[net];
        const differs = QUANTITIES.filter((q) => {
          const a = ref?.[q];
          const b = got?.[q];
          if (a === undefined || b === undefined) return false;
          if (a === "OL" || b === "OL") return a !== b;
          return Math.abs(a - b) > Math.max(Math.abs(a) * 0.1, 0.02);
        });
        return { net, reference: readingOut(ref), measured: readingOut(got), ...(differs.length && { differs }) };
      });
      return { repair_case: c?.title ?? null, readings: rows };
    },
  },
  {
    name: "fault_finding",
    title: "Fault-finding steps",
    description:
      "Avero's step-by-step guides for the board in view (notebook no power; consoles and controllers: no charge, no picture, shuts off), each step with its measuring points, expected values, where they come from, and whether the readings so far pass.",
    inputSchema: { type: "object", properties: { guide: { type: "string", description: "Guide id; leave out for the list" } } },
    run(ctx, args) {
      const m = needBoard(ctx);
      const n = ctx.notes;
      const c = n ? activeCase(n) : undefined;
      const value = (net: string, q: "voltage" | "diode" | "resistance") => c?.readings[net]?.[q];
      const guides: { id: string; title: string; steps: unknown[] }[] = [
        {
          id: "notebook",
          title: "Notebook does not power on",
          steps: noPowerGuide(m).map((s) => ({
            title: s.title,
            what_to_do: s.text,
            if_wrong: s.hint,
            points: s.points.map((p) => ({
              net: p.name,
              what: p.label,
              measure: "voltage",
              expected: expectText(p.expect),
              source: p.source,
              result: judge(p.expect, value(p.name, "voltage")) ?? "not measured",
            })),
          })),
        },
        ...consoleGuides(m, ctx.t).map((g) => ({
          id: g.id,
          title: g.title,
          steps: g.steps.map((s) => ({
            title: s.title,
            what_to_do: s.text,
            if_wrong: s.hint,
            points: s.points.map((p) => ({
              net: p.net,
              what: p.label,
              measure: p.quantity,
              expected: expectText(p.expect),
              source: p.source,
              result: judgeFlow(p.expect, value(p.net, p.quantity), p.quantity) ?? "not measured",
            })),
          })),
        })),
      ];
      if (typeof args.guide !== "string") return guides.map((g) => ({ id: g.id, title: g.title, steps: g.steps.length }));
      const g = guides.find((x) => x.id === args.guide);
      if (!g) throw new ToolError(`No guide "${args.guide}". Ids: ${guides.map((x) => x.id).join(", ")}`);
      return g;
    },
  },
  {
    name: "find_in_schematic",
    title: "Find in schematic",
    description: "Pages of the open schematic PDF where a word appears (a part, net or any text), with how often.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run(ctx, args) {
      const doc = ctx.schematic;
      if (!doc) throw new ToolError("No schematic is open in Avero.");
      const hits = doc.index.find(str(args.text, "text"));
      const pages = new Map<number, number>();
      for (const w of hits) pages.set(w.page + 1, (pages.get(w.page + 1) ?? 0) + 1);
      return { schematic: doc.name, pages: [...pages].map(([page, count]) => ({ page, count })), indexed_completely: doc.indexComplete };
    },
  },
  {
    name: "show_in_avero",
    title: "Show in Avero",
    description: "Selects a part, net or pin in Avero and zooms to it, so the user sees what you mean (\"U7000\", \"PP3V3_S5\", \"U7000.12\").",
    inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    run(ctx, args) {
      const m = needBoard(ctx);
      const [hit] = search(m, str(args.target, "target"), 1);
      if (!hit) throw new ToolError(`Nothing named "${args.target}" on this board.`);
      ctx.select(hit.selection);
      return { shown: hit.label, kind: hit.kind };
    },
  },
];

/** The answer to a forwarded JSON-RPC request (`result`, or `{ error }`). */
export function answerMcp(message: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }, ctx: McpContext): unknown {
  switch (message.method) {
    case "tools/list":
      return { tools: MCP_TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) };
    case "tools/call": {
      const tool = MCP_TOOLS.find((x) => x.name === message.params?.name);
      if (!tool) return { error: { code: -32602, message: `Unknown tool: ${message.params?.name}` } };
      try {
        const data = tool.run(ctx, message.params?.arguments ?? {});
        return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }], structuredContent: Array.isArray(data) ? { items: data } : data };
      } catch (e) {
        return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
    }
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      return { error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}
