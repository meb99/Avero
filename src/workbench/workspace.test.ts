import { describe, expect, it } from "vitest";
import { parseWorkspace } from "./workspace";

describe("parseWorkspace", () => {
  it("restores two distinct boards of the same project",()=>{
    const tabs=[{path:"/Switch.epro",projectMember:"PCB/a.epcb"},{path:"/Switch.epro",projectMember:"PCB/b.epcb"}];
    const restored=parseWorkspace(JSON.stringify({version:1,active:1,tabs}))!;
    expect(restored.tabs.map((t)=>t.projectMember)).toEqual(["PCB/a.epcb","PCB/b.epcb"]);expect(restored.active).toBe(1);
  });
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

  it("keeps all documents of a board, in their order", () => {
    const ws = parseWorkspace(
      JSON.stringify({
        version: 1,
        active: 0,
        tabs: [{ path: "/b.brd", schematicPath: "/rev-b.pdf", schematicPaths: ["/rev-a.pdf", "/rev-b.pdf", 7, ""], side: "top" }],
      }),
    );
    expect(ws?.tabs[0].schematicPaths).toEqual(["/rev-a.pdf", "/rev-b.pdf"]);
    expect(ws?.tabs[0].schematicPath).toBe("/rev-b.pdf");
  });

  it("refuses other data", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace("[]")).toBeNull();
    expect(parseWorkspace("{")).toBeNull();
  });
});
