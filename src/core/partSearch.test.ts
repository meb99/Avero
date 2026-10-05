import { describe, expect, it } from "vitest";
import { matchesQuery, parsePartQuery, partSpecs } from "./partSearch";

describe("parsePartQuery", () => {
  it("reads value, rating, package and type together", () => {
    const q = parsePartQuery("10 µF, mindestens 16 V, 0603")!;
    expect(q).toMatchObject({ kind: "C", value: { unit: "F" }, minVolts: 16, package: "0603", words: [] });
    expect(q.value!.v).toBeCloseTo(10e-6, 12);
    expect(parsePartQuery("4k7 0201")).toMatchObject({ kind: "R", value: { v: 4700, unit: "Ω" }, package: "0201" });
    expect(parsePartQuery("spule 6.8uH")).toMatchObject({ kind: "L", value: { unit: "H" } });
    expect(parsePartQuery("max 6.3V kondensator")).toMatchObject({ kind: "C", maxVolts: 6.3 });
  });

  it("leaves plain name searches alone", () => {
    expect(parsePartQuery("PU301")).toBeNull();
    expect(parsePartQuery("C")).toBeNull();
  });
});

describe("partSpecs and matchesQuery", () => {
  it("matches device texts in several styles", () => {
    const q = parsePartQuery("10µF ≥16V 0603")!;
    expect(matchesQuery(partSpecs("PC301", "10U_0603_25V6K"), q, "PC301", "10U_0603_25V6K")).toBe(true);
    expect(matchesQuery(partSpecs("PC302", "10U_0603_6.3V6K"), q, "PC302", "10U_0603_6.3V6K")).toBe(false);
    expect(matchesQuery(partSpecs("C12", "1uF 0201"), parsePartQuery("1uF")!, "C12", "1uF 0201")).toBe(true);
    expect(matchesQuery(partSpecs("R7", "R0402_4K7"), parsePartQuery("4.7k 0402")!, "R7", "R0402_4K7")).toBe(true);
  });

  it("finds packages and 0 Ω bridges in package-only device texts", () => {
    expect(matchesQuery(partSpecs("PC301", "C_0603"), parsePartQuery("kondensator 0603")!, "PC301", "C_0603")).toBe(true);
    expect(matchesQuery(partSpecs("PR12", "R0402_0OHM"), parsePartQuery("0R 0402")!, "PR12", "R0402_0OHM")).toBe(true);
    expect(matchesQuery(partSpecs("PC301", "C_0603"), parsePartQuery("10uF 0603")!, "PC301", "C_0603")).toBe(false);
  });

  it("prefers the schematic's facts", () => {
    const specs = partSpecs("C3090", "C_0603", { page: 0, value: "10 µF", rating: "25V", package: "0603", flags: [] });
    expect(specs).toMatchObject({ kind: "C", value: { unit: "F" }, volts: 25, package: "0603" });
    expect(matchesQuery(specs, parsePartQuery("10uF 16V")!, "C3090", "C_0603")).toBe(true);
  });
  it("reads a decimal comma", () => {
    expect(parsePartQuery("4,7k")?.value).toEqual(parsePartQuery("4.7k")?.value);
    expect(parsePartQuery("4,7k")?.words).toEqual([]);
    expect(parsePartQuery("10uF, 0603")?.package).toBe("0603");
  });
});
