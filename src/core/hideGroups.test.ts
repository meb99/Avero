import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { partsInGroup } from "./hideGroups";
import { testBoard } from "./testBoard";

describe("hidden parts", () => {
  it("hides bodies or pads too, without touching the net list", () => {
    const model = new BoardModel(testBoard());
    const nets = JSON.stringify(model.nets);
    const name = model.parts[1].name;
    const pin = model.parts[1].firstPin;
    expect(model.setHiddenParts([name], "body")).toBe(true);
    expect(model.partHidden(1)).toBe(true);
    expect(model.pinHidden(pin)).toBe(false);
    model.setHiddenParts([name], "all");
    expect(model.pinHidden(pin)).toBe(true);
    // A hidden pin is not picked.
    const p = model.pins[pin];
    const hit = model.hitTest({ x: p.x, y: p.y }, p.side === "both" ? "top" : p.side, 1, true);
    expect(hit?.kind === "pin" && hit.pin === pin).toBe(false);
    expect(JSON.stringify(model.nets)).toBe(nets);
    expect(model.setHiddenParts([], "body")).toBe(true);
    expect(model.hiddenCount).toBe(0);
  });

  it("finds parts on ground only", () => {
    const model = new BoardModel(testBoard());
    for (const i of partsInGroup(model, "groundOnly")) {
      const p = model.parts[i];
      for (let k = p.firstPin; k < p.firstPin + p.pinCount; k++) expect(model.nets[model.pins[k].net].kind).toBe("ground");
    }
  });
});
