import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import { alignPhoto, applyAffine, invertAffine, partAtPoint, parsePhoto, photoScale, type Affine } from "./photo";

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

describe("invertAffine", () => {
  it("maps board points back to the photo", () => {
    const m = truth("top");
    const inv = invertAffine(m)!;
    const p = { x: 0.37, y: 0.21 };
    const back = applyAffine(inv, applyAffine(m, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(photoScale(m)).toBeCloseTo(0.5, 9);
  });

  it("refuses a degenerate matrix", () => {
    expect(invertAffine([0, 0, 0, 0, 1, 1])).toBeNull();
  });
});

describe("partAtPoint", () => {
  const model = new BoardModel(testBoard());

  it("finds the part under a point on the visible side", () => {
    expect(partAtPoint(model, { x: 120, y: 100 }, "top", 20).inside).toBe(model.findPart("R1"));
    // U10 is on the bottom: not on a photo of the top side.
    expect(partAtPoint(model, { x: 450, y: 250 }, "top", 20).inside).toBeUndefined();
    expect(partAtPoint(model, { x: 450, y: 250 }, "bottom", 20).inside).toBe(model.findPart("U10"));
  });

  it("falls back to the closest part when the click is a little off", () => {
    const hit = partAtPoint(model, { x: 180, y: 100 }, "top", 20);
    expect(hit.inside).toBeUndefined();
    expect(hit.near).toBe(model.findPart("R1"));
    expect(partAtPoint(model, { x: 300, y: 400 }, "top", 20)).toEqual({ inside: undefined, near: undefined });
  });
});
