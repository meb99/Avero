import { describe, expect, it } from "vitest";
import { Camera } from "./camera";

function camera(): Camera {
  const c = new Camera();
  c.width = 800;
  c.height = 600;
  c.centerX = 1000;
  c.centerY = 500;
  c.scale = 2;
  return c;
}

describe("Camera", () => {
  it("puts the center in the middle of the screen with Y pointing down", () => {
    const c = camera();
    expect(c.toScreen({ x: 1000, y: 500 })).toEqual({ x: 400, y: 300 });
    expect(c.toScreen({ x: 1010, y: 510 })).toEqual({ x: 420, y: 280 });
  });

  it("mirrors left-right for the bottom side", () => {
    const c = camera();
    c.mirrored = true;
    expect(c.toScreen({ x: 1010, y: 500 }).x).toBe(380);
  });

  it("rotates clockwise in quarter turns", () => {
    const c = camera();
    c.rotation = 1;
    // A point to the right of the center ends up below it.
    const p = c.toScreen({ x: 1010, y: 500 });
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(320);
  });

  it("round-trips through every orientation", () => {
    for (let r = 0; r < 4; r++) {
      for (const mirrored of [false, true]) {
        const c = camera();
        c.rotation = r;
        c.mirrored = mirrored;
        const w = { x: 1234.5, y: -87.25 };
        const back = c.toWorld(c.toScreen(w));
        expect(back.x).toBeCloseTo(w.x);
        expect(back.y).toBeCloseTo(w.y);
      }
    }
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const c = camera();
    const cursor = { x: 123, y: 456 };
    const before = c.toWorld(cursor);
    c.zoomAt(cursor, 3.7);
    const after = c.toWorld(cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("fits bounds, accounting for rotation", () => {
    const c = camera();
    c.fit({ minX: 0, minY: 0, maxX: 2000, maxY: 100 }, 0);
    expect(c.scale).toBeCloseTo(0.4);
    c.rotation = 1;
    c.fit({ minX: 0, minY: 0, maxX: 2000, maxY: 100 }, 0);
    expect(c.scale).toBeCloseTo(0.3);
  });
});
