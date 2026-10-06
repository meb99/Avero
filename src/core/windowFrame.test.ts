import { describe, expect, it } from "vitest";
import { placeOnScreens } from "./windowFrame";

const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const external = { x: 1440, y: 0, width: 2560, height: 1440 };

describe("placeOnScreens", () => {
  it("leaves a frame on a screen where it is", () => {
    const frame = { x: 1600, y: 100, width: 1200, height: 900 };
    expect(placeOnScreens(frame, [laptop, external])).toEqual(frame);
  });

  it("brings a window back from a monitor that is gone", () => {
    const onExternal = { x: 1600, y: 100, width: 1200, height: 900 };
    const placed = placeOnScreens(onExternal, [laptop]);
    expect(placed.width).toBeLessThanOrEqual(laptop.width);
    expect(placed.height).toBeLessThanOrEqual(laptop.height);
    expect(placed.x).toBeGreaterThanOrEqual(laptop.x);
    expect(placed.x + placed.width).toBeLessThanOrEqual(laptop.x + laptop.width);
    expect(placed.y).toBeGreaterThanOrEqual(laptop.y);
  });

  it("pulls a frame that sticks out back inside and fits it to a smaller screen", () => {
    const placed = placeOnScreens({ x: 1000, y: 0, width: 2000, height: 1200 }, [laptop]);
    expect(placed).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });

  it("keeps the frame when no screens are known", () => {
    const frame = { x: -5000, y: 0, width: 800, height: 600 };
    expect(placeOnScreens(frame, [])).toEqual(frame);
  });
});
