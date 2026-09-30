import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { search } from "./search";
import { testBoard } from "./testBoard";

const model = new BoardModel(testBoard());

describe("BoardModel.hitTest", () => {
  it("finds pins on the visible side only", () => {
    expect(model.hitTest({ x: 101, y: 99 }, "top", 2, true)).toEqual({ kind: "pin", pin: 0 });
    expect(model.hitTest({ x: 400, y: 200 }, "top", 2, true)).toBeUndefined();
    expect(model.hitTest({ x: 400, y: 200 }, "bottom", 2, true)).toEqual({ kind: "pin", pin: 2 });
  });

  it("falls back to the part body", () => {
    expect(model.hitTest({ x: 450, y: 250 }, "bottom", 2, true)).toEqual({ kind: "part", part: 1 });
  });

  it("finds test points", () => {
    expect(model.hitTest({ x: 705, y: 400 }, "bottom", 2, true)).toEqual({ kind: "testPoint", testPoint: 0 });
  });
});

describe("BoardModel selection helpers", () => {
  it("does not highlight the unconnected net", () => {
    expect(model.selectedNet({ kind: "pin", pin: 0 })).toBe(0);
    expect(model.selectedNet({ kind: "pin", pin: 5 })).toBeUndefined();
  });

  it("groups net members by part", () => {
    // L5, R1, U10
    expect(model.netMembers(0)).toEqual([
      { part: 2, pins: [6] },
      { part: 0, pins: [0] },
      { part: 1, pins: [2] },
    ]);
  });

  it("follows nets through coils and 0 Ω resistors", () => {
    expect(model.isSeriesPart(2)).toBe(true);
    expect(model.isSeriesPart(3)).toBe(true);
    expect(model.isSeriesPart(0)).toBe(false); // R1 is 10k
    const links = model.seriesLinks(0).map((l) => [model.nets[l.net].name, model.parts[l.via].name]);
    expect(links).toEqual([
      ["PP3V3_L", "L5"],
      ["PP3V3_R", "R9"],
    ]);
  });

  it("links every pin of a net with a spanning tree", () => {
    const edges = model.ratsnest(0);
    expect(edges).toHaveLength(2);
    const touched = new Set(edges.flat());
    expect([...touched].sort()).toEqual([0, 2, 6]);
  });

  it("sorts unconnected nets last", () => {
    expect(model.nets[model.sortedNets[model.sortedNets.length - 1]].name).toBe("UNCONNECTED");
  });
});

describe("search", () => {
  it("resolves pin references", () => {
    for (const q of ["U10.A3", "u10:a3", "U10 A3"]) {
      expect(search(model, q)[0]).toMatchObject({ kind: "pin", selection: { kind: "pin", pin: 4 } });
    }
  });

  it("ranks exact before prefix before substring", () => {
    const labels = search(model, "1").map((r) => r.label);
    expect(labels).toEqual(["R1", "U10"]);
    expect(search(model, "sda")[0]).toMatchObject({ kind: "net", label: "I2C_SDA" });
  });

  it("never offers the unconnected net", () => {
    expect(search(model, "UNCON")).toEqual([]);
  });
});
