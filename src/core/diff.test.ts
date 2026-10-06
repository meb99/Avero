import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { alignedToA, alignedToB, alignmentMatters, diffBoards, matchNets, netNamesOnB } from "./diff";
import { testBoard } from "./testBoard";
import type { Board, Pin } from "./types";

/** The board with every position moved by (dx, dy). */
function shifted(board: Board, dx: number, dy: number): Board {
  const b = structuredClone(board);
  const move = (p: { x: number; y: number }) => {
    p.x += dx;
    p.y += dy;
  };
  for (const part of b.parts) {
    part.outline.forEach(move);
    part.bounds = { minX: part.bounds.minX + dx, maxX: part.bounds.maxX + dx, minY: part.bounds.minY + dy, maxY: part.bounds.maxY + dy };
  }
  b.pins.forEach(move);
  b.testPoints.forEach(move);
  return b;
}

describe("diffBoards", () => {
  it("finds nothing between a board and itself", () => {
    const d = diffBoards(new BoardModel(testBoard()), new BoardModel(testBoard()));
    expect(d.onlyA.length + d.onlyB.length + d.changed.length + d.pins.length + d.netsOnlyA.length + d.netsOnlyB.length).toBe(0);
    expect(d.same).toBe(testBoard().parts.length);
  });

  it("reports added, removed and changed parts, re-routed pins and new nets", () => {
    const a = new BoardModel(testBoard());
    const board = structuredClone(testBoard());
    board.parts[0].device = "10K 0402"; // R1 changed value
    board.parts[3].name = "R99"; // R9 gone, R99 new
    // R1 pin 1 now on I2C_SDA instead of PP3V3.
    const sda = board.nets.findIndex((n) => n.name === "I2C_SDA");
    board.pins[board.parts[0].firstPin].net = sda;
    board.nets.push({ name: "NEW_NET", kind: "signal", pins: [], testPoints: [] });
    const d = diffBoards(a, new BoardModel(board));
    expect(d.changed.find((c) => c.name === "R1")?.changes).toContain("device");
    expect(d.onlyA.map((c) => c.name)).toContain("R9");
    expect(d.onlyB.map((c) => c.name)).toContain("R99");
    expect(d.pins).toContainEqual(expect.objectContaining({ part: "R1", netA: "PP3V3", netB: "I2C_SDA" }));
  });

  it("sees other pin numbers and rewired parts as changes", () => {
    const a = new BoardModel(testBoard());
    const renumbered = structuredClone(testBoard());
    renumbered.pins[renumbered.parts[0].firstPin].number = "3";
    expect(diffBoards(a, new BoardModel(renumbered)).changed.find((c) => c.name === "R1")?.changes).toContain("pins");
    const rewired = structuredClone(testBoard());
    const sda = rewired.nets.findIndex((n) => n.name === "I2C_SDA");
    rewired.pins[rewired.parts[0].firstPin].net = sda;
    const d = diffBoards(a, new BoardModel(rewired));
    expect(d.changed.find((c) => c.name === "R1")?.changes).toEqual(["nets"]);
    expect(d.same).toBe(testBoard().parts.length - 1);
  });

  it("takes a renamed net with the same pins as no electrical change", () => {
    const board = structuredClone(testBoard());
    board.nets[4].name = "PP3V3_LX";
    const d = diffBoards(new BoardModel(testBoard()), new BoardModel(board));
    expect(d.renamed).toEqual([{ a: "PP3V3_L", b: "PP3V3_LX" }]);
    expect(d.pins).toEqual([]);
    expect(d.netsOnlyA).toEqual([]);
    expect(d.netsOnlyB).toEqual([]);
    expect(d.netChanges).toEqual([]);
    expect(d.same).toBe(testBoard().parts.length);
  });

  it("flags a net of the same name with other pins", () => {
    const board = structuredClone(testBoard());
    // L5.2 from PP3V3_L to GND.
    board.pins[7].net = 1;
    const d = diffBoards(new BoardModel(testBoard()), new BoardModel(board));
    expect(d.netChanges).toContainEqual({ name: "PP3V3_L", added: [], removed: ["L5.2"] });
    expect(d.netChanges).toContainEqual({ name: "GND", added: ["L5.2"], removed: [] });
    expect(d.pins).toEqual([expect.objectContaining({ part: "L5", pin: "2", netA: "PP3V3_L", netB: "GND" })]);
    expect(d.renamed).toEqual([]);
  });

  it("matches a net renamed and changed on most of its pins", () => {
    const board = structuredClone(testBoard());
    board.nets[0].name = "PP3V3_S0";
    // R9.2 joins it (PP3V3_R is left with no pins).
    board.pins[9].net = 0;
    const m = matchNets(new BoardModel(testBoard()), new BoardModel(board));
    expect(m.changed).toContainEqual({ name: "PP3V3", renamedTo: "PP3V3_S0", added: ["R9.2"], removed: [] });
    expect(m.map.get(0)).toBe(0);
    const d = diffBoards(new BoardModel(testBoard()), new BoardModel(board));
    // Only R9.2 moved; R1.1, U10.1 and L5.1 are on the same net under its new name.
    expect(d.pins.map((p) => `${p.part}.${p.pin}`)).toEqual(["R9.2"]);
    expect(d.netsOnlyB).toEqual([]);
  });

  it("lines the boards up on the parts both have before calling a part moved", () => {
    const a = new BoardModel(testBoard());
    const d = diffBoards(a, new BoardModel(shifted(testBoard(), 500, -200)));
    expect(d.changed).toEqual([]);
    expect(d.aligned?.dx).toBeCloseTo(-500);
    expect(d.aligned?.dy).toBeCloseTo(200);
    expect(alignmentMatters(d.aligned)).toBe(true);
    expect(alignmentMatters(diffBoards(a, new BoardModel(testBoard())).aligned)).toBe(false);
  });

  it("still sees the one part that really moved", () => {
    const board = shifted(testBoard(), 300, 0);
    const r9 = board.parts[3];
    r9.bounds = { ...r9.bounds, minY: r9.bounds.minY + 200, maxY: r9.bounds.maxY + 200 };
    for (const p of board.pins.slice(8, 10)) p.y += 200;
    // A fifth part, so the fit has enough that stayed.
    const d = diffBoards(new BoardModel(testBoard()), new BoardModel(board));
    expect(d.changed.map((c) => [c.name, c.changes])).toEqual([["R9", ["moved"]]]);
  });

  it("maps points both ways", () => {
    const al = { angle: 0.3, scale: 1.2, dx: 40, dy: -7 };
    const p = alignedToB(al, alignedToA(al, { x: 123, y: -45 }));
    expect(p.x).toBeCloseTo(123);
    expect(p.y).toBeCloseTo(-45);
  });

  it("takes two nets that swapped names as two renamings, not as changes", () => {
    // U1.1 and R1.1 on NET_A, U1.2 and R1.2 on NET_B; on B the names are swapped.
    const pin = (part: number, number: string, net: number): Pin => ({ part, number, x: part * 100 + Number(number) * 10, y: 0, radius: 5, side: "top", net });
    const board = (first: string, second: string): Board => ({
      ...testBoard(),
      parts: [
        { name: "U1", side: "top", mount: "smd", firstPin: 0, pinCount: 2, outline: [], bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 } },
        { name: "R1", side: "top", mount: "smd", firstPin: 2, pinCount: 2, outline: [], bounds: { minX: 100, minY: 0, maxX: 130, maxY: 10 } },
      ],
      pins: [pin(0, "1", 0), pin(0, "2", 1), pin(1, "1", 0), pin(1, "2", 1)],
      testPoints: [],
      nets: [
        { name: first, kind: "signal", pins: [0, 2], testPoints: [] },
        { name: second, kind: "signal", pins: [1, 3], testPoints: [] },
      ],
    });
    const a = new BoardModel(board("NET_A", "NET_B"));
    const b = new BoardModel(board("NET_B", "NET_A"));
    const d = diffBoards(a, b);
    expect(d.renamed).toEqual([
      { a: "NET_A", b: "NET_B" },
      { a: "NET_B", b: "NET_A" },
    ]);
    expect(d.netChanges).toEqual([]);
    expect(d.pins).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.netsOnlyA).toEqual([]);
    expect(d.netsOnlyB).toEqual([]);
    // Readings follow the pins: A's NET_A is B's NET_B.
    const onB = netNamesOnB(a, b, d.netMap);
    expect(onB("NET_A")).toBe("NET_B");
    expect(onB("NET_B")).toBe("NET_A");
  });

  it("pairs a net with the one holding most of its pins before one of the same name", () => {
    const board = structuredClone(testBoard());
    // B: PP3V3 (R1.1, U10.1, L5.1) is now called GND and gains R9.2; the old GND pins are called PP3V3.
    board.nets[0].name = "GND";
    board.nets[1].name = "PP3V3";
    board.pins[9].net = 0;
    const d = diffBoards(new BoardModel(testBoard()), new BoardModel(board));
    expect(d.renamed).toEqual([{ a: "GND", b: "PP3V3" }]);
    expect(d.netChanges).toEqual([
      { name: "PP3V3", renamedTo: "GND", added: ["R9.2"], removed: [] },
      // R9.2 was PP3V3_R's only pin.
      { name: "PP3V3_R", added: [], removed: ["R9.2"] },
    ]);
    expect(d.pins.map((p) => `${p.part}.${p.pin}`)).toEqual(["R9.2"]);
  });
});
