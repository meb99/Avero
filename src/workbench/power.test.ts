import { describe, expect, it } from "vitest";
import type { BoardModel } from "../core/board";
import { buildPowerTree } from "../core/powerTree";
import type { Reading } from "./measure";
import { diagnosisState, expectedSequence, measuredCourse, parsePower, resolvePower, sequenceFinding, setConverterEdit, supplyStates, type ExpectedSequence, type PowerNotes, type SupplyState } from "./power";

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
  const findPin = (part: number, number: string) => {
    const p = ps[part];
    for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) if (pins[i].number.toUpperCase() === number.toUpperCase()) return i;
    return undefined;
  };
  return { parts: ps, pins, nets, testPoints: [], findNet: (n: string) => find(nets, n), findPart: (n: string) => find(ps, n), findPin } as unknown as BoardModel;
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
    const on = { power: "on" as const };
    const readings: Record<string, Reading> = {
      "+1.8V": { voltage: 0.02, at: { voltage: "2026-10-06T10:03:00Z" }, conds: { voltage: on } },
      "+19VB": { voltage: 19.1, at: { voltage: "2026-10-06T10:01:00Z" }, conds: { voltage: on } },
      "+5VALW": { voltage: 5.02, at: { voltage: "2026-10-06T10:02:00Z" }, conds: { voltage: on }, history: [{ at: "2026-10-06T09:00:00Z", voltage: 0, cond: on }] },
    };
    const course = measuredCourse(m, r, readings);
    expect(course.map((p) => [m.nets[p.net].name, p.status, p.power])).toEqual([
      ["+5VALW", "absent", "on"],
      ["+19VB", "ok", "on"],
      ["+5VALW", "ok", "on"],
      ["+1.8V", "absent", "on"],
    ]);
    const seq = expectedSequence(m, r, undefined);
    expect(sequenceFinding(seq, supplyStates(m, r, course, "on"))).toEqual({ kind: "break", step: expect.any(Number), supplies: [supply(r, "+1.8V")] });
  });

  it("takes values measured at pins and test points through their nets", () => {
    const r = resolvePower(m, tree, undefined);
    // 3,3 V at a pin of +5VALW's regulator output … only as a point, no net value.
    const points: Record<string, Reading> = { "PU2.1": { voltage: 5.0, net: "+5VALW", at: { voltage: "2026-10-06T10:00:00Z" } } };
    const course = measuredCourse(m, r, undefined, points);
    expect(course).toEqual([expect.objectContaining({ supply: supply(r, "+5VALW"), point: "PU2.1", value: 5, status: "ok" })]);
    expect(supplyStates(m, r, course, undefined).get(supply(r, "+5VALW"))?.status).toBe("ok");
  });

  it("names the places when a supply's values disagree, and does not judge it", () => {
    const r = resolvePower(m, tree, undefined);
    const readings: Record<string, Reading> = { "+5VALW": { voltage: 0.01, at: { voltage: "2026-10-06T10:01:00Z" } } };
    const points: Record<string, Reading> = { "PU3.1": { voltage: 5.01, net: "+5VALW", at: { voltage: "2026-10-06T10:02:00Z" } } };
    const state = supplyStates(m, r, measuredCourse(m, r, readings, points), undefined).get(supply(r, "+5VALW"))!;
    expect(state.status).toBe("conflict");
    expect(state.places.map((p) => [p.point ?? m.nets[p.net].name, p.status])).toEqual([
      ["+5VALW", "absent"],
      ["PU3.1", "ok"],
    ]);
  });

  it("never takes 0 V measured with the board off for a missing supply", () => {
    const r = resolvePower(m, tree, undefined);
    const readings: Record<string, Reading> = {
      "+19VB": { voltage: 19.1, conds: { voltage: { power: "on" } }, at: { voltage: "2026-10-06T10:00:00Z" } },
      "+5VALW": { voltage: 0, conds: { voltage: { power: "off" } }, at: { voltage: "2026-10-06T10:01:00Z" } },
    };
    const course = measuredCourse(m, r, readings);
    expect(course.find((p) => p.net === net("+5VALW"))).toMatchObject({ power: "off", status: "absent" });
    expect(diagnosisState(course)).toBe("on");
    const states = supplyStates(m, r, course, "on");
    expect(states.has(supply(r, "+5VALW"))).toBe(false);
    expect(sequenceFinding(expectedSequence(m, r, undefined), states)).toBeUndefined();
    // Measured with the board off and judged as such: shown, but there is no "on" value to judge.
    expect(diagnosisState(measuredCourse(m, r, { "+5VALW": readings["+5VALW"] }))).toBeUndefined();
  });

  it("in standby, a rail that is not always-on is expected off", () => {
    const r = resolvePower(m, tree, undefined);
    const readings: Record<string, Reading> = {
      "+5VS": { voltage: 0, conds: { voltage: { power: "standby" } } },
      "+5VALW": { voltage: 0, conds: { voltage: { power: "standby" } } },
    };
    const states = supplyStates(m, r, measuredCourse(m, r, readings), "standby");
    expect(states.get(supply(r, "+5VS"))?.status).toBe("idle");
    expect(states.get(supply(r, "+5VALW"))?.status).toBe("absent");
  });

  it("names only the first missing value while what it needs is not checked", () => {
    // Step 1: A and B; step 2: C needs both. A present, B not measured, C missing.
    const [A, B, C] = [0, 1, 2];
    const seq: ExpectedSequence = { steps: [{ supplies: [A, B] }, { supplies: [C] }], source: { from: "user", source: "SM" }, needs: new Map([[C, [A, B]]]) };
    const st = (status: SupplyState["status"]): SupplyState => ({ status, places: [] });
    expect(sequenceFinding(seq, new Map([[A, st("ok")], [C, st("absent")]]))).toEqual({ kind: "unchecked", step: 1, supply: C, unchecked: [B], missing: [] });
    // B measured present: now the stop is certain.
    expect(sequenceFinding(seq, new Map([[A, st("ok")], [B, st("ok")], [C, st("absent")]]))).toEqual({ kind: "break", step: 1, supplies: [C] });
    // B in conflict counts as not checked.
    expect(sequenceFinding(seq, new Map([[A, st("ok")], [B, st("conflict")], [C, st("absent")]]))).toMatchObject({ kind: "unchecked", unchecked: [B] });
    // A missing itself: the first missing value is A, in step 1.
    expect(sequenceFinding(seq, new Map([[A, st("absent")], [C, st("absent")]]))).toEqual({ kind: "break", step: 0, supplies: [A] });
  });

  it("an order set by hand needs everything in the steps before", () => {
    const r = resolvePower(m, tree, undefined);
    const seq = expectedSequence(m, r, { value: [["+19VB", "+3V_BAT"], ["+5VALW"]], source: "SM" });
    expect(seq.needs.get(supply(r, "+5VALW"))?.sort()).toEqual([supply(r, "+19VB"), supply(r, "+3V_BAT")].sort());
  });

  it("reads its notes back and leaves out what is broken", () => {
    const edits = setConverterEdit(undefined, "PU5", { kind: { value: "boost", source: "DB" }, confirmed: "Schaltplan" });
    expect(parsePower(JSON.parse(JSON.stringify({ ...edits, sequence: { value: [["+19VB"]], source: "SM" } })))).toEqual({ ...edits, sequence: { value: [["+19VB"]], source: "SM" } });
    expect(parsePower({ converters: [{ part: "X", kind: { value: "rocket", source: "?" } }, { nope: 1 }] })).toEqual({ converters: [{ part: "X" }] });
    expect(parsePower(null)).toBeUndefined();
  });
});
