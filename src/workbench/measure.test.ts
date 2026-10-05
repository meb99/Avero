import { describe, expect, it } from "vitest";
import { compare, compareReadings, formatValue, parseValue } from "./measure";

describe("typed units", () => {
  it("takes an explicit volt as volts, a bare diode number above 3 as millivolts", () => {
    expect(parseValue("4V", "diode")).toBe(4);
    expect(parseValue("4000mV", "diode")).toBe(4);
    expect(parseValue("452", "diode")).toBeCloseTo(0.452);
    expect(parseValue("0,452", "diode")).toBeCloseTo(0.452);
  });
});

describe("parseValue", () => {
  it("reads diode mode the way meters show it", () => {
    expect(parseValue("0,452", "diode")).toBeCloseTo(0.452);
    expect(parseValue("0.452 V", "diode")).toBeCloseTo(0.452);
    expect(parseValue("452", "diode")).toBeCloseTo(0.452);
    expect(parseValue("452mV", "diode")).toBeCloseTo(0.452);
    expect(parseValue("OL", "diode")).toBe("OL");
    expect(parseValue("1", "diode")).toBe("OL");
    expect(parseValue("o.l", "diode")).toBe("OL");
  });

  it("reads voltages", () => {
    expect(parseValue("3.3", "voltage")).toBeCloseTo(3.3);
    expect(parseValue("3,30V", "voltage")).toBeCloseTo(3.3);
    expect(parseValue("850 mV", "voltage")).toBeCloseTo(0.85);
    expect(parseValue("12", "voltage")).toBe(12);
    expect(parseValue("1", "voltage")).toBe(1);
  });

  it("reads resistances including resistor codes", () => {
    expect(parseValue("4.7k", "resistance")).toBeCloseTo(4700);
    expect(parseValue("4k7", "resistance")).toBeCloseTo(4700);
    expect(parseValue("2R2", "resistance")).toBeCloseTo(2.2);
    expect(parseValue("1,2 MΩ", "resistance")).toBeCloseTo(1.2e6);
    expect(parseValue("470 Ohm", "resistance")).toBe(470);
    expect(parseValue("kurz", "resistance")).toBe(0);
    expect(parseValue("OL", "resistance")).toBe("OL");
  });

  it("clears on empty input and rejects nonsense", () => {
    expect(parseValue("  ", "voltage")).toBeUndefined();
    expect(parseValue("abc", "voltage")).toBeNull();
    expect(parseValue("3M", "voltage")).toBeNull();
  });
});

describe("formatValue", () => {
  it("uses sensible units and the language's decimal mark", () => {
    expect(formatValue(0.452, "diode", "de")).toBe("0,452 V");
    expect(formatValue(3.3, "voltage", "en")).toBe("3.30 V");
    expect(formatValue(4700, "resistance", "en")).toBe("4.70 kΩ");
    expect(formatValue(2.2, "resistance", "en")).toBe("2.20 Ω");
    expect(formatValue("OL", "resistance")).toBe("OL");
    expect(formatValue(undefined, "diode")).toBe("");
  });
});

describe("compare", () => {
  it("applies relative tolerance with an absolute floor", () => {
    expect(compare(0.45, 0.47, "diode", 0.1)).toBe("ok");
    expect(compare(0.45, 0.3, "diode", 0.1)).toBe("deviation");
    // 5 % of 0.05 V is tiny; the floor keeps noise from flagging.
    expect(compare(0.05, 0.06, "voltage", 0.05)).toBe("ok");
    expect(compare(10, 11, "resistance", 0.05)).toBe("ok");
    expect(compare(1000, 1200, "resistance", 0.1)).toBe("deviation");
  });

  it("treats OL as its own value", () => {
    expect(compare("OL", "OL", "diode", 0.1)).toBe("ok");
    expect(compare("OL", 0.4, "diode", 0.1)).toBe("deviation");
    expect(compare(0.4, undefined, "diode", 0.1)).toBeUndefined();
  });

  it("reports the worst quantity of a reading", () => {
    expect(compareReadings({ diode: 0.45, voltage: 3.3 }, { diode: 0.45, voltage: 0 }, 0.1)).toBe("deviation");
    expect(compareReadings({ diode: 0.45 }, { diode: 0.46, voltage: 3.3 }, 0.1)).toBe("ok");
    expect(compareReadings({ diode: 0.45 }, { voltage: 3.3 }, 0.1)).toBeUndefined();
  });
});
