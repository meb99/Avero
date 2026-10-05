import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import { addCase, emptyNotes, setPointValue, setValue } from "./notes";
import { padValueSource } from "./padValues";

describe("values at pads", () => {
  const model = new BoardModel(testBoard());
  const pin = model.nets.findIndex((n) => n.name === "PP3V3");
  const first = model.nets[pin].pins[0];
  const other = model.nets[pin].pins[1];
  let notes = setValue(emptyNotes("k", "t"), "reference", "PP3V3", "diode", 0.45);

  it("shows the reference alone without a case", () => {
    expect(padValueSource(model, notes, "diode", 0.1, "de", "Ref").pin(first)).toMatchObject({ status: "reference", text: "Ref 0,450 V" });
  });

  it("prefers the reading at the pin and compares it with the net's reference", () => {
    notes = addCase(notes, "Fall");
    const target = { caseId: notes.activeCase! };
    notes = setValue(notes, target, "PP3V3", "diode", 0.46);
    notes = setPointValue(notes, target, model.pinLabel(first), "PP3V3", "diode", 0.9);
    const src = padValueSource(model, notes, "diode", 0.1, "de", "Ref");
    expect(src.pin(first)).toMatchObject({ text: "0,900 V", sub: "Ref 0,450 V", status: "deviation" });
    // The other pin of the net shows the net's reading.
    expect(src.pin(other)).toMatchObject({ text: "0,460 V", status: "ok" });
    expect(padValueSource(model, notes, "voltage", 0.1, "de", "Ref").pin(first)).toBeUndefined();
  });
});
