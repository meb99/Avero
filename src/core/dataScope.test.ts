import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { dataScope } from "./dataScope";
import { testBoard } from "./testBoard";

const ctx = { showTraces: true, hiddenLayers: new Set<number>(), notes: null, docs: [], schematicValues: 0 };
const row = (rows: ReturnType<typeof dataScope>, id: string) => rows.find((r) => r.id === id);

describe("data scope", () => {
  it("tells no inner layers in the file from inner layers hidden", () => {
    const board = testBoard();
    const none = dataScope(new BoardModel({ ...board, layers: [{ name: "Top", side: "top" }] }), ctx);
    expect(row(none, "innerLayers")?.state).toBe("none");
    const withInner = new BoardModel({ ...board, layers: [{ name: "Top", side: "top" }, { name: "In1", side: "both" }] });
    expect(row(dataScope(withInner, { ...ctx, hiddenLayers: new Set([1]) }), "innerLayers")?.state).toBe("hidden");
    expect(row(dataScope(withInner, { ...ctx, showTraces: false }), "innerLayers")?.state).toBe("hidden");
    expect(row(dataScope(withInner, ctx), "innerLayers")).toMatchObject({ state: "yes", n: 1, m: 1 });
  });

  it("never shows added or reconstructed data as read from the file", () => {
    const board = testBoard();
    const traces = [{ x1: 0, y1: 0, x2: 10, y2: 0, width: 5, side: "top" as const, layer: 0, net: 0 }];
    const added = new BoardModel({
      ...board,
      traces,
      layers: [{ name: "Top", side: "top" }],
      derived: [
        { what: "copper", how: "another reading of the same file", count: 1 },
        { what: "outline", how: "a box around the pins", count: 1 },
        { what: "bottom-side", how: "the second view, mirrored", count: 4 },
      ],
    });
    const rows = dataScope(added, ctx);
    expect(row(rows, "traces")).toMatchObject({ state: "derived", how: "another reading of the same file" });
    expect(row(rows, "outline")?.state).toBe("estimated");
    expect(row(rows, "bottomSide")).toMatchObject({ state: "derived", n: 4 });
    expect(rows.some((r) => r.state === "yes" && (r.id === "traces" || r.id === "outline"))).toBe(false);
  });

  it("says when a file has no tracks at all", () => {
    expect(row(dataScope(new BoardModel({ ...testBoard(), traces: [] }), ctx), "traces")?.state).toBe("none");
    expect(row(dataScope(new BoardModel({ ...testBoard(), lockedParts: 12 }), ctx), "lockedParts")).toMatchObject({ state: "none", n: 12 });
  });

  it("marks text recognition and own entries", () => {
    const rows = dataScope(new BoardModel(testBoard()), {
      ...ctx,
      docs: [{ pageCount: 40, recognisedPages: 3 }],
      notes: { reference: { PP3V3: {} }, cases: [{ good: true }], netNames: { N1: "GND" }, hidden: { parts: ["SH1"] } },
    });
    expect(row(rows, "schematic")).toMatchObject({ state: "text", m: 3 });
    expect(row(rows, "manual")).toMatchObject({ state: "manual", n: 2 });
    expect(row(rows, "readings")).toMatchObject({ state: "yes", n: 1, m: 2 });
  });

  it("names readings the file carries with what they belong to", () => {
    const model = new BoardModel({ ...testBoard(), readings: [{ part: "U10", pin: "1", quantity: "diode", value: 0.48, raw: "480", list: "阻值" }, { part: "U10", pin: "2", quantity: "diode", value: null, raw: "OL", list: "阻值" }] });
    expect(dataScope(model, { showTraces: true, hiddenLayers: new Set(), notes: null, docs: [], schematicValues: 0 }).find((r) => r.id === "fileReadings")).toEqual({ id: "fileReadings", state: "yes", n: 2, m: 1 });
  });
});
