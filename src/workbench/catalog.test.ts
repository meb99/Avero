import { describe, expect, it } from "vitest";
import { buildTree, categoryFolder, categoryFromFolder, guessCategory, matchExisting, suggestions } from "./catalog";

const g = (...names: string[]) => categoryFolder(guessCategory(names));

describe("guessCategory", () => {
  it("sorts PlayStations by model and board numbers", () => {
    expect(g("PS5 EDM-020 boardview.pcb")).toBe("Sony/PlayStation/5");
    expect(g("EDM-010.bvr")).toBe("Sony/PlayStation/5");
    expect(g("CFI-1216A schematic.pdf")).toBe("Sony/PlayStation/5");
    expect(g("CFI-2016 board.cad")).toBe("Sony/PlayStation/5 Slim");
    expect(g("ps5_pro_mainboard.brd")).toBe("Sony/PlayStation/5 Pro");
    expect(g("PS4 CUH-1216A.brd")).toBe("Sony/PlayStation/4");
    expect(g("cuh-7016b boardview.pcb")).toBe("Sony/PlayStation/4 Pro");
    expect(g("NVG-001.pdf")).toBe("Sony/PlayStation/4 Pro");
    expect(g("CUH-2216A.pcb")).toBe("Sony/PlayStation/4 Slim");
    expect(g("SAA-001 CUH-1001A.brd")).toBe("Sony/PlayStation/4");
    expect(g("CECH-2504A.pdf")).toBe("Sony/PlayStation/3");
    expect(g("SCPH-70004.pdf")).toBe("Sony/PlayStation/2");
    expect(g("TA-090 PSP.pdf")).toBe("Sony/PSP/3000");
    expect(g("索尼PS5 EDM-010.pcb")).toBe("Sony/PlayStation/5");
  });

  it("sorts Nintendo, Xbox and handhelds", () => {
    expect(g("Switch Lite Logic Board.bvr")).toBe("Nintendo/Switch/Lite");
    expect(g("Switch_OLED-HEG-CPU-01_PCB_layer.cad")).toBe("Nintendo/Switch/OLED");
    expect(g("HAC-CPU-01.pdf")).toBe("Nintendo/Switch/Original");
    expect(g("HDH-CPU-01 boardview.bvr")).toBe("Nintendo/Switch/Lite");
    expect(g("New 3DS XL RED-001.pdf")).toBe("Nintendo/3DS/New 3DS XL");
    expect(g("Xbox_Series_X_mainboard.bdv")).toBe("Microsoft/Xbox/Series X");
    expect(g("Xbox One S.brd")).toBe("Microsoft/Xbox/One S");
    expect(g("xbox 360 jasper.pdf")).toBe("Microsoft/Xbox/360");
    expect(g("Steam Deck mainboard.pdf")).toBe("Valve/Steam Deck");
  });

  it("sorts Apple by name, model number and board number", () => {
    expect(g("iPhone 13 Pro Max.pcb")).toBe("Apple/iPhone/13 Pro Max");
    expect(g("iPhone_XS_Max.pcb")).toBe("Apple/iPhone/XS Max");
    expect(g("A2338 820-02020.pdf")).toBe("Apple/MacBook Pro/A2338");
    expect(g("820-3437.brd")).toBe("Apple/MacBook Air/A1466");
    expect(g("820-02100.brd")).toBe("Apple/MacBook/820-02100");
  });

  it("sorts phones, notebooks and graphics cards", () => {
    expect(g("SM-A515F.pdf")).toBe("Samsung/Galaxy A/A515F");
    expect(g("Galaxy S23 Ultra board.pdf")).toBe("Samsung/Galaxy S/S23 Ultra");
    expect(g("Pixel 7 Pro.pdf")).toBe("Google/Pixel/7 Pro");
    expect(g("Redmi Note 10 Pro.pdf")).toBe("Xiaomi/Redmi/Note 10 Pro");
    expect(g("Dell_Latitude_5310_19752-1.GR")).toBe("Dell/Latitude/5310");
    expect(g("Dell XPS 15 9500 RTX 3050.pdf")).toBe("Dell/XPS/15");
    expect(g("ThinkPad T480 NM-B501.pdf")).toBe("Lenovo/ThinkPad/T480");
    expect(g("NM-B481.pdf")).toBe("Lenovo/Notebook/NM-B481");
    expect(g("HP EliteBook 840 G5.pdf")).toBe("HP/EliteBook/840 G5");
    expect(g("ASUS UX430UA.pdf")).toBe("ASUS/ZenBook/UX430UA");
    expect(g("Acer Nitro 5 AN515-54.pdf")).toBe("Acer/Nitro/AN515-54");
    expect(g("MS-16J1.pdf")).toBe("MSI/Notebook/MS-16J1");
    expect(g("MSI RTX 3080 Gaming X Trio.pdf")).toBe("MSI/Grafikkarten/RTX 3080");
    expect(g("RX 6800 XT reference.pdf")).toBe("AMD/Grafikkarten/RX 6800 XT");
  });

  it("uses only device names, not lone brands, in schematic text", () => {
    // Schematics list memory makers like Samsung on every page.
    expect(guessCategory(["SAMSUNG K4A8G165WC LPDDR4"], { strict: true }).brand).toBe("");
    expect(guessCategory(["samsung notebook.pdf"]).brand).toBe("Samsung");
    expect(categoryFolder(guessCategory(["SONY", "EDM-020", "APU"], { strict: true }))).toBe("Sony/PlayStation/5");
  });

  it("leaves unknown names empty", () => {
    expect(guessCategory(["download (3).pdf"])).toEqual({ brand: "", family: "", model: "" });
    expect(guessCategory(["LA-G132P_Rev20.cad"]).brand).toBe("");
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
    expect(s.models).toContain("4 Pro");
    expect(s.brands).toContain("Nintendo");
  });

  it("reuses folders the library already has", () => {
    const tree = buildTree(["sony/Playstation/PS5", "Nintendo/Switch/Switch Lite"]);
    expect(matchExisting(tree, { brand: "Sony", family: "PlayStation", model: "5" })).toEqual({
      brand: "sony",
      family: "Playstation",
      model: "PS5",
    });
    expect(matchExisting(tree, { brand: "Nintendo", family: "Switch", model: "Lite" }).model).toBe("Switch Lite");
    expect(matchExisting(tree, { brand: "Sony", family: "PlayStation", model: "4" }).model).toBe("4");
  });
});
