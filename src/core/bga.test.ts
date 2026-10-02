import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { ballGrid, probePoints } from "./bga";
import type { Board, Pin } from "./types";
import { testBoard } from "./testBoard";

/** The test board plus a 4×5 BGA whose ball B2 is on PP3V3 (net 0). */
function withBga(): BoardModel {
  const board: Board = structuredClone(testBoard());
  const firstPin = board.pins.length;
  const rows = ["A", "B", "C", "D"];
  for (const [r, row] of rows.entries())
    for (let col = 1; col <= 5; col++) {
      const net = row === "B" && col === 2 ? 0 : 1;
      const pin: Pin = { part: board.parts.length, number: `${row}${col}`, x: 300 + col * 10, y: 300 - r * 10, radius: 3, side: "top", net };
      board.pins.push(pin);
      board.nets[net].pins.push(board.pins.length - 1);
    }
  board.parts.push({ name: "U99", side: "top", mount: "smd", firstPin, pinCount: 20, outline: [], bounds: { minX: 300, minY: 260, maxX: 360, maxY: 310 } });
  return new BoardModel(board);
}

describe("ballGrid", () => {
  it("lays out balls by row letter and column", () => {
    const model = withBga();
    const grid = ballGrid(model, model.findPart("U99")!)!;
    expect(grid.rows).toEqual(["A", "B", "C", "D"]);
    expect(grid.cols).toBe(5);
    expect(model.pins[grid.balls.get("B|2")!].number).toBe("B2");
  });

  it("is null for parts with numbered pins", () => {
    const model = withBga();
    expect(ballGrid(model, model.findPart("R1")!)).toBeNull();
  });
});

describe("probePoints", () => {
  it("lists test points first, then small parts nearest first", () => {
    const model = withBga();
    const points = probePoints(model, 0, model.findPart("U99")!);
    expect(points[0].kind).toBe("testPoint");
    expect(points.filter((p) => p.kind === "part").map((p) => p.name)).toContain("R1");
    expect(points.some((p) => p.name === "U99")).toBe(false);
  });
});
