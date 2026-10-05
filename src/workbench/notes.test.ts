import { describe, expect, it } from "vitest";
import {
  addCase,
  addList,
  listProgress,
  setConditions,
  addMarker,
  boardKey,
  caseToReference,
  clearHistory,
  emptyNotes,
  linkObdata,
  mergeNotes,
  netStatuses,
  parseNotes,
  removeCase,
  removeMarker,
  renameNet,
  setNetKind,
  setReading,
  setValue,
  updateMarker,
} from "./notes";
import { condOf } from "./measure";

describe("boardKey", () => {
  it("uses the board number so formats of one board share notes", () => {
    expect(boardKey({ name: "x", path: "/Boards/Apple/820-02100.brd" })).toBe("820-02100");
    expect(boardKey({ name: "x", path: "/Boards/Apple/J413 820-02100 boardview.bdv" })).toBe("820-02100");
    expect(boardKey({ name: "x", path: "/Boards/X1C6 NM-B481/pins.asc" })).toBe("nm-b481");
    expect(boardKey({ name: "x", path: "/tmp/myboard.brd" })).toBe("myboard");
    expect(boardKey({ name: "Avero Demo" })).toBe("avero-demo");
    // The board number wins over words with a digit; revisions stay apart.
    expect(boardKey({ name: "x", path: "/PS5/PlayStation5 EDM-010.brd" })).toBe("edm-010");
    expect(boardKey({ name: "x", path: "/PS5/PlayStation5 EDM-020.brd" })).toBe("edm-020");
    // Generic names take the folder along.
    expect(boardKey({ name: "x", path: "/Boards/Trinity/Board.brd" })).toBe("trinity-board");
    expect(boardKey({ name: "x", path: "/Boards/Other/Board.brd" })).toBe("other-board");
  });
});

describe("board notes", () => {
  const base = emptyNotes("820-02100", "820-02100.brd");

  it("stores and clears readings", () => {
    let n = setValue(base, "reference", "PP3V3", "voltage", 3.3);
    expect(n.reference.PP3V3.voltage).toBe(3.3);
    n = setValue(n, "reference", "PP3V3", "voltage", undefined);
    // The cleared value stays in the history; forgetting it is a step of its own.
    expect(n.reference.PP3V3.voltage).toBeUndefined();
    expect(n.reference.PP3V3.history?.[0].voltage).toBe(3.3);
    n = clearHistory(n, "reference", "PP3V3");
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
    expect(condOf(n.reference.PP3V3, "diode")).toEqual({ polarity: "red-gnd", power: "off" });
    expect(condOf(n.cases[0].readings.PP3V3, "diode")?.meter).toBe("XDM1241");
    expect(netStatuses(n, 0.1).get("PP3V3")).toBe("mismatch");
    // Same polarity: compared again, and the deviation shows.
    n = setConditions(n, target, { polarity: "red-gnd", power: "off" });
    n = setValue(n, target, "PP3V3", "diode", 0.71);
    expect(netStatuses(n, 0.1).get("PP3V3")).toBe("deviation");
  });

  it("keeps each quantity's own conditions", () => {
    let n = base();
    const target = { caseId: n.activeCase! };
    n = setConditions(n, target, { power: "off" });
    n = setValue(n, target, "PP3V3", "diode", 0.45);
    n = setConditions(n, target, { power: "on" });
    n = setValue(n, target, "PP3V3", "voltage", 3.3);
    const r = n.cases[0].readings.PP3V3;
    expect(condOf(r, "diode")).toEqual({ power: "off" });
    expect(condOf(r, "voltage")).toEqual({ power: "on" });
  });

  it("takes the same number under new conditions as a new measurement", () => {
    let n = base();
    const target = { caseId: n.activeCase! };
    n = setConditions(n, target, { power: "off" });
    n = setValue(n, target, "PP3V3", "voltage", 0);
    n = setConditions(n, target, { power: "on" });
    n = setValue(n, target, "PP3V3", "voltage", 0);
    const r = n.cases[0].readings.PP3V3;
    expect(condOf(r, "voltage")).toEqual({ power: "on" });
    expect(r.history?.at(-1)).toMatchObject({ voltage: 0, cond: { power: "off" } });
  });

  it("takes a case as reference with its conditions, keeping the old reference in the history", () => {
    let n = base();
    const target = { caseId: n.activeCase! };
    n = setConditions(n, "reference", { power: "off" });
    n = setValue(n, "reference", "PP3V3", "voltage", 0);
    n = setConditions(n, target, { power: "on" });
    n = setValue(n, target, "PP3V3", "voltage", 3.3);
    n = caseToReference(n, target.caseId);
    const r = n.reference.PP3V3;
    expect(r.voltage).toBe(3.3);
    expect(condOf(r, "voltage")).toEqual({ power: "on" });
    expect(r.origin?.voltage).toBe(n.cases[0].title);
    expect(r.history?.at(-1)).toMatchObject({ voltage: 0, cond: { power: "off" } });
  });

  it("reads old shared conditions and rejects broken readings", () => {
    const old = { ...base(), reference: { PP3V3: { diode: 0.4, voltage: 3.3, cond: { power: "off" } }, BAD: null, ODD: { voltage: "x" } } };
    const back = parseNotes(JSON.stringify(old))!;
    expect(condOf(back.reference.PP3V3, "voltage")).toEqual({ power: "off" });
    expect(back.reference.BAD).toBeUndefined();
    expect(back.reference.ODD).toBeUndefined();
    const broken = { ...base(), cases: [{ id: "a", title: "A", readings: null }, { id: "b", title: "B", readings: { X: { voltage: 1 } } }] };
    const parsed = parseNotes(JSON.stringify(broken))!;
    expect(parsed.cases.map((c) => c.id)).toEqual(["b"]);
    expect(() => caseToReference(parsed, "b")).not.toThrow();
  });

  it("moves list items along with a renamed net and keeps own kinds", () => {
    let n = base();
    n = addList(n, "L", [{ net: "Net10", quantity: "voltage" }]);
    n = setValue(n, { caseId: n.activeCase! }, "Net10", "voltage", 3.3);
    n = renameNet(n, "Net10", "Net10", "VCC");
    expect(n.lists?.[0].items[0].net).toBe("VCC");
    expect(listProgress(n, n.lists![0]).count).toBe(1);
    n = setNetKind(n, "Net10", "ground");
    expect(parseNotes(JSON.stringify(n))?.netKinds).toEqual({ Net10: "ground" });
    expect(setNetKind(n, "Net10", undefined).netKinds).toBeUndefined();
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
