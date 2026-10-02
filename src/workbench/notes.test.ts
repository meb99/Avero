import { describe, expect, it } from "vitest";
import {
  addCase,
  addList,
  listProgress,
  setConditions,
  addMarker,
  boardKey,
  caseToReference,
  emptyNotes,
  linkObdata,
  mergeNotes,
  netStatuses,
  parseNotes,
  removeCase,
  removeMarker,
  renameNet,
  setReading,
  setValue,
  updateMarker,
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

describe("own net names", () => {
  it("renames a net and moves its readings, and gives the file name back", () => {
    let n = setValue(emptyNotes("k", "k"), "reference", "Net10", "diode", 0);
    n = addCase(n, "Fall 1");
    n = setValue(n, { caseId: n.activeCase! }, "Net10", "diode", 0.002);
    n = renameNet(n, "Net10", "Net10", "GND");
    expect(n.netNames).toEqual({ Net10: "GND" });
    expect(n.reference.GND.diode).toBe(0);
    expect(n.reference.Net10).toBeUndefined();
    expect(n.cases[0].readings.GND.diode).toBe(0.002);
    n = renameNet(n, "Net10", "GND", "");
    expect(n.netNames).toEqual({});
    expect(n.reference.Net10.diode).toBe(0);
  });

  it("keeps own names through save and load", () => {
    const n = renameNet(emptyNotes("k", "k"), "Net10", "Net10", "GND");
    expect(parseNotes(JSON.stringify(n))?.netNames).toEqual({ Net10: "GND" });
  });
});

describe("case to reference", () => {
  it("takes a case's readings as reference, per quantity", () => {
    let n = setValue(emptyNotes("k", "k"), "reference", "PP3V3", "diode", 0.4);
    n = setValue(n, "reference", "PP3V3", "voltage", 3.3);
    n = addCase(n, "Gutes Board");
    const id = n.activeCase!;
    n = setValue(n, { caseId: id }, "PP3V3", "diode", 0.45);
    n = setValue(n, { caseId: id }, "PP1V8", "voltage", 1.8);
    n = caseToReference(n, id);
    expect(n.reference.PP3V3.diode).toBe(0.45);
    expect(n.reference.PP3V3.voltage).toBe(3.3);
    expect(n.reference.PP1V8.voltage).toBe(1.8);
  });
});

describe("board markers", () => {
  it("adds, edits, saves and removes markers", () => {
    const added = addMarker(emptyNotes("k", "k"), { id: "m1", x: 10, y: 20, side: "top", text: "Kurzschluss hier" });
    let n = updateMarker(added, "m1", "Kurzschluss PP3V3");
    const loaded = parseNotes(JSON.stringify(n))!;
    expect(loaded.markers).toHaveLength(1);
    expect(loaded.markers![0]).toMatchObject({ x: 10, y: 20, side: "top", text: "Kurzschluss PP3V3" });
    n = removeMarker(loaded, "m1");
    expect(n.markers).toEqual([]);
  });

  it("keeps both sides' markers when merging an import", () => {
    const a = addMarker(emptyNotes("k", "k"), { id: "a", x: 1, y: 1, side: "top", text: "a" });
    const b = addMarker(emptyNotes("k", "k"), { id: "b", x: 2, y: 2, side: "bottom", text: "b" });
    expect(mergeNotes(a, b).markers?.map((m) => m.text)).toEqual(["a", "b"]);
  });
});

describe("OpenBoardData choice", () => {
  it("is kept with the board, survives a save and a merge, and can be cleared", () => {
    const chosen = linkObdata(emptyNotes("820-00165", "A1466"), "820-00165");
    expect(chosen.obdata).toBe("820-00165");
    expect(parseNotes(JSON.stringify(chosen))?.obdata).toBe("820-00165");
    expect(mergeNotes(emptyNotes("820-00165", "A1466"), chosen).obdata).toBe("820-00165");
    expect(linkObdata(chosen, null).obdata).toBeUndefined();
  });
});

describe("measuring conditions and history", () => {
  const base = () => addCase(emptyNotes("820-02100", "x"), "Gerät 1");

  it("keeps earlier values when a reading changes", () => {
    let n = base();
    const target = { caseId: n.activeCase! };
    n = setValue(n, target, "PP3V3", "diode", 0.42);
    n = setValue(n, target, "PP3V3", "diode", 0.05);
    n = setValue(n, target, "PP3V3", "diode", 0.43);
    const r = n.cases[0].readings.PP3V3;
    expect(r.diode).toBe(0.43);
    expect(r.history?.map((h) => h.diode)).toEqual([0.42, 0.05]);
    // A note alone does not make a history entry.
    n = setReading(n, target, "PP3V3", { note: "nach Tausch von C12" });
    expect(n.cases[0].readings.PP3V3.history).toHaveLength(2);
  });

  it("stamps readings with the target's conditions and compares only fitting ones", () => {
    let n = base();
    const target = { caseId: n.activeCase! };
    n = setConditions(n, "reference", { polarity: "red-gnd", power: "off" });
    n = setConditions(n, target, { polarity: "black-gnd", power: "off", meter: "XDM1241" });
    n = setValue(n, "reference", "PP3V3", "diode", 0.42);
    n = setValue(n, target, "PP3V3", "diode", 0.7);
    expect(n.reference.PP3V3.cond).toEqual({ polarity: "red-gnd", power: "off" });
    expect(n.cases[0].readings.PP3V3.cond?.meter).toBe("XDM1241");
    expect(netStatuses(n, 0.1).get("PP3V3")).toBe("mismatch");
    // Same polarity: compared again, and the deviation shows.
    n = setConditions(n, target, { polarity: "red-gnd", power: "off" });
    n = setValue(n, target, "PP3V3", "diode", 0.71);
    expect(netStatuses(n, 0.1).get("PP3V3")).toBe("deviation");
  });

  it("round-trips conditions and lists through JSON", () => {
    let n = base();
    n = setConditions(n, "reference", { battery: false, revision: "Rev 2.0" });
    n = addList(n, "Ladeteil", [
      { net: "PP3V3", quantity: "diode" },
      { net: "PP3V3", quantity: "diode" },
      { net: "VBUS", quantity: "voltage" },
    ]);
    const back = parseNotes(JSON.stringify(n))!;
    expect(back.referenceConditions).toEqual({ battery: false, revision: "Rev 2.0" });
    expect(back.lists?.[0].items).toEqual([
      { net: "PP3V3", quantity: "diode" },
      { net: "VBUS", quantity: "voltage" },
    ]);
  });

  it("tracks list progress for the active case", () => {
    let n = addList(base(), "L", [
      { net: "PP3V3", quantity: "diode" },
      { net: "VBUS", quantity: "voltage" },
    ]);
    n = setValue(n, { caseId: n.activeCase! }, "VBUS", "voltage", 5.1);
    expect(listProgress(n, n.lists![0])).toEqual({ done: [false, true], count: 1 });
  });
});
