import { describe, expect, it } from "vitest";
import { splitWords } from "../schematic/textIndex";
import { hashKey, searchText, type PdfTextIndex, withOcrWords } from "./fulltext";

const a: PdfTextIndex = { v: 1, pages: 3, words: { PP3V3_S5: [0, 2], U3000: [1], PPBUS_G3H: [0] } };
const b: PdfTextIndex = { v: 1, pages: 9, words: { PP3V3_S0: [4], PP3V3_S5: [4, 5, 8] } };

describe("searchText", () => {
  it("finds word parts across schematics, most matches first", () => {
    const hits = searchText(
      [
        ["/lib/a.pdf", a],
        ["/lib/b.pdf", b],
      ],
      "pp3v3",
    );
    expect(hits.map((h) => [h.path, h.pages, h.count])).toEqual([
      ["/lib/b.pdf", [4, 5, 8], 4],
      ["/lib/a.pdf", [0, 2], 2],
    ]);
    expect(hits[0].words).toEqual(["PP3V3_S0", "PP3V3_S5"]);
  });

  it("needs at least two characters", () => {
    expect(searchText([["/lib/a.pdf", a]], " u ")).toEqual([]);
  });
});

describe("splitWords", () => {
  it("splits and normalizes schematic text", () => {
    expect(splitWords("(R1100), gnd: PP3V3_S5 = 3.3V")).toEqual(["R1100", "GND", "PP3V3_S5", "3.3V"]);
  });
});

describe("hashKey", () => {
  it("is stable and short", () => {
    expect(hashKey("")).toBe("cbf29ce484222325");
    expect(hashKey("/a|1|2")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashKey("/a|1|2")).not.toBe(hashKey("/a|1|3"));
  });

  it("adds words recognised on scanned pages", () => {
    const index = { v: 1 as const, pages: 2, words: { U1: [0] } };
    const merged = withOcrWords(index, { pages: { "1": [["U1", 0, 0, 1, 1], ["PP3V3", 0, 0, 1, 1]] } });
    expect(merged.words.U1).toEqual([0, 1]);
    expect(merged.words.PP3V3).toEqual([1]);
    expect(index.words.U1).toEqual([0]);
  });
});
