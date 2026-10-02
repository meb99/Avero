import { describe, expect, it } from "vitest";
import { datasheetsFor, parseDatasheets, partNumbers, type Datasheet } from "./datasheets";

const sheets: Datasheet[] = [
  { id: "a", file: "/d/isl88739a.pdf", title: "ISL88739A", chips: ["ISL88739"], pages: [{ label: "Pinout", page: 2 }] },
  { id: "b", file: "/d/tps2546.pdf", title: "TPS2546", chips: ["TPS2546"], pages: [] },
];

describe("datasheets", () => {
  it("finds part numbers in device texts", () => {
    expect(partNumbers("ISL88739AHRZ-T_QFN32_4X4")).toEqual(["ISL88739AHRZ-T"]);
    expect(partNumbers("C_0402")).toEqual([]);
  });

  it("assigns datasheets by part number prefix", () => {
    expect(datasheetsFor(sheets, "ISL88739AHRZ-T_QFN32_4X4").map((s) => s.id)).toEqual(["a"]);
    expect(datasheetsFor(sheets, "TPS2546RTER")).toHaveLength(1);
    expect(datasheetsFor(sheets, "R_0402")).toEqual([]);
  });

  it("reads stored registers and drops broken entries", () => {
    expect(parseDatasheets(JSON.stringify([...sheets, { id: 3 }, { id: "x", file: "/d/x.pdf", pages: [{ label: "p", page: -1 }] }]))).toEqual([
      ...sheets,
      { id: "x", file: "/d/x.pdf", title: "x.pdf", chips: [], pages: [] },
    ]);
  });
});
