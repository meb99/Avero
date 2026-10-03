import { describe, expect, it } from "vitest";
import type { BoardModel } from "./board";
import { packageSize, shortCandidates } from "./shortFinder";

function board(parts: { name: string; device?: string; nets: string[] }[]): BoardModel {
  const names = [...new Set(parts.flatMap((p) => p.nets))];
  const pins: { part: number; number: string; net: number }[] = [];
  const ps = parts.map((p, i) => {
    const firstPin = pins.length;
    p.nets.forEach((n, k) => pins.push({ part: i, number: String(k + 1), net: names.indexOf(n) }));
    return { name: p.name, device: p.device, firstPin, pinCount: p.nets.length };
  });
  const nets = names.map((name, i) => ({ name, kind: name === "GND" ? "ground" : "power", pins: pins.flatMap((p, k) => (p.net === i ? [k] : [])) }));
  return { parts: ps, pins, nets } as unknown as BoardModel;
}

describe("short candidates", () => {
  it("reads package sizes", () => {
    expect(packageSize("C_0402")).toBe(3);
    expect(packageSize("10U_0805_25V6K")).toBe(5);
    expect(packageSize("CAP 22UF 1206")).toBe(6);
    expect(packageSize("C0402_0OHM")).toBe(3);
    expect(packageSize("QFN32")).toBe(0);
  });

  it("lists big caps first, then chips, only parts that reach ground", () => {
    const m = board([
      { name: "C1", device: "C_0402", nets: ["PP3V3", "GND"] },
      { name: "C2", device: "C_0805", nets: ["PP3V3", "GND"] },
      { name: "U1", device: "QFN32", nets: ["PP3V3", "GND", "SDA"] },
      { name: "R1", device: "R_0402", nets: ["PP3V3", "GND"] },
      { name: "L1", nets: ["PP3V3", "PP3V3_L"] },
      { name: "C3", device: "C_1206", nets: ["PP3V3", "PP3V3_L"] },
      { name: "PQ1", device: "AON7380", nets: ["PP3V3", "GND", "EN"] },
    ]);
    const c = shortCandidates(m, 0).map((x) => m.parts[x.part].name);
    expect(c).toEqual(["C2", "C1", "U1", "PQ1"]);
  });
});
