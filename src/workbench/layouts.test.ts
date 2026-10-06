import { describe, expect, it } from "vitest";
import { PRESETS, paneWeights, parseLayout, parseLayouts, sidebarPixels, withLayout } from "./layouts";

describe("layouts", () => {
  it("keeps shares and weights, not pixels, so a layout fits another screen", () => {
    const layout = { ...PRESETS.repair, sidebarShare: 0.25 };
    expect(sidebarPixels(layout, 1440, 340)).toBe(360);
    // A smaller screen: the same share, never wider than half the window.
    expect(sidebarPixels(layout, 1024, 340)).toBe(256);
    expect(sidebarPixels({ ...layout, sidebarShare: 0.5 }, 600, 340)).toBe(300);
    expect(sidebarPixels({ ...layout, sidebarShare: undefined }, 1440, 340)).toBe(340);
  });

  it("checks stored layouts", () => {
    expect(parseLayout(null)).toBeUndefined();
    expect(parseLayout({ name: "  " })).toBeUndefined();
    const l = parseLayout({ name: "Mine", share: 3, panes: ["camera", "bogus", "schematic"], weights: { camera: 2, x: 4, schematic: -1 }, bothSides: "weird" });
    expect(l).toMatchObject({ name: "Mine", share: 0.8, panes: ["camera", "schematic"], weights: { camera: 2 }, bothSides: null, sidebar: true });
    expect(parseLayouts([{ name: "A", share: 0.3 }, { name: "a", share: 0.6 }, 5])).toHaveLength(1);
    expect(parseLayouts("x")).toEqual([]);
  });

  it("replaces a layout of the same name", () => {
    const list = withLayout([{ ...PRESETS.bga, name: "Desk" }], { ...PRESETS.repair, name: "desk" });
    expect(list).toHaveLength(1);
    expect(list[0].panes).toEqual(["schematic"]);
  });

  it("gives open panes their weights", () => {
    expect(paneWeights(["camera", "schematic"], { camera: 1.5 })).toEqual({ camera: 1.5, schematic: 1 });
  });
});
