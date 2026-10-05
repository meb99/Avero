import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { diffBoards } from "./diff";
import { testBoard } from "./testBoard";

describe("diffBoards", () => {
  it("finds nothing between a board and itself", () => {
    const d = diffBoards(new BoardModel(testBoard()), new BoardModel(testBoard()));
    expect(d.onlyA.length + d.onlyB.length + d.changed.length + d.pins.length + d.netsOnlyA.length + d.netsOnlyB.length).toBe(0);
    expect(d.same).toBe(testBoard().parts.length);
  });

  it("reports added, removed and changed parts, re-routed pins and new nets", () => {
    const a = new BoardModel(testBoard());
    const board = structuredClone(testBoard());
    board.parts[0].device = "10K 0402"; // R1 changed value
    board.parts[3].name = "R99"; // R9 gone, R99 new
    // R1 pin 1 now on I2C_SDA instead of PP3V3.
    const sda = board.nets.findIndex((n) => n.name === "I2C_SDA");
    board.pins[board.parts[0].firstPin].net = sda;
    board.nets.push({ name: "NEW_NET", kind: "signal", pins: [], testPoints: [] });
    const d = diffBoards(a, new BoardModel(board));
    expect(d.changed.find((c) => c.name === "R1")?.changes).toContain("device");
    expect(d.onlyA.map((c) => c.name)).toContain("R9");
    expect(d.onlyB.map((c) => c.name)).toContain("R99");
    expect(d.pins).toContainEqual(expect.objectContaining({ part: "R1", netA: "PP3V3", netB: "I2C_SDA" }));
  });

  it("sees other pin numbers and rewired parts as changes", () => {
    const a = new BoardModel(testBoard());
    const renumbered = structuredClone(testBoard());
    renumbered.pins[renumbered.parts[0].firstPin].number = "3";
    expect(diffBoards(a, new BoardModel(renumbered)).changed.find((c) => c.name === "R1")?.changes).toContain("pins");
    const rewired = structuredClone(testBoard());
    const sda = rewired.nets.findIndex((n) => n.name === "I2C_SDA");
    rewired.pins[rewired.parts[0].firstPin].net = sda;
    const d = diffBoards(a, new BoardModel(rewired));
    expect(d.changed.find((c) => c.name === "R1")?.changes).toEqual(["nets"]);
    expect(d.same).toBe(testBoard().parts.length - 1);
  });
});
