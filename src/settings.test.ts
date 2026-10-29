import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, fromStored, migrate, recentList, showsExtra, togglePin, UI_EXTRAS } from "./settings";

describe("recent files", () => {
  it("lists pinned files first, in the order they were pinned, then the others newest first", () => {
    expect(recentList(["c", "b", "a"], ["a", "x"])).toEqual(["a", "x", "c", "b"]);
    expect(recentList(["c", "b"], [])).toEqual(["c", "b"]);
  });

  it("pins a file and unpins it again", () => {
    expect(togglePin([], "a")).toEqual(["a"]);
    expect(togglePin(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("settings migration", () => {
  it("turns ghosting of the other side off once for older settings", () => {
    const old = { ...DEFAULT_SETTINGS, revision: undefined, ghostOtherSide: true };
    expect(migrate(old).ghostOtherSide).toBe(false);
    expect(migrate(old).revision).toBe(4);
  });

  it("migrates settings stored by older versions, which have no revision", () => {
    const { revision: _, ...old } = { ...DEFAULT_SETTINGS, ghostOtherSide: true };
    expect(fromStored(old).ghostOtherSide).toBe(false);
    expect(fromStored({ ...old, revision: 2 }).ghostOtherSide).toBe(true);
  });

  it("keeps a choice made after the change", () => {
    expect(migrate({ ...DEFAULT_SETTINGS, ghostOtherSide: true }).ghostOtherSide).toBe(true);
  });

  it("gives the board 60 % beside the schematic, unless the split was dragged", () => {
    expect(DEFAULT_SETTINGS.schematicShare).toBe(0.4);
    expect(fromStored({ revision: 2, schematicShare: 0.5 }).schematicShare).toBe(0.4);
    expect(fromStored({ revision: 2, schematicShare: 0.62 }).schematicShare).toBe(0.62);
    expect(fromStored({ revision: 3, schematicShare: 0.5 }).schematicShare).toBe(0.5);
  });

  it("starts in FlexBV's light frame, unless an appearance was chosen", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("light");
    expect(fromStored({ revision: 3, theme: "system" }).theme).toBe("light");
    expect(fromStored({ revision: 3, theme: "dark" }).theme).toBe("dark");
    expect(fromStored({ revision: 4, theme: "system" }).theme).toBe("system");
  });

  it("follows the selected net one link part further, as FlexBV's level 2", () => {
    expect(fromStored({ revision: 4 }).linkDepth).toBe(2);
  });

  it("hides shields and frames from the start", () => {
    expect(fromStored({ revision: 2 }).hideMechanical).toBe(true);
  });
});

describe("interface level", () => {
  it("starts lean and keeps the level last chosen", () => {
    expect(DEFAULT_SETTINGS.uiLevel).toBe("view");
    expect(fromStored({ revision: 2 }).uiLevel).toBe("view");
    expect(fromStored({ revision: 2, uiLevel: "workshop" }).uiLevel).toBe("workshop");
  });

  it("shows workshop parts at the workshop level, or one by one in view", () => {
    for (const extra of UI_EXTRAS) {
      expect(showsExtra({ uiLevel: "workshop" }, extra)).toBe(true);
      expect(showsExtra({ uiLevel: "view" }, extra)).toBe(false);
    }
    const ui = { uiLevel: "view" as const, uiShow: { measure: true, draw: false } };
    expect(showsExtra(ui, "measure")).toBe(true);
    expect(showsExtra(ui, "draw")).toBe(false);
    expect(showsExtra(ui, "diagnose")).toBe(false);
  });
});
