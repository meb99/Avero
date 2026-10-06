import { describe, expect, it } from "vitest";
import { emptyNotes, type BoardNotes } from "./notes";
import { diffReadings } from "./readingDiff";

const notes = (reference: BoardNotes["reference"], points?: BoardNotes["referencePoints"]): BoardNotes => ({ ...emptyNotes("k", "b"), reference, ...(points && { referencePoints: points }) });
const same = (net: string) => net;

describe("diffReadings", () => {
  it("puts deviations first and keeps values that agree", () => {
    const a = notes({ PP3V3: { diode: 0.45, voltage: 3.3 }, GND: { resistance: 0 } });
    const b = notes({ PP3V3: { diode: 0.3, voltage: 3.31 }, GND: { resistance: 0 } });
    const d = diffReadings(a, b, same, 0.05);
    expect(d[0]).toEqual({ net: "PP3V3", quantity: "diode", a: 0.45, b: 0.3, status: "deviation" });
    expect(d.filter((x) => x.status === "ok").map((x) => `${x.net}/${x.quantity}`).sort()).toEqual(["GND/resistance", "PP3V3/voltage"]);
  });

  it("follows a renamed net and lists what only one board has", () => {
    const a = notes({ PP3V3_L: { diode: 0.5 }, PPBUS: { voltage: 12.6 } });
    const b = notes({ PP3V3_LX: { diode: 0.5 }, PP5V: { voltage: 5 } });
    const d = diffReadings(a, b, (n) => (n === "PP3V3_L" ? "PP3V3_LX" : undefined), 0.05);
    expect(d).toContainEqual({ net: "PP3V3_L", netB: "PP3V3_LX", quantity: "diode", a: 0.5, b: 0.5, status: "ok" });
    expect(d).toContainEqual({ net: "PPBUS", quantity: "voltage", a: 12.6, status: "onlyA" });
    expect(d).toContainEqual({ net: "PP5V", quantity: "voltage", b: 5, status: "onlyB" });
  });

  it("does not compare readings taken under other conditions, the revision aside", () => {
    const a = notes({ X: { diode: 0.4, conds: { diode: { revision: "A", assembly: "ic-removed" } } }, Y: { diode: 0.4, conds: { diode: { revision: "A" } } } });
    const b = notes({ X: { diode: 0.7, conds: { diode: { revision: "B", assembly: "complete" } } }, Y: { diode: 0.4, conds: { diode: { revision: "B" } } } });
    const d = diffReadings(a, b, same, 0.05);
    expect(d.find((x) => x.net === "X")?.status).toBe("conditions");
    expect(d.find((x) => x.net === "Y")?.status).toBe("ok");
  });

  it("pairs readings at the same pin", () => {
    const a = notes({}, { "U7.3": { diode: 0.5, net: "PP1V8" } });
    const b = notes({}, { "U7.3": { diode: "OL", net: "PP1V8_S0" } });
    expect(diffReadings(a, b, same, 0.05)).toEqual([{ net: "PP1V8", netB: "PP1V8_S0", point: "U7.3", quantity: "diode", a: 0.5, b: "OL", status: "deviation" }]);
  });

  it("pairs readings of two nets that swapped names by their pins, not their names", () => {
    const a = notes({ NET_A: { diode: 0.5 }, NET_B: { diode: 0.3 } });
    const b = notes({ NET_B: { diode: 0.5 }, NET_A: { diode: 0.3 } });
    const swapped = (n: string) => (n === "NET_A" ? "NET_B" : n === "NET_B" ? "NET_A" : undefined);
    const d = diffReadings(a, b, swapped, 0.05);
    expect(d.map((x) => x.status)).toEqual(["ok", "ok"]);
    expect(d).toContainEqual({ net: "NET_A", netB: "NET_B", quantity: "diode", a: 0.5, b: 0.5, status: "ok" });
  });
});
