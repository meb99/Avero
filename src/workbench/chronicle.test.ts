import { describe, expect, it } from "vitest";
import { chronicle, measureEvents, stepEvidence } from "./chronicle";
import type { RepairCase } from "./notes";

// Short to ground on PP3V3 found, C7012 removed, short gone, new cap fitted, then a function test.
const repair: RepairCase = {
  id: "c1",
  title: "Kurzschluss",
  created: "2026-10-01T08:00:00.000Z",
  notes: "",
  readings: {
    PP3V3: {
      resistance: 12500,
      at: { resistance: "2026-10-01T10:00:00.000Z" },
      history: [
        { at: "2026-10-01T08:10:00.000Z", resistance: 0.4 },
        { at: "2026-10-01T09:05:00.000Z", resistance: 12000 },
      ],
    },
    PP1V8: { resistance: 300, at: { resistance: "2026-10-01T08:20:00.000Z" } },
  },
  points: { "C7012.1": { diode: 0.45, at: { diode: "2026-10-01T09:10:00.000Z" } } },
  steps: [
    { id: "s1", at: "2026-10-01T09:00:00.000Z", action: "removed", target: "C7012", nets: ["PP3V3", "GND"] },
    { id: "s2", at: "2026-10-01T09:30:00.000Z", action: "replaced", target: "C7012", nets: ["PP3V3", "GND"] },
    { id: "s3", at: "2026-10-01T11:00:00.000Z", action: "functionTest", result: "ok" },
  ],
};

describe("repair chronicle (F54)", () => {
  it("lists every value with when it was taken, history included", () => {
    const events = measureEvents(repair);
    expect(events.map((e) => [e.subject, e.value])).toEqual([
      ["PP3V3", 0.4],
      ["PP1V8", 300],
      ["PP3V3", 12000],
      ["C7012.1", 0.45],
      ["PP3V3", 12500],
    ]);
  });

  it("shows the value before a change and the one after it, not one after the next change", () => {
    const removed = stepEvidence(repair, repair.steps![0]);
    const net = removed.find((e) => e.subject === "PP3V3")!;
    expect(net.before?.value).toBe(0.4);
    expect(net.after?.value).toBe(12000);
    // The point on the removed part counts too.
    expect(removed.find((e) => e.subject === "C7012.1")?.after?.value).toBe(0.45);
    // PP1V8 is not touched.
    expect(removed.some((e) => e.subject === "PP1V8")).toBe(false);

    const replaced = stepEvidence(repair, repair.steps![1]).find((e) => e.subject === "PP3V3")!;
    expect(replaced.before?.value).toBe(12000);
    expect(replaced.after?.value).toBe(12500);

    // No reading between two changes to the same net: the one after the second says nothing about the first.
    const twice: RepairCase = {
      ...repair,
      steps: [
        { id: "a", at: "2026-10-01T08:30:00.000Z", action: "reflowed", nets: ["PP1V8"] },
        { id: "b", at: "2026-10-01T08:40:00.000Z", action: "replaced", nets: ["PP1V8"] },
      ],
      readings: { PP1V8: { resistance: 310, at: { resistance: "2026-10-01T09:00:00.000Z" }, history: [{ at: "2026-10-01T08:20:00.000Z", resistance: 300 }] } },
    };
    const first = stepEvidence(twice, twice.steps![0])[0];
    expect(first.before?.value).toBe(300);
    expect(first.after).toBeUndefined();
    expect(stepEvidence(twice, twice.steps![1])[0].after?.value).toBe(310);
  });

  it("puts steps and readings in the order they happened", () => {
    const kinds = chronicle(repair).map((e) => (e.kind === "step" ? e.step.action : `${e.event.subject}`));
    expect(kinds).toEqual(["PP3V3", "PP1V8", "removed", "PP3V3", "C7012.1", "replaced", "PP3V3", "functionTest"]);
  });
});
