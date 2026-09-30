import { describe, expect, it } from "vitest";
import { PageCamera } from "./pageCamera";

function camera(): PageCamera {
  const c = new PageCamera();
  c.width = 1000;
  c.height = 600;
  return c;
}

describe("PageCamera", () => {
  it("fits a landscape page", () => {
    const c = camera();
    c.fitPage(1190, 842, 0);
    expect(c.scale).toBeCloseTo(600 / 842);
    // Horizontally centered.
    const left = c.toScreen(0, 0).x;
    const right = c.toScreen(1190, 0).x;
    expect(left + right).toBeCloseTo(1000);
  });

  it("zooms around the cursor", () => {
    const c = camera();
    c.scale = 2;
    const before = c.toPage(300, 200);
    c.zoomAt(300, 200, 3);
    const after = c.toPage(300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("centers a word without zooming past the requested scale", () => {
    const c = camera();
    c.center({ x0: 100, y0: 100, x1: 140, y1: 110 }, 3);
    expect(c.scale).toBe(3);
    const mid = c.toScreen(120, 105);
    expect(mid.x).toBeCloseTo(500);
    expect(mid.y).toBeCloseTo(300);
  });
});
