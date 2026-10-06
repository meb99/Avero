import { describe, expect, it } from "vitest";
import type { BoardModel } from "../core/board";
import { buildPowerTree } from "../core/powerTree";
import { expectedSequence, latestStatus, measuredCourse, parsePower, resolvePower, sequenceBreak, setConverterEdit, type PowerNotes } from "./power";

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
  const find = <T extends { name: string }>(list: T[], name: string) => {
    const i = list.findIndex((x) => x.name.toUpperCase() === name.toUpperCase());
    return i < 0 ? undefined : i;
  };
  return { parts: ps, pins, nets, findNet: (n: string) => find(nets, n), findPart: (n: string) => find(ps, n) } as unknown as BoardModel;
}

// Adapter bus → 5 V buck (enable and power-good named) → 1.8 V LDO → 5 V load switch;
// a boost converter the copper reads backwards (its coil sits at the input).
const m = board(
  [
    { name: "PU1", device: "RT6575", nets: ["+19VB", "LX_5V", "+5VALW", "EN_5V", "PG_5V", "GND"] },
    { name: "PL1", device: "L_4X4", nets: ["LX_5V", "+5VALW"] },
    { name: "PU2", device: "G9661", nets: ["+5VALW", "+1.8V", "GND", "PG_5V"] },
    { name: "PU3", device: "SLG5NT", nets: ["+5VALW", "+5VS", "GND", "EN_5VS"] },
    { name: "PU5", device: "TPS61088", nets: ["+3V_BAT", "LX_BST", "+12V_BST", "GND"] },
    { name: "PL5", device: "L_4X4", nets: ["+3V_BAT", "LX_BST"] },
  ],
  ["EN_5V", "PG_5V", "EN_5VS"],
);
const net = (name: string) => m.nets.findIndex((n) => n.name === name);
const tree = buildPowerTree(m);
const supply = (t: { supplyOf: Map<number, number> }, name: string) => t.supplyOf.get(net(name))!;

describe("power tree with its sources", () => {
  it("says why the copper took each input, names enable and power-good, and offers the other inputs", () => {
    const r = resolvePower(m, tree, undefined);
    const pu1 = r.converters.find((c) => c.name === "PU1")!;
    expect(pu1.prov.input).toEqual({ from: "copper", why: "highest" });
    expect(pu1.prov.outputs).toEqual({ from: "copper", why: "coil" });
    expect(pu1.enable).toBe(net("EN_5V"));
    expect(pu1.powerGood).toBe(net("PG_5V"));
    expect(pu1.prov.enable).toEqual({ from: "copper", why: "name" });
  });

  it("takes a correction with its source over the copper reading (a boost makes the higher voltage)", () => {
    const wrong = resolvePower(m, tree, undefined).converters.find((c) => c.name === "PU5")!;
    // Read backwards: the coil's rail looks like the output.
    expect(wrong.outputs).toEqual([supply(tree, "+3V_BAT")]);
    const edits: PowerNotes = setConverterEdit(undefined, "PU5", {
      kind: { value: "boost", source: "Datenblatt TPS61088" },
      input: { value: "+3V_BAT", source: "Datenblatt TPS61088" },
      outputs: { value: ["+12V_BST"], source: "Schaltplan S. 41" },
    });
    const r = resolvePower(m, tree, edits);
    const pu5 = r.converters.find((c) => c.name === "PU5")!;
    expect(pu5.kind).toBe("boost");
    expect(pu5.input).toBe(supply(r, "+3V_BAT"));
    expect(pu5.outputs).toEqual([supply(r, "+12V_BST")]);
    expect(pu5.prov.input).toEqual({ from: "user", source: "Datenblatt TPS61088" });
    expect(pu5.prov.outputs).toEqual({ from: "user", source: "Schaltplan S. 41" });
  });

  it("drops a converter marked as none and takes one added by hand", () => {
    let edits = setConverterEdit(undefined, "PU3", { removed: true });
    edits = setConverterEdit(edits, "PL1", { kind: { value: "linear", source: "eigene" }, input: { value: "+5VALW", source: "eigene" } });
    const r = resolvePower(m, tree, edits);
    expect(r.converters.some((c) => c.name === "PU3")).toBe(false);
    expect(r.converters.find((c) => c.name === "PL1")).toMatchObject({ added: true, kind: "linear" });
  });

  it("works out the expected order from inputs and enable/power-good chains", () => {
    // PU3's enable is PU1's power-good: +5VS after +5VALW, and after what PU1 makes.
    const edits = setConverterEdit(undefined, "PU3", { enable: { value: "PG_5V", source: "Schaltplan S. 12" } });
    const r = resolvePower(m, tree, edits);
    const seq = expectedSequence(m, r, undefined);
    expect(seq.source).toEqual({ from: "derived" });
    const stepOf = (name: string) => seq.steps.findIndex((s) => s.supplies.includes(supply(r, name)));
    expect(stepOf("+19VB")).toBeLessThan(stepOf("+5VALW"));
    expect(stepOf("+5VALW")).toBeLessThan(stepOf("+1.8V"));
    expect(stepOf("+5VALW")).toBeLessThan(stepOf("+5VS"));
  });

  it("takes an order set by hand as it is, with its source", () => {
    const r = resolvePower(m, tree, undefined);
    const seq = expectedSequence(m, r, { value: [["+19VB"], ["+1.8V", "+5VALW"], ["NOT_A_NET"]], source: "Service Manual S. 3" });
    expect(seq.source).toEqual({ from: "user", source: "Service Manual S. 3" });
    expect(seq.steps.map((s) => s.supplies)).toEqual([[supply(r, "+19VB")], [supply(r, "+1.8V"), supply(r, "+5VALW")]]);
  });

  it("keeps what was measured apart, in measured order, and finds where the sequence stops", () => {
    const r = resolvePower(m, tree, undefined);
    const readings = {
      "+1.8V": { voltage: 0.02, at: { voltage: "2026-10-06T10:03:00Z" } },
      "+19VB": { voltage: 19.1, at: { voltage: "2026-10-06T10:01:00Z" } },
      "+5VALW": { voltage: 5.02, at: { voltage: "2026-10-06T10:02:00Z" }, history: [{ at: "2026-10-06T09:00:00Z", voltage: 0 }] },
    };
    const course = measuredCourse(m, r, readings);
    expect(course.map((p) => [m.nets[p.net].name, p.status])).toEqual([
      ["+5VALW", "absent"],
      ["+19VB", "ok"],
      ["+5VALW", "ok"],
      ["+1.8V", "absent"],
    ]);
    const seq = expectedSequence(m, r, undefined);
    expect(sequenceBreak(seq, latestStatus(course))?.supplies).toEqual([supply(r, "+1.8V")]);
  });

  it("reads its notes back and leaves out what is broken", () => {
    const edits = setConverterEdit(undefined, "PU5", { kind: { value: "boost", source: "DB" }, confirmed: "Schaltplan" });
    expect(parsePower(JSON.parse(JSON.stringify({ ...edits, sequence: { value: [["+19VB"]], source: "SM" } })))).toEqual({ ...edits, sequence: { value: [["+19VB"]], source: "SM" } });
    expect(parsePower({ converters: [{ part: "X", kind: { value: "rocket", source: "?" } }, { nope: 1 }] })).toEqual({ converters: [{ part: "X" }] });
    expect(parsePower(null)).toBeUndefined();
  });
});
