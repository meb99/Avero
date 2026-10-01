import { describe, expect, it } from "vitest";
import { BUILTIN_PAGES, combine, mechanicHdmi, mechanicUsbC, usbC } from "./builtin";
import { EMPTY_KNOWLEDGE, pagesForBoard, withBuiltin } from "./store";

describe("tester screens", () => {
  it("reads a Mechanic USB-C screen: 01–12 are A1–A12, 13–24 are B12–B1", () => {
    const r = mechanicUsbC("GND OL OL .53 .50 .46 .46 .75 .53 OL OL GND GND OL OL .53 .74 .46 .46 .49 .53 OL OL GND");
    expect([r.A4, r.A5, r.A8, r.B12, r.B8, r.B5, r.B4]).toEqual([".53", ".50", ".75", "GND", ".74", ".49", ".53"]);
    expect(usbC("GND OL", "0 OL")).toEqual({ A1: "GND", A2: "OL", B1: "0", B2: "OL" });
    expect(() => mechanicUsbC("GND OL")).toThrow();
  });

  it("reads HDMI pins through the Mechanic adapter", () => {
    const pins = mechanicHdmi("GND .85 .07 .85 .85 .07 .85 .85 .07 .85 .85 GND GND .07 .85 .70 OL .69 .68 .07 .56 .70 OL GND");
    expect(pins).toHaveLength(19);
    // 1 Data2+, 2 shield, 13 CEC, 14 utility, 17 GND, 18 +5V, 19 hot plug.
    expect([pins[0], pins[1], pins[12], pins[13], pins[16], pins[17], pins[18]]).toEqual([".85", ".07", ".70", "OL", ".07", ".56", ".70"]);
  });

  it("combines the readings of several pins", () => {
    expect(combine([".53", ".53"])).toBe("0.53");
    expect(combine([".46", ".47"])).toBe("0.46 / 0.47");
    expect(combine([".519", ".521", ".529", ".529"])).toBe("0.519–0.529");
    expect(combine(["0", "0.000", "0"])).toBe("0");
  });
});

describe("built-in reference pages", () => {
  it("have tables of even width, no empty cells and a source", () => {
    for (const page of BUILTIN_PAGES) {
      expect(page.builtin).toBe(true);
      expect(page.license).toBe("CC BY-SA 3.0");
      expect(page.url).toMatch(/^https:\/\/repair\.wiki\/w\//);
      for (const b of page.blocks)
        if (b.type === "table") {
          expect(new Set(b.rows.map((r) => r.length)).size).toBe(1);
          for (const row of b.rows) for (const cell of row) expect(cell, page.title).toBeTruthy();
        }
    }
  });

  it("show for their board only", () => {
    const base = withBuiltin(EMPTY_KNOWLEDGE, BUILTIN_PAGES);
    const titles = (brand: string, family: string, model: string) => pagesForBoard(base, { brand, family, model }, []).map((p) => p.title);
    expect(titles("Nintendo", "Switch", "OLED")).toEqual(["Nintendo Switch OLED – USB-C Diodenwerte"]);
    expect(titles("Nintendo", "Switch", "Lite")).toEqual(["Nintendo Switch Lite – USB-C Diodenwerte"]);
    expect(titles("Sony", "PlayStation", "5")).toEqual(["PlayStation 5 – Diodenwerte"]);
    expect(titles("Sony", "DualSense", "BDM-030")).toEqual(["DualSense – USB-C und Versionen"]);
    expect(titles("Microsoft", "Xbox", "Series X")).toEqual(["Xbox Series X – HDMI-Diodenwerte"]);
  });
});
