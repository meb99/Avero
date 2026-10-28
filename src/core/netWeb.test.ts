import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { netWeb } from "./netWeb";
import { testBoard } from "./testBoard";

const model = new BoardModel(testBoard());

describe("net web", () => {
  it("runs from the selected pin to every other pin of its net", () => {
    // PP3V3: pins 0, 2 and 6.
    expect(netWeb(model, 0)).toEqual([
      [0, 2],
      [0, 6],
    ]);
    expect(netWeb(model, 2)).toEqual([
      [2, 0],
      [2, 6],
    ]);
  });

  it("keeps to the pins seen from one side", () => {
    // Pin 2 sits on the bottom.
    expect(netWeb(model, 0, "top")).toEqual([[0, 6]]);
  });

  it("leaves out ground and unconnected pins", () => {
    expect(netWeb(model, 1)).toEqual([]);
    expect(netWeb(model, 5)).toEqual([]);
    // A net of one pin has nothing to point at.
    expect(netWeb(model, 4)).toEqual([]);
  });
});
