import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { bgaTemplateSvg, templateBlocked } from "../workbench/bgaTemplate";
import { ballGrid, ballPitch, ballPlaces, cornerBall, missingBalls, probePoints, type BallView } from "./bga";
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

describe("ball map views (F42)", () => {
  // A 3 × 3 grid at 20 mil without B2, as a BGA on top or bottom.
  const grid = (side: "top" | "bottom"): BoardModel => {
    const board: Board = structuredClone(testBoard());
    const first = board.pins.length;
    const pins: Pin[] = [];
    for (const [r, row] of ["A", "B", "C"].entries())
      for (let c = 1; c <= 3; c++) {
        if (row === "B" && c === 2) continue;
        pins.push({ part: board.parts.length, number: `${row}${c}`, x: 2000 + (c - 1) * 20, y: 1000 - r * 20, radius: 6, side, net: 0 });
      }
    // Pad the part to the 16 pins a grid needs with balls in rows D and E.
    for (const [r, row] of ["D", "E"].entries())
      for (let c = 1; c <= 4; c++) pins.push({ part: board.parts.length, number: `${row}${c}`, x: 2000 + (c - 1) * 20, y: 1000 - (r + 3) * 20, radius: 6, side, net: 0 });
    board.pins.push(...pins);
    board.parts.push({ name: "U9", side, mount: "smd", firstPin: first, pinCount: pins.length, outline: [], bounds: { minX: 1990, minY: 910, maxX: 2070, maxY: 1010 } });
    board.nets[0].pins.push(...pins.map((_, i) => first + i));
    return new BoardModel(board);
  };

  it("finds the pitch from the file, the design's gaps and A1", () => {
    const model = grid("top");
    const part = model.parts.length - 1;
    const g = ballGrid(model, part)!;
    const pitch = ballPitch(model, g)!;
    expect(pitch.col).toBeCloseTo(20);
    expect(pitch.row).toBeCloseTo(20);
    expect(pitch.consistent).toBe(true);
    expect(missingBalls(g)).toContain("B2");
    expect(model.pins[cornerBall(g)!].number).toBe("A1");
  });

  it("keeps A1 in the right corner when mirrored, turned or on the bottom", () => {
    const model = grid("top");
    const g = ballGrid(model, model.parts.length - 1)!;
    const a1 = cornerBall(g)!;
    const at = (v: BallView, turns = 0, m = model, gg = g, pin = a1) => ballPlaces(m, gg, v, turns).find((b) => b.pin === pin)!;
    // Datasheet top: A1 top left; bottom: top right.
    expect(at("top")).toMatchObject({ x: 0, y: 0 });
    expect(at("bottom")).toMatchObject({ x: 3, y: 0 });
    // The gap is drawn in the datasheet views, not on the board.
    expect(ballPlaces(model, g, "top").some((b) => b.pin === -1 && b.row === "B" && b.col === 2)).toBe(true);
    expect(ballPlaces(model, g, "board").some((b) => b.pin === -1)).toBe(false);
    // A quarter turn clockwise moves top left to top right.
    const turned = ballPlaces(model, g, "top", 1);
    const maxX = Math.max(...turned.map((b) => b.x));
    expect(turned.find((b) => b.pin === a1)!.x).toBe(maxX);
    // On the board, a part on the bottom is seen from below: mirrored left to right.
    const below = grid("bottom");
    const gb = ballGrid(below, below.parts.length - 1)!;
    const a1b = cornerBall(gb)!;
    const xsTop = at("board").x;
    const xsBottom = ballPlaces(below, gb, "board").find((b) => b.pin === a1b)!.x;
    expect(Math.sign(xsTop)).toBe(-Math.sign(xsBottom));
  });

  it("prints a 1:1 template only from even dimensions in the file", () => {
    const model = grid("top");
    const part = model.parts.length - 1;
    const g = ballGrid(model, part)!;
    expect(templateBlocked(model, part, g)).toBeNull();
    const svg = bgaTemplateSvg(model, g, false, 0, { title: "U9", direction: "von oben", pitch: "Pitch", scale: "10 mm", check: "check" });
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).toContain(">A1<");
    expect(svg).toContain("von oben");
    expect(svg).toContain("10 mm");
    // A ball out of place makes the spacing uneven: no template.
    model.pins[model.parts[part].firstPin + 1].x += 9;
    expect(templateBlocked(model, part, g)).toBe("pitch");
    model.parts[part].estimated = true;
    expect(templateBlocked(model, part, g)).toBe("estimated");
  });
});
