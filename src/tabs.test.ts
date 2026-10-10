import { describe, expect, it } from "vitest";
import type { BoardSource } from "./core/loader";
import type { SchematicDocument } from "./schematic/document";
import { activeTab, initialTabs, releasedOnClose, tabOfFile, tabsReducer, type Tabs, type TabsAction } from "./tabs";

const run = (...actions: TabsAction[]): Tabs => actions.reduce(tabsReducer, initialTabs());
const file = (path: string, projectMember?: string) => ({ source: { name: path, path, ...(projectMember && { projectMember }) } as BoardSource });
const doc = (path: string) => ({ path, name: path }) as unknown as SchematicDocument;
const view = (scale: number) => ({ centerX: 0, centerY: 0, scale });

describe("tab collection", () => {
  it("finds an open file in its tab, the active tab's current state included", () => {
    // The active tab changes after it was opened: the collection sees the change at once.
    const s = run({ type: "update", change: file("/a.brd") }, { type: "new" }, { type: "update", change: file("/b.brd") });
    expect(tabOfFile(s, "/a.brd")?.id).toBe(0);
    expect(tabOfFile(s, "/b.brd")?.id).toBe(activeTab(s).id);
    expect(tabOfFile(s, "/c.brd")).toBeUndefined();
    // One board of a project file is told apart from the file's only board.
    const p = run({ type: "update", change: file("/proj", "board-2") });
    expect(tabOfFile(p, "/proj", "board-2")).toBeDefined();
    expect(tabOfFile(p, "/proj")).toBeUndefined();
  });

  it("brings back selection, side and view when switching away and back", () => {
    let s = run({ type: "update", change: { ...file("/a.brd"), side: "bottom", selection: { kind: "part", part: 3 } } });
    s = tabsReducer(s, { type: "new", view: view(2) });
    s = tabsReducer(s, { type: "update", change: { ...file("/b.brd"), selection: { kind: "net", net: 1 } } });
    s = tabsReducer(s, { type: "switch", id: 0, view: view(5) });
    expect(activeTab(s)).toMatchObject({ id: 0, side: "bottom", selection: { kind: "part", part: 3 }, view: view(2) });
    s = tabsReducer(s, { type: "switch", id: 1 });
    expect(activeTab(s)).toMatchObject({ id: 1, selection: { kind: "net", net: 1 }, view: view(5) });
  });

  it("makes the neighbour active when the active tab closes, and keeps an empty tab after the last", () => {
    let s = run({ type: "new" }, { type: "new" }, { type: "switch", id: 1 });
    s = tabsReducer(s, { type: "close", id: 1 });
    expect(s.list.map((t) => t.id)).toEqual([0, 2]);
    expect(s.active).toBe(2);
    s = tabsReducer(s, { type: "close", id: 2 });
    expect(s.active).toBe(0);
    // Closing another tab leaves the active one.
    s = tabsReducer(run({ type: "new" }), { type: "close", id: 0 });
    expect(s.active).toBe(1);
    s = tabsReducer(s, { type: "close", id: 1 });
    expect(s.list).toHaveLength(1);
    expect(activeTab(s)).toMatchObject({ model: null, source: null, docs: [] });
    expect(activeTab(s).id).not.toBe(1);
  });

  it("names the documents a closed tab frees", () => {
    const s = run({ type: "update", change: { docs: [doc("/a.pdf"), doc("/b.pdf")] } }, { type: "new" });
    expect(releasedOnClose(s, 0).map((d) => d.path)).toEqual(["/a.pdf", "/b.pdf"]);
    expect(releasedOnClose(s, 1)).toEqual([]);
  });

  it("changes a tab in place, the active one by default, and cycles round the end", () => {
    let s = run({ type: "new" }, { type: "new" });
    s = tabsReducer(s, { type: "update", change: (t) => ({ rotation: t.rotation + 90 }) });
    s = tabsReducer(s, { type: "update", id: 0, change: { schematicVisible: false } });
    expect(activeTab(s).rotation).toBe(90);
    expect(s.list[0].schematicVisible).toBe(false);
    // Nothing changes: the same state, so React does not render again.
    expect(tabsReducer(s, { type: "update", change: { rotation: 90 } })).toBe(s);
    expect(tabsReducer(s, { type: "cycle", step: 1 }).active).toBe(0);
    expect(tabsReducer(s, { type: "cycle", step: -1 }).active).toBe(1);
    expect(tabsReducer(s, { type: "switch", id: 99 })).toBe(s);
  });
});
