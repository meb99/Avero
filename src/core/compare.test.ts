import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { mapSelection } from "./compare";
import { matchNets } from "./diff";
import { testBoard } from "./testBoard";

const a = new BoardModel(testBoard());
// A second revision where R9 became R99.
const b = new BoardModel({ ...testBoard(), parts: testBoard().parts.map((p) => (p.name === "R9" ? { ...p, name: "R99" } : p)) });

describe("mapSelection", () => {
  it("maps parts, pins and nets by name", () => {
    expect(mapSelection(a, b, { kind: "part", part: 1 })).toEqual({ kind: "part", part: 1 });
    const pin = b.findPin(1, "A3")!;
    expect(mapSelection(a, b, { kind: "pin", pin: 4 })).toEqual({ kind: "pin", pin });
    expect(mapSelection(a, b, { kind: "net", net: 0 })).toEqual({ kind: "net", net: b.findNet("PP3V3") });
    expect(mapSelection(a, b, { kind: "testPoint", testPoint: 0 })).toEqual({ kind: "net", net: b.findNet("PP3V3") });
  });

  it("falls back to nothing for parts the other board lacks", () => {
    expect(mapSelection(a, b, { kind: "part", part: 3 })).toEqual({ kind: "none" });
    expect(mapSelection(a, b, { kind: "net", net: 3 })).toEqual({ kind: "none" }); // unconnected
  });

  it("finds a net renamed on the other board through the matched nets", () => {
    const board = structuredClone(testBoard());
    board.nets[4].name = "PP3V3_LX";
    const renamed = new BoardModel(board);
    expect(mapSelection(a, renamed, { kind: "net", net: 4 })).toEqual({ kind: "none" });
    expect(mapSelection(a, renamed, { kind: "net", net: 4 }, matchNets(a, renamed).map)).toEqual({ kind: "net", net: 4 });
  });
});
