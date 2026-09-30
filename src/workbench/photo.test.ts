import { describe, expect, it } from "vitest";
import { alignPhoto, applyAffine, parsePhoto, type Affine } from "./photo";

// Ground truth: scale 0.5 mil/px, rotated 30°, shifted.
function truth(side: "top" | "bottom"): Affine {
  const s = 0.5;
  const r = Math.PI / 6;
  const [c, n] = [Math.cos(r) * s, Math.sin(r) * s];
  // Top photos are mirrored against the board (pixel Y down, board Y up).
  const f = side === "top" ? -1 : 1;
  return [c, n, -n * f, c * f, 1200, 800];
}

describe("alignPhoto", () => {
  for (const side of ["top", "bottom"] as const) {
    it(`recovers the transform of a ${side} photo from two points`, () => {
      const m = truth(side);
      const photo = [
        { x: 400, y: 300 },
        { x: 3100, y: 2200 },
      ] as [{ x: number; y: number }, { x: number; y: number }];
      const board = [applyAffine(m, photo[0]), applyAffine(m, photo[1])] as typeof photo;
      const fitted = alignPhoto(side, photo, board)!;
      const probe = { x: 1777, y: 123 };
      const want = applyAffine(m, probe);
      const got = applyAffine(fitted, probe);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    });
  }

  it("refuses coincident points", () => {
    const p = { x: 1, y: 1 };
    expect(alignPhoto("top", [p, p], [p, { x: 5, y: 5 }])).toBeNull();
  });
});

describe("parsePhoto", () => {
  it("validates stored photos", () => {
    expect(parsePhoto({ file: "/a.jpg", matrix: [1, 0, 0, 1, 0, 0], opacity: 3 })).toEqual({
      file: "/a.jpg",
      matrix: [1, 0, 0, 1, 0, 0],
      opacity: 1,
    });
    expect(parsePhoto({ file: "/a.jpg", matrix: [1, 0, 0] })).toBeUndefined();
    expect(parsePhoto(null)).toBeUndefined();
  });
});
