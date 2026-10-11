import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { linkedNets } from "./links";
import { testBoard } from "./testBoard";

// PP3V3 (0) – L5 (1uH) – PP3V3_L (4) – R9 (0R) – PP3V3_R (5)
const model = new BoardModel(testBoard());
const part = (name: string) => model.findPart(name)!;

describe("linked nets in levels, as FlexBV's", () => {
  it("level 1 is the net alone", () => {
    const l = linkedNets(model, 0, 1);
    expect([...l.nets]).toEqual([]);
    expect(l.parts.size).toBe(0);
  });

  it("level 2 goes one link part further", () => {
    const l = linkedNets(model, 0, 2);
    expect([...l.nets]).toEqual([[4, 1]]);
    expect([...l.parts]).toEqual([part("L5")]);
  });

  it("level 3 goes two link parts further", () => {
    const l = linkedNets(model, 0, 3);
    expect(new Map(l.nets)).toEqual(new Map([[4, 1], [5, 2]]));
    expect(new Set(l.parts)).toEqual(new Set([part("L5"), part("R9")]));
  });

  it("does not pass ground or a part that is no link", () => {
    // GND (1) reaches R1 and U10, neither of them a link part.
    const l = linkedNets(model, 1, 3);
    expect(l.nets.size).toBe(0);
  });
});
