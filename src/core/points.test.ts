import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { findPoint, pointOf } from "./points";
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
