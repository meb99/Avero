import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { jumperTargets } from "./jumper";
import { testBoard } from "./testBoard";

describe("jumperTargets", () => {
  const model = new BoardModel(testBoard());

  it("offers the nearest other points of the net, same side first", () => {
    // Pin 0 is R1.1 on PP3V3, which also reaches U10 and a test point.
    const targets = jumperTargets(model, 0);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => !(t.kind === "pin" && model.pins[t.index].part === model.pins[0].part))).toBe(true);
    const sides = targets.map((t) => t.sameSide);
    expect(sides).toEqual([...sides].sort((a, b) => Number(b) - Number(a)));
  });

  it("has nothing for ground", () => {
    const ground = model.nets.findIndex((n) => n.kind === "ground");
    expect(jumperTargets(model, model.nets[ground].pins[0])).toEqual([]);
  });
});
