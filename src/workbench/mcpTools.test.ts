import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import type { Selection } from "../core/types";
import { translator } from "../i18n";
import { answerMcp, type McpContext } from "./mcpTools";
import { emptyNotes } from "./notes";

const model = new BoardModel(testBoard());
const shown: Selection[] = [];
const ctx: McpContext = {
  model,
  fileName: "test.brd",
  side: "top",
  selection: { kind: "part", part: 0 },
  notes: { ...emptyNotes("k", "test"), reference: { PP3V3: { voltage: 3.3, diode: 0.42 } } },
  facts: null,
  schematic: null,
  t: translator("en"),
  select: (s) => shown.push(s),
};
const call = (name: string, args: Record<string, unknown> = {}) =>
  answerMcp({ method: "tools/call", params: { name, arguments: args } }, ctx) as { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

describe("MCP tools", () => {
  it("lists tools with input schemas", () => {
    const list = answerMcp({ method: "tools/list" }, ctx) as { tools: { name: string; inputSchema: { type: string } }[] };
    expect(list.tools.map((t) => t.name)).toContain("get_net");
    expect(list.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("describes the board, a part and a net", () => {
    expect(call("get_board").structuredContent).toMatchObject({ file: "test.brd", parts: model.parts.length, selected: model.parts[0].name });
    const part = call("get_part", { name: model.parts[0].name }).structuredContent as { pins: { net: string }[] };
    expect(part.pins.length).toBe(model.parts[0].pinCount);
    const net = call("get_net", { name: "PP3V3" }).structuredContent as { readings: { reference: Record<string, number> }; signal_path: unknown[] };
    expect(net.readings.reference).toEqual({ diode_V: 0.42, voltage_V: 3.3 });
    expect(net.signal_path.length).toBeGreaterThan(0);
  });

  it("lists the power rails, highest first", () => {
    const rails = call("list_rails").structuredContent as { items: { net: string; volts: number | null }[] };
    const pp3v3 = rails.items.find((r) => r.net === "PP3V3");
    expect(pp3v3).toMatchObject({ volts: 3.3 });
    const volts = rails.items.map((r) => r.volts ?? -1);
    expect(volts).toEqual([...volts].sort((a, b) => b - a));
    expect(rails.items.some((r) => /GND/i.test(r.net))).toBe(false);
  });

  it("compares readings only under fitting conditions", () => {
    const notes = { ...emptyNotes("k", "test"), reference: { PP3V3: { voltage: 0, conds: { voltage: { power: "off" as const } } } } };
    notes.cases = [{ id: "c", title: "Fall", created: "", notes: "", readings: { PP3V3: { voltage: 3.3, conds: { voltage: { power: "on" as const } } } } }];
    notes.activeCase = "c";
    const r = answerMcp({ method: "tools/call", params: { name: "get_measurements" } }, { ...ctx, notes }) as { structuredContent: { readings: Record<string, unknown>[] } };
    const row = r.structuredContent.readings[0];
    expect(row.differs).toBeUndefined();
    expect(row.not_comparable).toEqual(["voltage"]);
    expect(row.reference).toMatchObject({ voltage_conditions: { power: "off" } });
  });

  it("reports unknown names as tool errors, not crashes", () => {
    const r = call("get_part", { name: "NOPE99" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("NOPE99");
    expect(call("get_part").isError).toBe(true);
    expect(answerMcp({ method: "tools/call", params: { name: "nope" } }, ctx)).toMatchObject({ error: { code: -32602 } });
    expect(answerMcp({ method: "foo/bar" }, ctx)).toMatchObject({ error: { code: -32601 } });
  });

  it("shows things in Avero and lists the guides", () => {
    call("show_in_avero", { target: "PP3V3" });
    expect(shown.at(-1)).toMatchObject({ kind: "net" });
    const guides = call("fault_finding").structuredContent as { items: { id: string }[] };
    expect(guides.items[0].id).toBe("notebook");
    expect(call("find_in_schematic", { text: "U1" }).isError).toBe(true);
  });
});
