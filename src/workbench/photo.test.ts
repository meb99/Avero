import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import {
  alignFromPoints,
  alignPhoto,
  applyAffine,
  applyHomography,
  boardToPhoto,
  contentBox,
  fitToBounds,
  homographyFrom4,
  invertAffine,
  partAtPoint,
  parsePhoto,
  photoCorners,
  photoScale,
  photoToBoard,
  type Affine,
  type Homography,
} from "./photo";

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

describe("contentBox and fitToBounds", () => {
  // 200 × 100 grey picture with a green board from (20, 10) to (180, 90).
  const width = 200;
  const height = 100;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const board = x >= 20 && x < 180 && y >= 10 && y < 90;
      rgba.set(board ? [30, 140, 90, 255] : [200, 205, 200, 255], i);
    }

  it("finds the board in a picture with a margin", () => {
    expect(contentBox(rgba, width, height)).toEqual({ x0: 20, y0: 10, x1: 180, y1: 90 });
  });

  it("lays the picture onto the board outline", () => {
    const bounds = { minX: 0, minY: 0, maxX: 16000, maxY: 8000 };
    const m = fitToBounds({ x0: 20, y0: 10, x1: 180, y1: 90 }, width, bounds)!;
    // Top-left of the board in the picture → top-left of the board (max Y).
    const tl = applyAffine(m, { x: 20 / width, y: 10 / width });
    expect(tl.x).toBeCloseTo(0, 6);
    expect(tl.y).toBeCloseTo(8000, 6);
    const br = applyAffine(m, { x: 180 / width, y: 90 / width });
    expect(br.x).toBeCloseTo(16000, 6);
    expect(br.y).toBeCloseTo(0, 6);
  });

  it("refuses pictures of another shape", () => {
    expect(fitToBounds({ x0: 0, y0: 0, x1: 100, y1: 100 }, 100, { minX: 0, minY: 0, maxX: 16000, maxY: 8000 })).toBeNull();
  });
});

describe("alignment by three and four points", () => {
  const photo = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.15 },
    { x: 0.85, y: 0.6 },
    { x: 0.12, y: 0.55 },
  ];

  it("recovers an affine transform from three points", () => {
    const m: Affine = [1200, -30, 80, -900, 500, 7000];
    const board = photo.map((p) => applyAffine(m, p));
    const got = alignFromPoints("top", photo.slice(0, 3), board.slice(0, 3))!;
    expect(got.perspective).toBeUndefined();
    got.matrix.forEach((x, i) => expect(x).toBeCloseTo(m[i], 6));
  });

  it("recovers a perspective transform from four points and inverts it", () => {
    const h: Homography = [1000, 50, 200, -40, -950, 6000, 0.3, -0.2, 1];
    const board = photo.map((p) => applyHomography(h, p));
    const got = alignFromPoints("top", photo, board)!;
    expect(got.perspective).toBeDefined();
    const test = { x: 0.5, y: 0.4 };
    const b = photoToBoard(got, test);
    const want = applyHomography(h, test);
    expect(b.x).toBeCloseTo(want.x, 4);
    expect(b.y).toBeCloseTo(want.y, 4);
    const back = boardToPhoto(got)!(b);
    expect(back.x).toBeCloseTo(test.x, 8);
    expect(back.y).toBeCloseTo(test.y, 8);
    // The corners follow the perspective, not the affine part.
    const corners = photoCorners(got, 1, 0.7);
    expect(corners[3].x).toBeCloseTo(applyHomography(h, { x: 1, y: 0.7 }).x, 4);
  });

  it("refuses points on one line", () => {
    const line = [0, 1, 2, 3].map((i) => ({ x: i * 0.1, y: i * 0.1 }));
    expect(homographyFrom4(line, photo)).toBeNull();
    expect(alignFromPoints("top", line.slice(0, 3), photo.slice(0, 3))).toBeNull();
  });

  it("keeps a stored perspective", () => {
    const h = [1, 0, 0, 0, 1, 0, 0.1, 0, 1];
    expect(parsePhoto({ file: "a.jpg", matrix: [1, 0, 0, 1, 0, 0], perspective: h })?.perspective).toEqual(h);
    expect(parsePhoto({ file: "a.jpg", matrix: [1, 0, 0, 1, 0, 0], perspective: [1, 2] })?.perspective).toBeUndefined();
  });
});
