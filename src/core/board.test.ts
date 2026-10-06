import { describe, expect, it } from "vitest";
import { BoardModel, netSides } from "./board";
import { search } from "./search";
import { testBoard } from "./testBoard";
import { computeStyle } from "../render/style";
import { DARK } from "../render/palette";

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

  it("buried vias are selectable with their inner copper, not as surface contacts", () => {
    const board = testBoard();
    board.testPoints.push({ kind: "via", x: 800, y: 500, radius: 4, side: "both", net: 1,
      via: { layers: ["LAYER_2", "LAYER_3"], drill: 2, buried: true } });
    board.layers = [{ name: "LAYER_2", side: "both" }, { name: "LAYER_3", side: "both" }];
    board.nets[1].testPoints.push(1);
    const model = new BoardModel(board);
    const at = { x: 800, y: 500 };
    expect(model.hitTest(at, "top", 2, true, false)).toBeUndefined();
    expect(model.hitTest(at, "top", 2, true, true, new Set([0, 1]))).toBeUndefined();
    expect(model.hitTest(at, "top", 2, true, true, new Set([0]))).toEqual({ kind: "testPoint", testPoint: 1 });
    const options = { ghostOtherSide: true, showVias: true, showTraces: false, dimUnselected: false };
    expect(computeStyle(model, "top", { kind: "net", net: 1 }, options, DARK).testPointColors[7]).toBe(0);
    expect(computeStyle(model, "top", { kind: "net", net: 1 }, { ...options, showTraces: true, hiddenLayers: new Set([0, 1]) }, DARK).testPointColors[7]).toBe(0);
    expect(computeStyle(model, "top", { kind: "none" }, { ...options, showTraces: true }, DARK).testPointColors[7]).toBeGreaterThan(0);
    board.nets[1].pins = [];
    expect(netSides(model, 1)).toBeUndefined();
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

describe("own net names", () => {
  it("renames nets, keeps the file name findable and can undo", () => {
    const model = new BoardModel(structuredClone(testBoard()));
    const i = model.findNet("PP3V3")!;
    expect(model.applyNetNames({ PP3V3: "PP3V3_MAIN" })).toBe(true);
    expect(model.nets[i].name).toBe("PP3V3_MAIN");
    expect(model.findNet("pp3v3_main")).toBe(i);
    expect(model.findNet("PP3V3")).toBe(i);
    expect(model.fileNetName(i)).toBe("PP3V3");
    expect(model.applyNetNames({ PP3V3: "PP3V3_MAIN" })).toBe(false);
    expect(model.applyNetNames({})).toBe(true);
    expect(model.nets[i].name).toBe("PP3V3");
  });
});

describe("search for a pin that is not there", () => {
  it("offers the part", () => {
    const part = model.parts[0].name;
    const [hit] = search(model, `${part}.ZZ9`);
    expect(hit).toMatchObject({ kind: "part", label: part });
  });
});
