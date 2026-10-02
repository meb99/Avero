import { describe, expect, it } from "vitest";
import { flowFromCase, flowPath, judgeFlow, parseFlows, stepState, type FlowStep } from "./flows";
import { addCase, emptyNotes, setValue, updateCase } from "./notes";

describe("judgeFlow", () => {
  it("judges values, ranges and kinds", () => {
    expect(judgeFlow({ kind: "value", value: 3.3, tolerance: 0.1 }, 3.2, "voltage")).toBe("ok");
    expect(judgeFlow({ kind: "value", value: 3.3, tolerance: 0.1 }, 2.5, "voltage")).toBe("bad");
    expect(judgeFlow({ kind: "value", value: 0.42, tolerance: 0.1 }, 0.43, "diode")).toBe("ok");
    expect(judgeFlow({ kind: "range", min: 2, max: 3.5 }, 3.8, "voltage")).toBe("bad");
    expect(judgeFlow({ kind: "high" }, 3.3, "voltage")).toBe("ok");
    expect(judgeFlow({ kind: "low" }, 0.1, "voltage")).toBe("ok");
    expect(judgeFlow({ kind: "ol" }, "OL", "diode")).toBe("ok");
    expect(judgeFlow({ kind: "noShort" }, 0.004, "diode")).toBe("bad");
    expect(judgeFlow({ kind: "noShort" }, "OL", "diode")).toBe("ok");
    expect(judgeFlow({ kind: "present" }, 0.2, "voltage")).toBe("bad");
    expect(judgeFlow({ kind: "high" }, undefined, "voltage")).toBeUndefined();
  });
});

describe("flowPath", () => {
  const step = (id: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, title: id, points: [], ...extra });

  it("shows every step of a flow without branches", () => {
    const steps = [step("a"), step("b"), step("c")];
    expect(flowPath(steps, ["ok", "open", "empty"])).toEqual([0, 1, 2]);
  });

  it("stops at a deviation without a branch", () => {
    const steps = [step("a"), step("b"), step("c")];
    expect(flowPath(steps, ["ok", "bad", "open"])).toEqual([0, 1]);
  });

  it("follows branches and never loops", () => {
    const steps = [step("a", { onBad: "c" }), step("b", { onOk: null }), step("c", { onOk: "a" })];
    expect(flowPath(steps, ["bad", "open", "ok"])).toEqual([0, 2]);
    expect(flowPath(steps, ["ok", "ok", "ok"])).toEqual([0, 1]);
  });

  it("derives step states from readings", () => {
    const s: FlowStep = { id: "x", title: "x", points: [{ net: "VBUS", quantity: "voltage", expect: { kind: "high" } }] };
    expect(stepState(s, () => undefined)).toBe("open");
    expect(stepState(s, () => 5)).toBe("ok");
    expect(stepState(s, () => 0)).toBe("bad");
  });
});

describe("flowFromCase", () => {
  it("turns a repair into a route with the reference as expectation", () => {
    let n = addCase(emptyNotes("hac-cpu-20", "Switch"), "Kunde A");
    const id = n.activeCase!;
    n = setValue(n, "reference", "VBUS", "diode", 0.45);
    n = setValue(n, { caseId: id }, "VBUS", "diode", 0.02);
    n = setValue(n, { caseId: id }, "PP1V8", "voltage", 1.8);
    n = updateCase(n, id, { notes: "M92T36 getauscht", device: "Switch" });
    const flow = flowFromCase(n, id, "Lädt nicht")!;
    expect(flow.boardKey).toBe("hac-cpu-20");
    expect(flow.device).toBe("Switch");
    expect(flow.steps.map((s) => s.title)).toEqual(["VBUS", "PP1V8"]);
    expect(flow.steps[0].points[0]).toMatchObject({ quantity: "diode", expect: { kind: "value", value: 0.45 }, source: "reference" });
    expect(flow.steps[1].points[0]).toMatchObject({ expect: { kind: "value", value: 1.8 }, source: "case" });
    expect(flow.steps[0].hint).toBe("M92T36 getauscht");
    // Stored and read back.
    expect(parseFlows(JSON.stringify([flow]))).toEqual([flow]);
  });

  it("drops broken entries when reading flows", () => {
    expect(parseFlows('[{"id":"a","title":"x","steps":[{"id":"s","title":"t","points":[{"net":"X","quantity":"volt","expect":{"kind":"high"}}]}]}, {"title":"no id"}]')).toEqual([
      { id: "a", title: "x", created: new Date(0).toISOString(), steps: [{ id: "s", title: "t", points: [] }] },
    ]);
    expect(parseFlows("not json")).toEqual([]);
  });
});
