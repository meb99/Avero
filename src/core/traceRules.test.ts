import { describe, expect, it } from "vitest";
import type { BoardModel } from "./board";
import { partLinks, traceNet } from "./trace";
import { parseTraceRules, pinSpec, ruleFor, ruleKind, rulePassage, serializeTraceRules } from "./traceRules";
import type { Board, Pin } from "./types";

// Lines as in NexusBV's tracedef.txt.
const NEXUS = `Enabled,Marker,Type,Number of pins,Contains,Pins In,Pins Out,Package
1,"C, PC",Capacitor,2,"","","",""
1,"PL, L",Inductor,2,"","","",""
1,PQ,Mosfet,8,AON6403,5-8,1-3,DFN-8
1,PR,Resistor,4,0.005_1206_1% R_1206_4P-D,"1,2","4,3",""
1,PU,Step down regulator,19,MP2941FGL-Z,2,"11-12,16",QFN19 3X4
0,PU,DrMOS,24,AOZ5049QI,"6,22","5,13",QFN-24L 3.5X5mm
1,PU,DrMOS,33,"UP9646BQDBA,NCP302155MNTWG",8-11,16-26,PQFN33 5X5
`;

describe("trace rules in NexusBV's CSV form", () => {
  it("reads markers, pin counts, part numbers and pin ranges", () => {
    const { rules, skipped } = parseTraceRules(NEXUS);
    expect(skipped).toEqual([]);
    expect(rules).toHaveLength(7);
    expect(rules[0]).toMatchObject({ enabled: true, markers: ["C", "PC"], type: "Capacitor", pinCount: 2, contains: [], pinsIn: [], pinsOut: [] });
    expect(rules[2]).toMatchObject({ markers: ["PQ"], pinCount: 8, contains: ["AON6403"], pinsIn: ["5", "6", "7", "8"], pinsOut: ["1", "2", "3"], package: "DFN-8" });
    expect(rules[4].pinsOut).toEqual(["11", "12", "16"]);
    expect(rules[5].enabled).toBe(false);
    expect(rules[6].contains).toEqual(["UP9646BQDBA", "NCP302155MNTWG"]);
  });

  it("names lines it cannot read instead of guessing", () => {
    const { rules, skipped } = parseTraceRules("1,,Capacitor,2,,,\n1,PQ,Mosfet,x,,1,2,\n1,PQ,Mosfet,,,1,2,");
    expect(skipped).toEqual([1, 2]);
    expect(rules).toHaveLength(1);
    expect(rules[0].pinCount).toBeUndefined();
  });

  it("writes the same rules back", () => {
    const { rules } = parseTraceRules(NEXUS);
    const again = parseTraceRules(serializeTraceRules(rules)).rules;
    expect(again).toEqual(rules);
    expect(serializeTraceRules(rules)).toContain('1,PQ,Mosfet,8,AON6403,5-8,1-3,DFN-8');
    expect(serializeTraceRules(rules)).toContain('"11-12,16"');
  });

  it("expands pin ranges", () => {
    expect(pinSpec("16-26")).toHaveLength(11);
    expect(pinSpec("A1-A3")).toEqual(["A1-A3"]);
    expect(pinSpec("")).toEqual([]);
  });

  it("prefers a rule naming the part number over a general one", () => {
    const { rules } = parseTraceRules(NEXUS);
    expect(ruleFor(rules, { name: "PQ12", device: "AON6403_DFN8", pinCount: 8 })?.contains).toEqual(["AON6403"]);
    expect(ruleFor(rules, { name: "PQ12", device: "OTHER", pinCount: 8 })).toBeUndefined();
    expect(ruleFor(rules, { name: "PU5", device: "AOZ5049QI", pinCount: 24 })).toBeUndefined();
    expect(ruleFor(rules, { name: "L7", device: "1uH", pinCount: 2 })?.type).toBe("Inductor");
    expect(ruleFor(rules, { name: "L7", device: "1uH", pinCount: 3 })).toBeUndefined();
  });

  it("passes from in to out pins and back", () => {
    const rule = parseTraceRules(NEXUS).rules[2];
    expect(rulePassage(rule, ["6"]).pins).toEqual(["1", "2", "3"]);
    expect(rulePassage(rule, ["2"]).pins).toEqual(["5", "6", "7", "8"]);
    expect(rulePassage(rule, ["4"]).pins).toEqual([]);
    expect(ruleKind(rule)).toBe("switch");
    expect(ruleKind(parseTraceRules(NEXUS).rules[3])).toBe("through");
    expect(ruleKind(parseTraceRules(NEXUS).rules[6])).toBe("rule");
  });
});

/** A DrMOS PU1 from PPVIN (pins 1-2) to its phase PHASE (pins 3-4), enable on pin 5, ground on 6; L1 on to VCORE. */
function drmosBoard(): BoardModel {
  const pin = (part: number, number: string, net: number): Pin => ({ part, number, x: 0, y: 0, radius: 5, side: "top", net });
  const board: Board = {
    format: "test",
    formatName: "test",
    unit: "mil",
    outline: [],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    parts: [
      { name: "PU1", side: "top", mount: "smd", firstPin: 0, pinCount: 6, outline: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, device: "TESTDRMOS_QFN" },
      { name: "PL1", side: "top", mount: "smd", firstPin: 6, pinCount: 2, outline: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, device: "0.22uH" },
    ],
    pins: [pin(0, "1", 0), pin(0, "2", 0), pin(0, "3", 1), pin(0, "4", 1), pin(0, "5", 3), pin(0, "6", 4), pin(1, "1", 1), pin(1, "2", 2)],
    testPoints: [],
    nets: [
      { name: "PPVIN", kind: "power", pins: [0, 1], testPoints: [] },
      { name: "PHASE", kind: "signal", pins: [2, 3, 6], testPoints: [] },
      { name: "VCORE", kind: "power", pins: [7], testPoints: [] },
      { name: "DRMOS_EN", kind: "signal", pins: [4], testPoints: [] },
      { name: "GND", kind: "ground", pins: [5], testPoints: [] },
    ],
    warnings: [],
  };
  return board as unknown as BoardModel;
}

describe("tracing with own rules", () => {
  const rules = parseTraceRules("1,PU,DrMOS,6,TESTDRMOS,1-2,3-4,\n").rules;

  it("follows a supply through a many-pin part from its input to its output", () => {
    const model = drmosBoard();
    expect(traceNet(model, 0)).toEqual([]);
    const links = traceNet(model, 0, undefined, rules);
    expect(links.map((l) => [model.nets[l.net].name, l.kind])).toEqual([
      ["PHASE", "rule"],
      ["VCORE", "through"],
    ]);
  });

  it("passes nothing from pins outside the rule", () => {
    const model = drmosBoard();
    expect(partLinks(model, 0, 3, rules)).toBeNull();
    expect(traceNet(model, 3, undefined, rules)).toEqual([]);
  });

  it("goes back from the output to the input", () => {
    const model = drmosBoard();
    expect(partLinks(model, 0, 1, rules)).toEqual({ kind: "rule", nets: [0] });
  });
});
