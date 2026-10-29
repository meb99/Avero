import { describe, expect, it } from "vitest";
import { Camera } from "./camera";
import { bottomCamera, boundsToLayout, dualLayout, fromLayout, sideAt, toLayout } from "./dualView";

const wide = { minX: 0, minY: 0, maxX: 4000, maxY: 2000 };
const tall = { minX: 100, minY: 0, maxX: 2500, maxY: 4400 };

describe("dualLayout", () => {
  it("puts the bottom side below a wide board and beside a tall one", () => {
    expect(dualLayout(wide).offset).toEqual({ x: 0, y: -2200 });
    expect(dualLayout(wide).bounds).toEqual({ minX: 0, minY: -2200, maxX: 4000, maxY: 2000 });
    expect(dualLayout(tall).offset.x).toBeCloseTo(2400 + 220, 6);
    expect(dualLayout(tall).offset.y).toBe(0);
  });

  it("mirrors the bottom side as if the board were turned over", () => {
    const l = dualLayout(wide);
    // The left edge seen from below is on the right.
    expect(toLayout({ x: 0, y: 500 }, "bottom", l)).toEqual({ x: 4000, y: -1700 });
    expect(toLayout({ x: 0, y: 500 }, "top", l)).toEqual({ x: 0, y: 500 });
    const p = { x: 1234, y: 567 };
    expect(fromLayout(toLayout(p, "bottom", l), "bottom", l)).toEqual(p);
    expect(boundsToLayout(wide, "bottom", l)).toEqual({ minX: 0, minY: -2200, maxX: 4000, maxY: -200 });
  });

  it("turns the bottom side over as the single view does, or not at all", () => {
    const over = dualLayout(wide, "topBottom");
    const through = dualLayout(wide, "none");
    // Turned over the X-axis the lower edge is on top; seen through the top nothing moves.
    expect(toLayout({ x: 0, y: 500 }, "bottom", over)).toEqual({ x: 0, y: -700 });
    expect(toLayout({ x: 0, y: 500 }, "bottom", through)).toEqual({ x: 0, y: -1700 });
    for (const l of [over, through]) {
      const p = { x: 1234, y: 567 };
      expect(fromLayout(toLayout(p, "bottom", l), "bottom", l)).toEqual(p);
      // The bottom side takes the same place whichever way it is turned.
      expect(boundsToLayout(wide, "bottom", l)).toEqual({ minX: 0, minY: -2200, maxX: 4000, maxY: -200 });
      expect(l.bounds).toEqual(dualLayout(wide).bounds);
    }
  });

  for (const flip of ["leftRight", "topBottom", "none"] as const) {
    for (const rotation of [0, 1, 2, 3]) {
      it(`draws bottom points where the layout camera shows them (${flip}, rotation ${rotation})`, () => {
        const l = dualLayout(tall, flip);
        const master = Object.assign(new Camera(), { centerX: 1700, centerY: 900, scale: 0.37, rotation, width: 1200, height: 800 });
        const cam = bottomCamera(master, l);
        for (const p of [{ x: 100, y: 0 }, { x: 2000, y: 3000 }, { x: 777, y: 1234 }]) {
          const a = cam.toScreen(p);
          const b = master.toScreen(toLayout(p, "bottom", l));
          expect(a.x).toBeCloseTo(b.x, 6);
          expect(a.y).toBeCloseTo(b.y, 6);
        }
        // Mirrored text and pins only where the side is turned over.
        expect(cam.mirrored).toBe(flip !== "none");
      });
    }
  }

  it("tells which side a layout point is on", () => {
    const l = dualLayout(wide);
    expect(sideAt({ x: 100, y: 100 }, l)).toBe("top");
    expect(sideAt({ x: 100, y: -1000 }, l)).toBe("bottom");
    expect(sideAt({ x: 100, y: -50 }, l)).toBe("top");
    expect(sideAt({ x: 100, y: -150 }, l)).toBe("bottom");
  });
});
