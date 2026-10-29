import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { findNames, regexOk } from "./search";
import { testBoard } from "./testBoard";

const model = new BoardModel(testBoard());
const names = (query: string, options: Parameters<typeof findNames>[2]) => findNames(model, query, options).map((r) => r.label);
const both = { parts: true, nets: true } as const;

describe("search for component / network", () => {
  it("finds parts of the name anywhere, at its start, or the whole name", () => {
    expect(names("3V3", { ...both, mode: "substring" })).toEqual(["PP3V3", "PP3V3_L", "PP3V3_R"]);
    expect(names("3V3", { ...both, mode: "prefix" })).toEqual([]);
    expect(names("pp3v3", { ...both, mode: "prefix" })).toEqual(["PP3V3", "PP3V3_L", "PP3V3_R"]);
    expect(names("PP3V3", { ...both, mode: "strict" })).toEqual(["PP3V3"]);
  });

  it("looks for parts, nets or both", () => {
    expect(names("R", { parts: true, nets: false, mode: "prefix" })).toEqual(["R1", "R9"]);
    expect(names("R", { parts: false, nets: true, mode: "substring" })).not.toContain("R1");
    expect(names("R", { parts: false, nets: false, mode: "substring" })).toEqual([]);
  });

  it("lists names in order, a part before a net of the same name", () => {
    const list = findNames(model, "", { ...both, mode: "substring" });
    expect(list).toEqual([]);
    const all = findNames(model, "1", { ...both, mode: "substring" });
    expect(all.map((r) => r.label)).toEqual(["R1", "U10"]);
  });

  it("finds a pin written as part and number", () => {
    const [hit] = findNames(model, "U10.A3", { ...both, mode: "strict" });
    expect(hit?.kind).toBe("pin");
    expect(hit?.detail).toBe("I2C_SDA");
  });

  it("offers the part when it has no such pin (a BGA names its balls A1, B2 …)", () => {
    const [hit] = findNames(model, "U10.B7", { ...both, mode: "substring" });
    expect(hit?.kind).toBe("part");
    expect(hit?.label).toBe("U10");
  });

  it("finds parts by value and type with details, as OpenBoardView's \"Including details\"", () => {
    expect(names("10K", { ...both, mode: "substring" })).toEqual([]);
    expect(names("10K", { ...both, mode: "substring", details: true })).toEqual(["R1"]);
    // Whole word of the type: "0402" in "0R 0402", not "040" (that is part of a word).
    expect(names("0402", { ...both, mode: "strict", details: true })).toEqual(["R9"]);
    expect(names("040", { ...both, mode: "strict", details: true })).toEqual([]);
    expect(names("1u", { ...both, mode: "prefix", details: true })).toEqual(["L5"]);
    // A name match is listed once, with or without details.
    expect(names("R1", { ...both, mode: "strict", details: true })).toEqual(["R1"]);
  });

  it("leaves out unconnected nets", () => {
    expect(names("UNCONNECTED", { ...both, mode: "strict" })).toEqual([]);
  });

  it("matches a regular expression, case-insensitively, and never throws on a broken one", () => {
    // The dialog's "regex" radio chooses the mode, so the field holds the bare pattern.
    expect(names("^PP3V3$", { ...both, mode: "regex" })).toEqual(["PP3V3"]);
    expect(names("3v3", { ...both, mode: "regex" })).toEqual(["PP3V3", "PP3V3_L", "PP3V3_R"]);
    expect(names("^PP3V3_[LR]$", { ...both, mode: "regex" })).toEqual(["PP3V3_L", "PP3V3_R"]);
    expect(names("^R\\d$", { parts: true, nets: false, mode: "regex" })).toEqual(["R1", "R9"]);
    // A broken pattern or an empty one yields nothing, no exception.
    expect(names("(", { ...both, mode: "regex" })).toEqual([]);
    expect(names("", { ...both, mode: "regex" })).toEqual([]);
    // A dot is a pattern character here, not the pin separator: it matches the underscore.
    expect(names("PP3V3.L", { ...both, mode: "regex" })).toEqual(["PP3V3_L"]);
  });

  it("finds a part by its details with a regular expression", () => {
    expect(names("10k", { ...both, mode: "regex", details: true })).toEqual(["R1"]);
    expect(names("10k", { ...both, mode: "regex" })).toEqual([]);
  });
});

describe("regexOk", () => {
  it("accepts a valid pattern and rejects a broken or empty one", () => {
    expect(regexOk("^PP.*$")).toBe(true);
    expect(regexOk("(")).toBe(false);
    expect(regexOk("  ")).toBe(false);
  });
});
