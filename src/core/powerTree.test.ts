import { describe, expect, it } from "vitest";
import type { BoardModel } from "./board";
import { buildPowerTree, powerTreeRoots, railRank } from "./powerTree";

function board(parts: { name: string; device?: string; nets: string[] }[], signals: string[] = []): BoardModel {
  const names = [...new Set(parts.flatMap((p) => p.nets))];
  const pins: { part: number; number: string; net: number }[] = [];
  const ps = parts.map((p, i) => {
    const firstPin = pins.length;
    p.nets.forEach((n, k) => pins.push({ part: i, number: String(k + 1), net: names.indexOf(n) }));
    return { name: p.name, device: p.device, firstPin, pinCount: p.nets.length };
  });
  const kind = (n: string) => (n === "GND" ? "ground" : signals.includes(n) || !/^\+|V/.test(n) ? "signal" : "power");
  const nets = names.map((name, i) => ({ name, kind: kind(name), pins: pins.flatMap((p, k) => (p.net === i ? [k] : [])) }));
  return { parts: ps, pins, nets } as unknown as BoardModel;
}

// A small notebook power section: adapter → fuse → bus, a 3V/5V controller
// with external MOSFETs and 4-pad coils, an LDO, a load switch, a charger.
const m = board(
  [
    { name: "PF1", device: "FUSE_7A", nets: ["+19V_VIN", "+19VB"] },
    { name: "PU1", device: "RT6575", nets: ["+19VB", "LX_5V", "LX_3V", "UG_5V", "+5VALW", "3V5V_EN", "GND", "PWR_5V_VCC"] },
    { name: "PQ1", device: "AON7380", nets: ["+19VB", "LX_5V", "UG_5V"] },
    { name: "PQ2", device: "AON7380", nets: ["LX_5V", "GND", "LG_5V"] },
    { name: "PL1", device: "L_5X5X3", nets: ["LX_5V", "LX_5V", "+5VALWP", "+5VALWP"] },
    { name: "PJ1", device: "JUMP_43X79", nets: ["+5VALWP", "+5VALW"] },
    { name: "PL2", device: "L_4X4", nets: ["LX_3V", "+3VALW"] },
    { name: "PU2", device: "G9661", nets: ["+5VALW", "+2.5V", "GND", "2.5V_EN"] },
    { name: "Q5", device: "PJ2301", nets: ["+3VALW", "+3VS", "3VS_EN#"] },
    { name: "PU3", device: "ISL88739", nets: ["+19VB", "LX_CHG", "GND", "ACIN_CHG"] },
    { name: "PL3", device: "L_7X7", nets: ["LX_CHG", "+12.6V_BATT"] },
  ],
  ["3VS_EN#"],
);

describe("power tree", () => {
  const tree = buildPowerTree(m);
  const supply = (name: string) => tree.supplyOf.get(m.nets.findIndex((n) => n.name === name))!;
  const conv = (name: string) => tree.converters.find((c) => m.parts[c.part].name === name)!;

  it("joins rails through fuses, jumpers and coils", () => {
    expect(supply("+19V_VIN")).toBe(supply("+19VB"));
    expect(supply("+5VALWP")).toBe(supply("+5VALW"));
    // Switch nodes and the regulator's own bias pin are no rails.
    expect(tree.supplyOf.has(m.nets.findIndex((n) => n.name === "LX_5V"))).toBe(false);
    expect(tree.supplyOf.has(m.nets.findIndex((n) => n.name === "PWR_5V_VCC"))).toBe(false);
  });

  it("finds regulators, linear regulators and load switches with their direction", () => {
    expect(conv("PU1")).toMatchObject({ kind: "regulator", input: supply("+19VB") });
    expect(conv("PU1").outputs.sort()).toEqual([supply("+5VALW"), supply("+3VALW")].sort());
    expect(conv("PU2")).toMatchObject({ kind: "linear", input: supply("+5VALW"), outputs: [supply("+2.5V")] });
    expect(conv("Q5")).toMatchObject({ kind: "switch", input: supply("+3VALW"), outputs: [supply("+3VS")] });
    expect(conv("PU3")).toMatchObject({ kind: "regulator", input: supply("+19VB"), outputs: [supply("+12.6V_BATT")] });
    // MOSFETs of a switching stage are no load switches.
    expect(tree.converters.some((c) => m.parts[c.part].name === "PQ1")).toBe(false);
  });

  it("grows the tree from the adapter down", () => {
    const { roots } = powerTreeRoots(tree);
    expect(roots.map((r) => r.supply)).toEqual([supply("+19VB")]);
    const below = roots[0].children.flatMap((c) => c.outputs.map((o) => o.supply));
    expect(below).toContain(supply("+5VALW"));
    const fiveV = roots[0].children.flatMap((c) => c.outputs).find((o) => o.supply === supply("+5VALW"))!;
    expect(fiveV.children.map((c) => m.parts[tree.converters[c.converter].part].name)).toEqual(["PU2"]);
  });

  it("ranks always-on rails above switched ones", () => {
    expect(railRank("+3VALW")).toBeGreaterThan(railRank("+3VS"));
    expect(railRank("PP3V3_S5")).toBeGreaterThan(railRank("PP3V3_S0"));
  });
});
