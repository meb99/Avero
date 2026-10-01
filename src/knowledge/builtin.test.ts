import { describe, expect, it } from "vitest";
import { BUILTIN_PAGES } from "./builtin";
import { EMPTY_KNOWLEDGE, pagesForBoard, withBuiltin } from "./store";

describe("built-in reference pages", () => {
  it("have tables of even width and a source", () => {
    for (const page of BUILTIN_PAGES) {
      expect(page.builtin).toBe(true);
      expect(page.license).toBe("CC BY-SA 3.0");
      for (const b of page.blocks)
        if (b.type === "table") expect(new Set(b.rows.map((r) => r.length)).size).toBe(1);
    }
  });

  it("show for a Switch OLED board, not for a Lite", () => {
    const base = withBuiltin(EMPTY_KNOWLEDGE, BUILTIN_PAGES);
    const oled = pagesForBoard(base, { brand: "Nintendo", family: "Switch", model: "OLED" }, []);
    expect(oled.map((p) => p.title)).toContain("Nintendo Switch OLED – USB-C Diodenwerte");
    expect(pagesForBoard(base, { brand: "Nintendo", family: "Switch", model: "Lite" }, [])).toEqual([]);
  });
});
