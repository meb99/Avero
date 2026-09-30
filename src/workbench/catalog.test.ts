import { describe, expect, it } from "vitest";
import { buildTree, categoryFolder, categoryFromFolder, guessCategory, suggestions } from "./catalog";

describe("guessCategory", () => {
  it("recognizes consoles and devices from file names", () => {
    expect(guessCategory(["Switch Lite Logic Board.bvr"])).toEqual({ brand: "Nintendo", family: "Switch", model: "Switch Lite" });
    expect(guessCategory(["PS4 CUH-1216A.brd"])).toEqual({ brand: "Sony", family: "PlayStation", model: "PS4" });
    expect(guessCategory(["cuh-7016b boardview.pcb"])).toEqual({ brand: "Sony", family: "PlayStation", model: "PS4 Pro" });
    expect(guessCategory(["Xbox_Series_X_mainboard.bdv"])).toEqual({ brand: "Microsoft", family: "Xbox", model: "Series X" });
    expect(guessCategory(["Dell_Latitude_5310_19752-1.GR"])).toEqual({ brand: "Dell", family: "Latitude", model: "5310" });
    expect(guessCategory(["iPhone 13 Pro Max.pcb"])).toEqual({ brand: "Apple", family: "iPhone", model: "iPhone 13 Pro Max" });
    expect(guessCategory(["820-02100.brd"]).brand).toBe("Apple");
  });

  it("leaves unknown names empty", () => {
    expect(guessCategory(["download (3).pdf"])).toEqual({ brand: "", family: "", model: "" });
  });
});

describe("category folders", () => {
  it("round-trips and skips empty levels", () => {
    expect(categoryFolder({ brand: "Sony", family: "", model: "PS4" })).toBe("Sony/PS4");
    expect(categoryFromFolder("Sony/PlayStation/PS4/extra")).toEqual({ brand: "Sony", family: "PlayStation", model: "PS4" });
  });

  it("builds a counted tree and suggestions", () => {
    const tree = buildTree(["Sony/PlayStation/PS4", "Sony/PlayStation/PS5", "sony/PSP", "Apple/iPhone"]);
    expect(tree.map((n) => [n.name, n.count])).toEqual([
      ["Apple", 1],
      ["Sony", 3],
    ]);
    expect(tree[1].children.map((n) => n.path)).toEqual(["Sony/PlayStation", "Sony/PSP"]);
    const s = suggestions(tree, "Sony", "PlayStation");
    expect(s.families).toContain("PS Vita");
    expect(s.models).toContain("PS4 Pro");
    expect(s.brands).toContain("Nintendo");
  });
});
