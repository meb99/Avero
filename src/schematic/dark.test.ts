import { describe, expect, it } from "vitest";
import { darkPixels } from "./SchematicView";

describe("dark schematic pages", () => {
  it("turns paper dark and ink light, keeping colours", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 200, 255]);
    darkPixels(px);
    expect([...px.slice(0, 3)]).toEqual([27, 29, 34]); // white paper
    expect([...px.slice(4, 7)]).toEqual([235, 235, 235]); // black ink
    // Red stays red: strongest channel red, the others low.
    expect(px[8]).toBeGreaterThan(200);
    expect(px[9]).toBeLessThan(40);
    // Dark blue becomes a lighter blue.
    expect(px[14]).toBeGreaterThan(px[12]);
    expect(px[14]).toBeGreaterThan(200);
    expect(px[3]).toBe(255);
  });
});
