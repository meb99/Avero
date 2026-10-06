import { describe, expect, it } from "vitest";
import { addCase, emptyNotes, judgeTaken, setConditions, setPointValue, setValue, type BoardNotes } from "./notes";

const caseOf = (n: BoardNotes) => ({ caseId: n.activeCase! });

/** Reference 0,480 V (diode, red probe on ground, board off) and 3,3 V (board on); a case with its own conditions. */
function notes(caseConditions: Parameters<typeof setConditions>[2]): BoardNotes {
  let n = setConditions(emptyNotes("k", "b"), "reference", { polarity: "red-gnd", power: "off" });
  n = setValue(n, "reference", "PP1V8", "diode", 0.48);
  n = setPointValue(n, "reference", "U7.1", "PP1V8", "diode", 0.48);
  n = setConditions(n, "reference", { power: "on" });
  n = setValue(n, "reference", "PP3V3", "voltage", 3.3);
  n = addCase(n, "Kunde");
  return setConditions(n, caseOf(n), caseConditions);
}

describe("a value taken in the bench mode", () => {
  it("is not comparable when the probes are the other way round", () => {
    const n = notes({ polarity: "black-gnd", power: "off" });
    expect(judgeTaken(n, caseOf(n), "Referenz", "PP1V8", "diode", 0.48, 0.1)).toBe("mismatch");
    // Without the case's conditions the same value would pass: the error this guards against.
    expect(judgeTaken({ ...n, cases: n.cases.map((c) => ({ ...c, conditions: undefined })) }, caseOf(n), "Referenz", "PP1V8", "diode", 0.48, 0.1)).toBe("ok");
  });

  it("is not comparable when the board is in another state", () => {
    const n = notes({ power: "off" });
    expect(judgeTaken(n, caseOf(n), "Referenz", "PP3V3", "voltage", 3.3, 0.1)).toBe("mismatch");
    const standby = notes({ power: "standby" });
    expect(judgeTaken(standby, caseOf(standby), "Referenz", "PP1V8", "diode", 0.48, 0.1)).toBe("mismatch");
  });

  it("is judged when the conditions fit, also at a single point", () => {
    const n = notes({ polarity: "red-gnd", power: "off" });
    expect(judgeTaken(n, caseOf(n), "Referenz", "PP1V8", "diode", 0.48, 0.1)).toBe("ok");
    expect(judgeTaken(n, caseOf(n), "Referenz", "PP1V8", "diode", 0.3, 0.1)).toBe("deviation");
    expect(judgeTaken(n, caseOf(n), "Referenz", "PP1V8", "diode", 0.3, 0.1, "U7.1")).toBe("deviation");
    const on = notes({ power: "on" });
    expect(judgeTaken(on, caseOf(on), "Referenz", "PP3V3", "voltage", 3.31, 0.1)).toBe("ok");
  });
});
