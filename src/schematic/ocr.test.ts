import { describe, expect, it } from "vitest";
import { fixRecognised, ocrToWords } from "./ocr";

describe("recognised text", () => {
  it("keeps confident words in page units, split like PDF text", () => {
    const words = ocrToWords(
      [
        { text: "U3100", confidence: 91, bbox: { x0: 100, y0: 40, x1: 200, y1: 60 } },
        { text: "PP_VBUS,CHG_SW", confidence: 80, bbox: { x0: 0, y0: 0, x1: 140, y1: 20 } },
        { text: "~%", confidence: 20, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      ],
      3,
      2,
    );
    expect(words.map((w) => [w.key, w.page])).toEqual([
      ["U3100", 3],
      ["PP_VBUS", 3],
      ["CHG_SW", 3],
    ]);
    expect(words[0].box).toEqual({ x0: 50, y0: 20, x1: 100, y1: 30 });
    expect(words[1].box.x1).toBeCloseTo(35, 6);
    expect(words[2].box.x0).toBeCloseTo(40, 6);
  });

  it("maps words read from the turned page back onto the page", () => {
    // Page image 1000 px high; turned clockwise, image (u, v) is page (v, 1000 − u).
    const [w] = ocrToWords([{ text: "GND", confidence: 90, bbox: { x0: 100, y0: 300, x1: 160, y1: 320 } }], 0, 1, { pageHeightPx: 1000 });
    expect(w.box).toEqual({ x0: 300, y0: 840, x1: 320, y1: 900 });
  });

  it("fixes confused characters to the board's names", () => {
    const names = new Set(["PP0V9_SOC", "U1000", "C1013", "PP5V_S0"]);
    const known = (k: string) => names.has(k);
    expect(fixRecognised("PPOV9_SOC", known)).toBe("PP0V9_SOC");
    expect(fixRecognised("UIOOO", known)).toBe("UIOOO");
    expect(fixRecognised("U1OOO", known)).toBe("U1000");
    expect(fixRecognised("PPSV_SO", known)).toBe("PPSV_SO");
    expect(fixRecognised("C1013", known)).toBe("C1013");
    expect(fixRecognised("100NF", known)).toBe("100NF");
  });
});
