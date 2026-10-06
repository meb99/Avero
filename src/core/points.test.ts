import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { findPoint, pinKey, pointOf } from "./points";
import { testBoard } from "./testBoard";

describe("measuring points", () => {
  const model = new BoardModel(testBoard());

  it("names pins and test points so they are found again", () => {
    for (let pin = 0; pin < model.pins.length; pin++) {
      const p = pointOf(model, { kind: "pin", pin })!;
      expect(p.id).toBe(model.pinLabel(pin));
      expect(findPoint(model, p.id)).toEqual({ kind: "pin", pin });
    }
    model.testPoints.forEach((_, testPoint) => {
      const p = pointOf(model, { kind: "testPoint", testPoint })!;
      expect(findPoint(model, p.id)).toEqual({ kind: "testPoint", testPoint });
    });
    expect(findPoint(model, "NOPE.1")).toBeUndefined();
  });
});

describe("pins of the same name", () => {
  it("stay addressable one by one", async () => {
    const { BoardModel } = await import("./board");
    const { testBoard } = await import("./testBoard");
    const board = testBoard();
    // Two pins of part 0 named alike, as boards with "GND" pins have them.
    const p0 = board.parts[0];
    expect(p0.pinCount).toBeGreaterThanOrEqual(2);
    board.pins[p0.firstPin].number = "GND";
    board.pins[p0.firstPin + 1].number = "GND";
    const model = new BoardModel(board);
    const a = pointOf(model, { kind: "pin", pin: p0.firstPin })!;
    const b = pointOf(model, { kind: "pin", pin: p0.firstPin + 1 })!;
    expect(a.id).toBe(`${p0.name}.GND#1`);
    expect(b.id).toBe(`${p0.name}.GND#2`);
    expect(findPoint(model, b.id)).toEqual({ kind: "pin", pin: p0.firstPin + 1 });
    expect(pinKey(model, p0.firstPin + 1)).toBe(b.id);
  });
});
