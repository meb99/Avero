import { describe, expect, it } from "vitest";
import { MILS_PER_MM } from "../core/types";
import { gridLines, gridStep } from "./grid";

describe("grid", () => {
  it("picks round steps that stay readable at any zoom", () => {
    // 1 px per mil: 14 px apart needs 25 mil, or 0.5 mm (19.7 mil).
    expect(gridStep(1, "mil")).toEqual({ step: 25, major: 4 });
    expect(gridStep(1, "mm").step).toBeCloseTo(0.5 * MILS_PER_MM);
    expect(gridStep(1, "mm").major).toBe(2);
    // Zoomed far out: the coarsest step.
    expect(gridStep(0.001, "mm").step).toBeCloseTo(50 * MILS_PER_MM);
    expect(gridStep(0.1, "mil")).toEqual({ step: 250, major: 4 });
    expect(gridStep(0.2, "mil")).toEqual({ step: 100, major: 10 });
  });

  it("runs its lines through the board's own origin", () => {
    const { xs, ys } = gridLines({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, { x: 13, y: 7 }, 25);
    expect(xs).toEqual([13, 38, 63, 88]);
    expect(ys).toEqual([7, 32]);
  });

  it("draws nothing rather than thousands of lines", () => {
    expect(gridLines({ minX: 0, minY: 0, maxX: 1e6, maxY: 10 }, { x: 0, y: 0 }, 1).xs).toEqual([]);
  });
});
