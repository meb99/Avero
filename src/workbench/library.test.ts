import { describe, expect, it } from "vitest";
import { badge, filterEntries, type LibraryEntry } from "./library";

const file = (name: string) => ({ path: `/lib/${name}`, name, size: 1, modified: 0 });

const entries: LibraryEntry[] = [
  {
    key: "1",
    title: "820-02100",
    folder: "Apple/iPhone 13 Pro",
    root: "/lib",
    boards: [file("820-02100.brd")],
    schematics: [file("J413 820-02100.pdf")],
    unsupported: [],
  },
  {
    key: "2",
    title: "NM-B481",
    folder: "Lenovo/X1 Carbon 6",
    root: "/lib",
    boards: [file("pins.asc")],
    schematics: [],
    unsupported: [file("NM-B481.pcb")],
  },
];

describe("filterEntries", () => {
  it("matches every word against title, folder and file names", () => {
    expect(filterEntries(entries, "iphone 13").map((e) => e.key)).toEqual(["1"]);
    expect(filterEntries(entries, "820-02").map((e) => e.key)).toEqual(["1"]);
    expect(filterEntries(entries, "carbon pcb").map((e) => e.key)).toEqual(["2"]);
    expect(filterEntries(entries, "apple pcb")).toEqual([]);
    expect(filterEntries(entries, "  ")).toHaveLength(2);
  });
});

describe("badge", () => {
  it("names formats", () => {
    expect(badge("x.brd")).toBe("BRD");
    expect(badge("PINS.ASC")).toBe("ASC");
    expect(badge("board.pcb")).toBe("PCB");
  });
});
