import { describe, expect, it } from "vitest";
import {
  addCase,
  boardKey,
  emptyNotes,
  mergeNotes,
  netStatuses,
  parseNotes,
  removeCase,
  setReading,
  setValue,
} from "./notes";

describe("boardKey", () => {
  it("uses the board number so formats of one board share notes", () => {
    expect(boardKey({ name: "x", path: "/Boards/Apple/820-02100.brd" })).toBe("820-02100");
    expect(boardKey({ name: "x", path: "/Boards/Apple/J413 820-02100 boardview.bdv" })).toBe("820-02100");
    expect(boardKey({ name: "x", path: "/Boards/X1C6 NM-B481/pins.asc" })).toBe("nm-b481");
    expect(boardKey({ name: "x", path: "/tmp/myboard.brd" })).toBe("myboard");
    expect(boardKey({ name: "Avero Demo" })).toBe("avero-demo");
  });
});

describe("board notes", () => {
  const base = emptyNotes("820-02100", "820-02100.brd");

  it("stores and clears readings", () => {
    let n = setValue(base, "reference", "PP3V3", "voltage", 3.3);
    expect(n.reference.PP3V3.voltage).toBe(3.3);
    n = setValue(n, "reference", "PP3V3", "voltage", undefined);
    expect(n.reference.PP3V3).toBeUndefined();
    expect(base.reference).toEqual({});
  });

  it("compares the active case with the reference", () => {
    let n = setReading(base, "reference", "PP3V3", { diode: 0.45 });
    n = setReading(n, "reference", "GND", { resistance: 0 });
    n = addCase(n, "Kunde A");
    const id = n.activeCase!;
    n = setReading(n, { caseId: id }, "PP3V3", { diode: 0.05 });
    n = setReading(n, { caseId: id }, "I2C0_SDA", { diode: 0.6 });
    const s = netStatuses(n, 0.1);
    expect(s.get("PP3V3")).toBe("deviation");
    expect(s.get("GND")).toBe("reference");
    expect(s.get("I2C0_SDA")).toBe("measured");
    n = setReading(n, { caseId: id }, "PP3V3", { diode: 0.44 });
    expect(netStatuses(n, 0.1).get("PP3V3")).toBe("ok");
  });

  it("switches to another case when the active one is removed", () => {
    let n = addCase(addCase(base, "A"), "B");
    const [a, b] = n.cases.map((c) => c.id);
    expect(n.activeCase).toBe(b);
    n = removeCase(n, b);
    expect(n.activeCase).toBe(a);
  });

  it("round-trips through JSON and rejects foreign data", () => {
    const n = setReading(addCase(base, "A"), "reference", "PP3V3", { voltage: 3.3, note: "nach C1" });
    expect(parseNotes(JSON.stringify(n))).toEqual(n);
    expect(parseNotes("{}")).toBeNull();
    expect(parseNotes("nope")).toBeNull();
  });

  it("merges imports, newer readings win", () => {
    const mine = setReading(base, "reference", "PP3V3", { voltage: 3.3, updated: "2026-01-01T00:00:00Z" });
    const theirs = {
      ...setReading(base, "reference", "PP3V3", { voltage: 3.28 }),
      notes: "Referenz von Werkstatt B",
    };
    const merged = mergeNotes(mine, setReading(theirs, "reference", "PP1V8", { voltage: 1.8 }));
    expect(merged.reference.PP3V3.voltage).toBe(3.28);
    expect(merged.reference.PP1V8.voltage).toBe(1.8);
    expect(merged.notes).toBe("Referenz von Werkstatt B");
  });
});
