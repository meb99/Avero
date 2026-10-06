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
  setOwnPart,
  setOwnPin,
  addDrawing,
  lockDrawing,
  moveDrawing,
  removeDrawing,
  setDrawingFields,
  setMarkerPhotos,
  setPointValue,
  pointsOnNet,
  spread,
  setReading,
  setValue,
  updateMarker,
} from "./notes";
import { condOf } from "./measure";

describe("boardKey", () => {
  it("keeps measurement references separate for different project members",()=>{
    const source={name:"Switch project",path:"/Switch.epro"};
    const a=boardKey({...source,projectMember:"PCB/a.epcb"}),b=boardKey({...source,projectMember:"PCB/b.epcb"});
    expect(a).not.toBe(b);expect(a).not.toBe(boardKey(source));
  });
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

  it("keeps readings at two points of one net apart, each with its history", () => {
    let n = base();
    const target = { caseId: n.activeCase! };
    n = setPointValue(n, target, "U7.1", "PP3V3", "diode", 0.42);
    n = setPointValue(n, target, "C12.2", "PP3V3", "diode", "OL");
    n = setPointValue(n, target, "U7.1", "PP3V3", "diode", 0.43);
    const points = n.cases[0].points!;
    expect(points["U7.1"].diode).toBe(0.43);
    expect(points["U7.1"].history?.[0].diode).toBe(0.42);
    expect(points["C12.2"].diode).toBe("OL");
    // The net's own reading is untouched.
    expect(n.cases[0].readings.PP3V3).toBeUndefined();
    expect(pointsOnNet(n, target, "PP3V3").map(([id]) => id).sort()).toEqual(["C12.2", "U7.1"]);
    const s = spread(pointsOnNet(n, target, "PP3V3").map(([, r]) => r), "diode")!;
    expect(s).toMatchObject({ min: 0.43, max: 0.43, count: 1, open: 1 });
    // Renaming the net carries the points along; JSON keeps them.
    n = renameNet(n, "PP3V3", "PP3V3", "VCC3");
    expect(pointsOnNet(n, target, "VCC3").length).toBe(2);
    const back = parseNotes(JSON.stringify(n))!;
    expect(back.cases[0].points?.["U7.1"].net).toBe("VCC3");
  });

  it("counts a list point as done only by a reading at that point", () => {
    let n = base();
    const target = { caseId: n.activeCase! };
    n = addList(n, "L", [
      { net: "PP3V3", quantity: "diode", point: "U7.1" },
      { net: "PP3V3", quantity: "diode" },
    ]);
    n = setValue(n, target, "PP3V3", "diode", 0.4);
    expect(listProgress(n, n.lists![0]).done).toEqual([false, true]);
    n = setPointValue(n, target, "U7.1", "PP3V3", "diode", 0.41);
    expect(listProgress(n, n.lists![0]).done).toEqual([true, true]);
    expect(parseNotes(JSON.stringify(n))?.lists?.[0].items[0].point).toBe("U7.1");
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

describe("conditions from older files", () => {
  it("are read as they were, without conditions made up", () => {
    const old = JSON.stringify({
      version: 1,
      key: "B1",
      reference: { PP3V3: { diode: 0.45, cond: { power: "off", polarity: "red-gnd" } } },
      cases: [],
      referenceConditions: { power: "off", meter: "XDM1241" },
    });
    const n = parseNotes(old)!;
    expect(n.referenceConditions).toEqual({ power: "off", meter: "XDM1241" });
    expect(n.reference.PP3V3.cond).toEqual({ power: "off", polarity: "red-gnd" });
  });

  it("keep the new ones", () => {
    const json = JSON.stringify({
      version: 1,
      key: "B1",
      reference: {},
      cases: [],
      referenceConditions: { assembly: "ic-removed", removed: "U7000", temperature: 24, modules: "display", range: "2V", leadsNulled: true, bogus: 1 },
    });
    expect(parseNotes(json)!.referenceConditions).toEqual({ assembly: "ic-removed", removed: "U7000", temperature: 24, modules: "display", range: "2V", leadsNulled: true });
  });
});

describe("own facts over the file's", () => {
  it("are kept apart, tidied and removable", () => {
    let n = parseNotes(JSON.stringify({ version: 1, key: "B", reference: {}, cases: [] }))!;
    n = setOwnPart(n, "u7", { value: " 10µF ", package: "", source: "Schaltplan S. 3" });
    expect(n.ownParts).toEqual({ U7: { value: "10µF", source: "Schaltplan S. 3" } });
    n = setOwnPin(n, "U7.GND#2", { label: "PGND" });
    const again = parseNotes(JSON.stringify(n))!;
    expect(again.ownParts).toEqual(n.ownParts);
    expect(again.ownPins).toEqual({ "U7.GND#2": { label: "PGND" } });
    expect(setOwnPart(again, "U7", undefined).ownParts).toBeUndefined();
    expect(setOwnPin(again, "U7.GND#2", { label: "  " }).ownPins).toBeUndefined();
  });
});

describe("drawings with style, groups and lock", () => {
  const base = () => parseNotes(JSON.stringify({ version: 1, key: "B", reference: {}, cases: [] }))!;
  it("move and lock together as a group, and a locked one stays", () => {
    let n = addDrawing(base(), { kind: "arrow", side: "top", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    n = addDrawing(n, { kind: "rect", side: "top", points: [{ x: 5, y: 5 }, { x: 20, y: 20 }] });
    const [a, b] = n.drawings!;
    n = setDrawingFields(n, a.id, { group: "C12 area", color: "blue", width: 3 });
    n = setDrawingFields(n, b.id, { group: "C12 area" });
    n = moveDrawing(n, a.id, 100, 50);
    expect(n.drawings!.map((d) => d.points[0])).toEqual([{ x: 100, y: 50 }, { x: 105, y: 55 }]);
    n = lockDrawing(n, b.id, true);
    expect(n.drawings!.every((d) => d.locked)).toBe(true);
    expect(moveDrawing(n, a.id, 1, 1)).toBe(n);
    expect(removeDrawing(n, a.id).drawings).toHaveLength(2);
    expect(setDrawingFields(n, a.id, { color: "red" }).drawings![0].color).toBe("blue");
    n = lockDrawing(n, a.id, false);
    expect(n.drawings!.some((d) => d.locked)).toBe(false);
    // Kept through saving.
    const again = parseNotes(JSON.stringify(n))!;
    expect(again.drawings![0]).toMatchObject({ kind: "arrow", color: "blue", width: 3, group: "C12 area" });
  });

  it("keeps notes bound to a pin with their photos", () => {
    let n = addMarker(base(), { id: "m1", x: 1, y: 2, side: "top", text: "cold joint", target: "U7.21" });
    n = setMarkerPhotos(n, "m1", ["a.jpg"]);
    expect(parseNotes(JSON.stringify(n))!.markers![0]).toMatchObject({ target: "U7.21", photos: ["a.jpg"] });
  });
});
