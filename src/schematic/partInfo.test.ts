import { describe, expect, it } from "vitest";
import { classify, partKind, readSchematicFacts } from "./partInfo";
import { WordIndex, type Word } from "./textIndex";

/** A word of 6-unit text at (x, y), 3.6 units per character. */
function word(text: string, x: number, y: number, page = 0): Word {
  return { key: text.toUpperCase(), text, page, box: { x0: x, y0: y, x1: x + text.length * 3.6, y1: y + 6.6 } };
}

function lines(x: number, y: number, texts: string[], page = 0): Word[] {
  return texts.map((t, i) => word(t, x, y + i * 8, page));
}

describe("partKind", () => {
  it("knows parts by their names, Compal's power parts too", () => {
    expect(partKind("C3090")).toBe("C");
    expect(partKind("PC301")).toBe("C");
    expect(partKind("PR313")).toBe("R");
    expect(partKind("L3095")).toBe("L");
    expect(partKind("FB12")).toBe("L");
    expect(partKind("U3090")).toBe("chip");
    expect(partKind("PQ309")).toBe("chip");
    expect(partKind("J4001")).toBe("other");
  });
});

describe("classify", () => {
  it("reads values with their units", () => {
    expect(classify("10UF", "C")).toEqual({ field: "value", text: "10 µF" });
    expect(classify("0.1U", "C")).toEqual({ field: "value", text: "0.1 µF" });
    expect(classify("100PF", "C")).toEqual({ field: "value", text: "100 pF" });
    expect(classify("4.7K", "R")).toEqual({ field: "value", text: "4.7 kΩ" });
    expect(classify("4K7", "R")).toEqual({ field: "value", text: "4.7 kΩ" });
    expect(classify("0", "R")).toEqual({ field: "value", text: "0 Ω" });
    expect(classify("6.8UH", "L")).toEqual({ field: "value", text: "6.8 µH" });
    expect(classify("25V", "C")).toEqual({ field: "rating", text: "25V" });
    expect(classify("25V6K", "C")).toEqual({ field: "rating", text: "25V" });
    expect(classify("1/16W", "R")).toEqual({ field: "rating", text: "1/16W" });
    expect(classify("20%", "C")).toEqual({ field: "tolerance", text: "20%" });
    expect(classify("X5R-CERM", "C")).toEqual({ field: "dielectric", text: "X5R" });
    expect(classify("402", "R")).toEqual({ field: "package", text: "0402" });
    expect(classify("CRITICAL", "chip")).toEqual({ field: "flag", text: "CRITICAL" });
    expect(classify("LT3957", "chip")).toEqual({ field: "partNumber", text: "LT3957" });
  });

  it("does not take pin numbers, pin names or net names for values", () => {
    expect(classify("1", "R")).toBeNull();
    expect(classify("2", "C")).toBeNull();
    expect(classify("SNS1", "chip")).toBeNull();
    expect(classify("INTVCC", "chip")).toBeNull();
    expect(classify("PP3V3_S5", "chip")).toBeNull();
    expect(classify("VCIN1_AC_IN", "chip")).toBeNull();
  });
});

describe("readSchematicFacts", () => {
  const read = (words: Word[], parts: string[], nets: string[] = []) => {
    const index = new WordIndex();
    index.add(words);
    return readSchematicFacts(index, new Set(parts), new Set(nets));
  };

  it("reads the value block under a part name (Apple)", () => {
    const facts = read([...lines(100, 100, ["C3090", "10UF", "20%", "25V", "X5R-CERM", "0603"]), word("1", 92, 100), word("2", 92, 140)], ["C3090"]);
    expect(facts.parts.get("C3090")).toEqual({
      page: 0,
      value: "10 µF",
      rating: "25V",
      tolerance: "20%",
      dielectric: "X5R",
      package: "0603",
      flags: [],
    });
  });

  it("reads a chip's part number and flags", () => {
    const facts = read(
      [word("CRITICAL", 200, 92), word("U3090", 200, 100), word("LT3957", 200, 108), word("QFN", 200, 116), word("SNS1", 260, 104), word("INTVCC", 150, 130)],
      ["U3090"],
    );
    expect(facts.parts.get("U3090")).toMatchObject({ partNumber: "LT3957", package: "QFN", flags: ["CRITICAL"] });
  });

  it("splits combined value words (Compal, Quanta)", () => {
    const facts = read([word("PC301", 100, 100), word("10U_0603_25V6K", 100, 108), word("C12", 300, 100), word("0.1U/10V_4", 300, 108)], ["PC301", "C12"]);
    expect(facts.parts.get("PC301")).toMatchObject({ value: "10 µF", package: "0603", rating: "25V" });
    expect(facts.parts.get("C12")).toMatchObject({ value: "0.1 µF", rating: "10V" });
  });

  it("gives each value to the nearest part only", () => {
    // Two capacitors side by side, each with its value below.
    const facts = read([...lines(100, 100, ["C1", "1UF"]), ...lines(130, 100, ["C2", "22UF"])], ["C1", "C2"]);
    expect(facts.parts.get("C1")?.value).toBe("1 µF");
    expect(facts.parts.get("C2")?.value).toBe("22 µF");
  });

  it("does not take the value of the part drawn above", () => {
    // A chip's type printed under its symbol, right above the next chip's name.
    const facts = read([word("QFN40", 194, 331), word("U3100", 154, 368), ...lines(154, 376, ["AV-CHG-24"])], ["U3100"]);
    expect(facts.parts.get("U3100")).toEqual({ page: 0, partNumber: "AV-CHG-24", flags: [] });
  });

  it("ignores text far away", () => {
    const facts = read([word("C1", 100, 100), word("47UF", 400, 400)], ["C1"]);
    expect(facts.parts.get("C1")).toBeUndefined();
  });

  it("reads net voltages from VOLTAGE= lines under net labels", () => {
    const facts = read(
      [word("PP3V3_S5", 50, 50), word("VOLTAGE", 50, 58), word("3.3V", 78, 58), word("MIN_LINE_WIDTH", 50, 66), word("PPBUS_G3H", 300, 50), word("VOLTAGE", 300, 58), word("12.6V", 328, 58)],
      [],
      ["PP3V3_S5", "PPBUS_G3H"],
    );
    expect(facts.netVoltages.get("PP3V3_S5")).toBe("3.3V");
    expect(facts.netVoltages.get("PPBUS_G3H")).toBe("12.6V");
  });
});
