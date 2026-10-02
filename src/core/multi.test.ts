import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { sharedNets } from "./multi";
import { testBoard } from "./testBoard";

describe("sharedNets", () => {
  const model = new BoardModel(testBoard());
  const part = (name: string) => model.findPart(name)!;

  it("finds the nets two parts have in common, ground only on request", () => {
    const shared = sharedNets(model, [part("R1"), part("U10")]);
    expect(shared.map((s) => model.nets[s.net].name)).toEqual(["PP3V3"]);
    const withGround = sharedNets(model, [part("R1"), part("U10")], true);
    expect(withGround.map((s) => model.nets[s.net].name).sort()).toEqual(["GND", "PP3V3"]);
  });

  it("is empty for a single part", () => {
    expect(sharedNets(model, [part("R1")])).toEqual([]);
  });
});
