import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import type { Board } from "../core/types";
import { caseHints, netHint } from "./hints";
import { addCase, addStep, emptyNotes, setConditions, setValue, updateCase, type BoardNotes } from "./notes";

// The test board with a 22 µF capacitor C7 from PP3V3 to ground: PP3V3 has C7 and the chip U10 on it.
function model(): BoardModel {
  const board: Board = structuredClone(testBoard());
  const first = board.pins.length;
  board.parts.push({ name: "C7", side: "top", mount: "smd", firstPin: first, pinCount: 2, outline: [], bounds: { minX: 200, minY: 90, maxX: 260, maxY: 110 }, device: "22uF 0603" });
  board.pins.push({ part: board.parts.length - 1, number: "1", x: 210, y: 100, radius: 8, side: "top", net: 0 }, { part: board.parts.length - 1, number: "2", x: 250, y: 100, radius: 8, side: "top", net: 1 });
  board.nets[0].pins.push(first);
  board.nets[1].pins.push(first + 1);
  return new BoardModel(board);
}
const PP3V3 = 0;

function withCase(values: Partial<Record<"diode" | "resistance" | "voltage", number | "OL">>, reference?: Partial<Record<"diode" | "resistance", number>>): BoardNotes {
  let n = emptyNotes("B", "B.brd");
  for (const [q, v] of Object.entries(reference ?? {})) n = setValue(n, "reference", "PP3V3", q as "diode", v);
  n = addCase(n, "Geht nicht an");
  for (const [q, v] of Object.entries(values)) n = setValue(n, { caseId: n.activeCase! }, "PP3V3", q as "diode", v);
  return n;
}

describe("explained hints (F37)", () => {
  it("does not call a chip defective on a low resistance: candidates, alternatives and the next step", () => {
    const m = model();
    const h = netHint(m, withCase({ resistance: 0.8, diode: 0.002 }, { resistance: 4500, diode: 0.38 }), PP3V3, 0.1, "Referenz")!;
    expect(h.finding).toBe("short");
    // Every value with its source.
    expect(h.values.map((v) => [v.q, v.source])).toEqual([
      ["diode", "Geht nicht an"],
      ["resistance", "Geht nicht an"],
    ]);
    // The capacitor and the chip are candidates, the capacitor first; nothing is confirmed.
    expect(h.candidates.map((c) => m.parts[c.part].name)).toEqual(["C7", "U10"]);
    expect(h.candidates.every((c) => !c.confirmed)).toBe(true);
    expect(h.alternatives).toEqual(expect.arrayContaining(["capacitor", "chip", "bridge"]));
    // Isolate the capacitor, not the chip, and narrow it down by injection.
    expect(m.parts[h.isolateFirst!].name).toBe("C7");
    expect(h.needed).toEqual(expect.arrayContaining(["isolate", "injection"]));
  });

  it("puts a part an earlier, repaired case fixed this net with first, and says so", () => {
    const m = model();
    let n = withCase({ resistance: 0.8 }, { resistance: 4500 });
    const now = n.activeCase!;
    n = addCase(n, "Altfall");
    const old = n.activeCase!;
    n = addStep(n, old, { action: "replaced", target: "U10", nets: ["PP3V3", "GND"], result: "ok" });
    n = updateCase(n, old, { status: "repaired" });
    n = { ...n, activeCase: now };
    const h = netHint(m, n, PP3V3, 0.1, "Referenz")!;
    expect(m.parts[h.candidates[0].part].name).toBe("U10");
    expect(h.candidates[0].confirmed).toEqual({ caseTitle: "Altfall", action: "replaced" });
  });

  it("names what is missing instead of guessing", () => {
    const m = model();
    const none = netHint(m, withCase({}), PP3V3, 0.1, "Referenz")!;
    expect(none.finding).toBe("noValue");
    expect(none.needed).toEqual(expect.arrayContaining(["measureDiode", "measureResistance"]));
    // A value without a good board to judge it by.
    const alone = netHint(m, withCase({ resistance: 450 }), PP3V3, 0.1, "Referenz")!;
    expect(alone.finding).toBe("unjudged");
    expect(alone.needed).toContain("reference");
  });

  it("deals with contradictions openly", () => {
    const m = model();
    // Diode mode says short, resistance says not.
    const both = netHint(m, withCase({ diode: 0.003, resistance: 3200 }, { diode: 0.4, resistance: 4000 }), PP3V3, 0.1, "Referenz")!;
    expect(both.contradictions).toContain("diodeVsResistance");
    expect(both.finding).not.toBe("short");
    expect(both.needed).toContain("remeasureBoth");
    // Taken with the board powered while the reference was off: not comparable.
    let n = emptyNotes("B", "B.brd");
    n = setConditions(n, "reference", { power: "off" });
    n = setValue(n, "reference", "PP3V3", "resistance", 4500);
    n = addCase(n, "Fall");
    n = setConditions(n, { caseId: n.activeCase! }, { power: "standby" });
    n = setValue(n, { caseId: n.activeCase! }, "PP3V3", "resistance", 300);
    const other = netHint(m, n, PP3V3, 0.1, "Referenz")!;
    expect(other.contradictions).toContain("conditions");
    expect(other.needed).toContain("sameConditions");
    expect(other.values[0].cond).toEqual({ power: "standby" });
  });

  it("lists the nets of the case worth a look, worst first", () => {
    const m = model();
    let n = withCase({ resistance: 0.5 }, { resistance: 4500 });
    n = setValue(n, "reference", "I2C_SDA", "diode", 0.55);
    n = setValue(n, { caseId: n.activeCase! }, "I2C_SDA", "diode", 0.55);
    expect(caseHints(m, n, 0.1, "Referenz").map((h) => [h.net, h.finding])).toEqual([["PP3V3", "short"]]);
  });
});
