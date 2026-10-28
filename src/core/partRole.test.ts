import { describe, expect, it } from "vitest";
import { isLowOhm, isZeroOhm, kindLetters, ohms, partRole, passesThrough } from "./partRole";

describe("part roles across naming schemes", () => {
  it("reads the kind past power and EMI section letters", () => {
    expect(kindLetters("PL1801")).toBe("L");
    expect(kindLetters("PJ1501")).toBe("J");
    expect(kindLetters("PCV12")).toBe("CV");
    expect(kindLetters("EL2901")).toBe("L");
    expect(kindLetters("U3100")).toBe("U");
    expect(kindLetters("PU4401")).toBe("U");
  });

  it("knows the usual parts", () => {
    const cases: [string, string | undefined, number, string][] = [
      ["PL1801", "CHILI_BMQA000404201R0MA1_2P", 2, "inductor"],
      ["LA12", undefined, 2, "inductor"],
      ["PJ1501", "JUMP_43X79", 2, "jumper"],
      ["JP3V", "JUMP_43X79", 2, "jumper"],
      ["J4001", "USB-C", 24, "connector"],
      ["FB2", undefined, 2, "ferrite"],
      ["R77", "CHENG_MBK1608121YZF_2P", 2, "ferrite"],
      ["F4001", undefined, 2, "fuse"],
      ["PF1", undefined, 2, "fuse"],
      ["D2402", undefined, 2, "diode"],
      ["LED1", undefined, 2, "diode"],
      ["PD301", "LRB715FT1G_SOT323-3", 3, "diode"],
      ["PQ303", "AON7380_DFN3X3-8-5", 5, "transistor"],
      ["CG12", undefined, 2, "capacitor"],
      ["PR4401", "R_0402", 2, "resistor"],
      ["Y1000", undefined, 2, "crystal"],
      ["TP7", undefined, 1, "testpoint"],
    ];
    for (const [name, device, pins, role] of cases) expect([name, partRole(name, device, pins)]).toEqual([name, role]);
  });

  it("finds 0 Ω resistors in any device text, but not 1 Ω or packages", () => {
    for (const d of ["0", "0R", "0R0", "0.0", "0 OHM", "0Ω", "R0402_0OHM", "0_0402_5%", "RES 0R 0402"]) expect([d, isZeroOhm(d)]).toEqual([d, true]);
    for (const d of ["1R0", "R_0402", "10K_0402_5%", "0.1U_0402", "100R", "R0201", undefined]) expect([d, isZeroOhm(d)]).toEqual([d, false]);
  });

  it("reads resistor values written in ohms, not packages or ratings", () => {
    const cases: [string, number | undefined][] = [
      ["1R0", 1],
      ["0R1_0402", 0.1],
      ["4R7", 4.7],
      ["100R", 100],
      ["0.01R", 0.01],
      ["RES 1 OHM 1%", 1],
      ["0.005_1%_0612", 0.005],
      ["R_0.1_2512", 0.1],
      ["5mR", 0.005],
      ["10K_0402_5%", undefined],
      ["R0402", undefined],
      ["1/16W", undefined],
      ["0.1U_0402", undefined],
      ["0.1%", undefined],
    ];
    for (const [d, v] of cases) expect([d, ohms(d)]).toEqual([d, v]);
    expect(isLowOhm("1R0")).toBe(true);
    expect(isLowOhm("1R5")).toBe(false);
    expect(isLowOhm(undefined)).toBe(false);
  });

  it("passes supplies through coils, jumpers and resistors up to 1 Ω only", () => {
    expect(passesThrough("PL1801", "MAG_MLV_2P", 2)).toBe(true);
    expect(passesThrough("PJ1501", "JUMP_43X79", 2)).toBe(true);
    expect(passesThrough("R12", "R0402_0OHM", 2)).toBe(true);
    expect(passesThrough("R12", "R_0402", 2)).toBe(false);
    // Up to 1 Ω, as FlexBV: current-sense resistors join a supply to the rail behind them.
    expect(passesThrough("R12", "1R0", 2)).toBe(true);
    expect(passesThrough("PR7010", "0.005_1%_0612", 2)).toBe(true);
    expect(passesThrough("R12", "4R7", 2)).toBe(false);
    expect(passesThrough("C12", "0R1", 2)).toBe(false);
    expect(passesThrough("C12", undefined, 2)).toBe(false);
    expect(passesThrough("PL1", undefined, 3)).toBe(false);
    // Power coils with two pads per side: four pins on two nets.
    expect(passesThrough("PL701", "L_5X5X3_M", 4, 2)).toBe(true);
    expect(passesThrough("PL701", "L_5X5X3_M", 4, 3)).toBe(false);
  });
});
