import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import { fileReadingsOf, takeAllFileReadings } from "./fileReadings";
import { emptyNotes, setPointValue, takeFileReadings, type FilePointReading } from "./notes";

const board = () => new BoardModel({
  ...testBoard(),
  format: "xzz",
  readings: [
    { part: "U10", pin: "1", quantity: "diode", value: 0.48, raw: "480", list: "阻值" },
    { part: "U10", pin: "a3", quantity: "diode", value: 0.464, raw: "464", list: "阻值" },
    { part: "R1", pin: "2", quantity: "diode", value: null, raw: "OL", list: "阻值" },
    { part: "X99", pin: "1", quantity: "diode", value: 0.1, raw: "100", list: "阻值" },
  ],
});

describe("readings from the board file", () => {
  it("finds each reading's pin, with its net and source; unknown parts are left out", () => {
    const m = fileReadingsOf(board());
    expect([...m.keys()]).toEqual(["XZZ 阻值"]);
    expect(m.get("XZZ 阻值")).toEqual([
      { point: "U10.1", net: "PP3V3", quantity: "diode", value: 0.48 },
      { point: "U10.A3", net: "I2C_SDA", quantity: "diode", value: 0.464 },
      { point: "R1.2", net: "GND", quantity: "diode", value: "OL" },
    ]);
  });

  it("takes them into the reference per pin, marked with the source", () => {
    const r = takeAllFileReadings(emptyNotes("k", "b"), board());
    expect([r.added, r.kept, r.total]).toEqual([3, 0, 3]);
    const p = r.notes.referencePoints!;
    expect(p["U10.1"]).toMatchObject({ diode: 0.48, net: "PP3V3", origin: { diode: "XZZ 阻值" } });
    expect(p["U10.A3"].diode).toBe(0.464);
    expect(p["R1.2"].diode).toBe("OL");
    // No conditions are claimed for values the file gives.
    expect(p["U10.1"].conds).toBeUndefined();
  });

  it("keeps a value of one's own, and says when it differs", () => {
    const own = setPointValue(emptyNotes("k", "b"), "reference", "U10.A3", "I2C_SDA", "diode", 0.5);
    const r = takeAllFileReadings(own, board());
    expect([r.added, r.kept, r.differ]).toEqual([2, 1, 1]);
    expect(r.notes.referencePoints!["U10.A3"].diode).toBe(0.5);
    expect(r.notes.referencePoints!["U10.A3"].origin).toBeUndefined();
  });

  it("takes the same file once: a value deleted afterwards stays deleted; a changed file brings changes", () => {
    const first = takeAllFileReadings(emptyNotes("k", "b"), board()).notes;
    const deleted = setPointValue(first, "reference", "R1.2", "GND", "diode", undefined);
    const again = takeAllFileReadings(deleted, board());
    expect(again.added + again.updated).toBe(0);
    expect(again.notes.referencePoints!["R1.2"]?.diode).toBeUndefined();
    const changed: FilePointReading[] = [{ point: "U10.1", net: "PP3V3", quantity: "diode", value: 0.5 }];
    const r = takeFileReadings(deleted, changed, "XZZ 阻值");
    expect(r.updated).toBe(1);
    expect(r.notes.referencePoints!["U10.1"].diode).toBe(0.5);
    // The file's earlier value goes to the history.
    expect(r.notes.referencePoints!["U10.1"].history?.at(-1)?.diode).toBe(0.48);
  });
});
