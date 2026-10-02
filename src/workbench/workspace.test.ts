import { describe, expect, it } from "vitest";
import { parseWorkspace } from "./workspace";

describe("parseWorkspace", () => {
  it("keeps valid tabs and drops broken ones", () => {
    const ws = parseWorkspace(
      JSON.stringify({
        version: 1,
        active: 5,
        tabs: [
          { path: "/a/820-02100.brd", schematicPath: "/a/820-02100.pdf", schematicVisible: false, side: "bottom", rotation: 5, view: { centerX: 1, centerY: 2, scale: 0.5 } },
          { path: "" },
          { path: "/b/x.cad", view: { centerX: "x" } },
        ],
        window: { x: 10, y: 20, width: 1400, height: 900, maximized: false },
      }),
    )!;
    expect(ws.tabs).toEqual([
      { path: "/a/820-02100.brd", schematicPath: "/a/820-02100.pdf", schematicVisible: false, side: "bottom", rotation: 1, view: { centerX: 1, centerY: 2, scale: 0.5 } },
      { path: "/b/x.cad", schematicVisible: true, side: "top", rotation: 0 },
    ]);
    expect(ws.active).toBe(1);
    expect(ws.window).toEqual({ x: 10, y: 20, width: 1400, height: 900, maximized: false });
  });

  it("refuses other data", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace("[]")).toBeNull();
    expect(parseWorkspace("{")).toBeNull();
  });
});
