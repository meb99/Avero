import { describe, expect, it } from "vitest";
import { applyHomography, homographyFrom4 } from "../workbench/photo";
import { quadWeights } from "./renderer";

describe("perspective texturing weights", () => {
  it("are equal for a parallelogram", () => {
    const w = quadWeights({ x: 0, y: 0 }, { x: 10, y: 2 }, { x: 3, y: 8 }, { x: 13, y: 10 });
    for (const x of w) expect(x).toBeCloseTo(w[0], 9);
  });

  it("put the photo's middle where the perspective puts it", () => {
    const uv = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 10 },
      { x: 20, y: 60 },
      { x: 90, y: 70 },
    ];
    const [qtl, , , qbr] = quadWeights(corners[0], corners[1], corners[2], corners[3]);
    // Where the diagonals cross, the strip's triangle tl–br interpolates along tl→br.
    const h = homographyFrom4(uv, corners)!;
    // Fraction t along tl→br of the crossing; the projective coordinate there:
    const cross = applyHomography(h, { x: 0.5, y: 0.5 });
    const t = Math.hypot(cross.x - corners[0].x, cross.y - corners[0].y) / Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
    const u = ((1 - t) * 0 * qtl + t * 1 * qbr) / ((1 - t) * qtl + t * qbr);
    expect(u).toBeCloseTo(0.5, 6);
  });
});
