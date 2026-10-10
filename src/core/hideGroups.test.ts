import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { mechanicalParts, partsInGroup } from "./hideGroups";
import { testBoard } from "./testBoard";
import type { Board, Part } from "./types";

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

describe("mechanical parts", () => {
  /** The test board with one more part of the given size (mil) on the given nets. */
  function withPart(name: string, size: number, nets: number[]): BoardModel {
    const board: Board = testBoard();
    const part = board.parts.length;
    const firstPin = board.pins.length;
    const bounds = { minX: 0, minY: 0, maxX: size, maxY: size / 2 };
    board.parts.push({ name, side: "top", mount: "smd", firstPin, pinCount: nets.length, outline: [], bounds } satisfies Part);
    nets.forEach((net, k) => {
      board.pins.push({ part, number: String(k + 1), x: k * 10, y: 0, radius: 5, side: "top", net });
      board.nets[net].pins.push(firstPin + k);
    });
    return new BoardModel(board);
  }
  const GND = 1;
  const NC = 3;
  const isMechanical = (model: BoardModel) => mechanicalParts(model).includes(model.parts.length - 1);

  it("are big parts on ground or no net only, and parts named as shields", () => {
    expect(isMechanical(withPart("FRAME1", 1200, [GND, GND, GND]))).toBe(true);
    expect(isMechanical(withPart("X1", 1500, [NC, NC]))).toBe(true);
    expect(isMechanical(withPart("X2", 1500, []))).toBe(true);
    expect(isMechanical(withPart("SHLD3", 80, [GND]))).toBe(true);
  });

  it("leave small ground parts, and big parts with a signal", () => {
    // A USB-C shell is ground only but under 25.4 mm.
    expect(isMechanical(withPart("J4001", 360, [GND, GND, GND, GND]))).toBe(false);
    expect(isMechanical(withPart("U1", 1200, [GND, 0]))).toBe(false);
    expect(mechanicalParts(new BoardModel(testBoard()))).toEqual([]);
  });

  it("hide only the body, whatever the mode of the parts hidden by hand", () => {
    const model = withPart("FRAME1", 1200, [GND, GND]);
    const frame = model.parts.length - 1;
    const pin = model.parts[frame].firstPin;
    model.setHiddenParts([model.parts[0].name], "all", [frame]);
    expect(model.partHidden(frame)).toBe(true);
    expect(model.pinHidden(pin)).toBe(false);
    expect(model.pinHidden(model.parts[0].firstPin)).toBe(true);
  });
});

describe("isolation view", () => {
  /** Two nets and the parts on each. */
  function twoNets(model: BoardModel) {
    const partsOf = (net: number) => new Set(model.nets[net].pins.map((p) => model.pins[p].part));
    const nets = model.nets.map((_, i) => i).filter((i) => model.nets[i].kind === "signal" || model.nets[i].kind === "power");
    for (const a of nets)
      for (const b of nets) {
        if (a >= b) continue;
        const pa = partsOf(a);
        const pb = partsOf(b);
        const both = [...pa].filter((p) => pb.has(p));
        if (both.length > 0 && both.length < new Set([...pa, ...pb]).size) return { a, b, pa, pb, both };
      }
    throw new Error("test board has no two nets sharing some parts");
  }

  it("shows only the chosen nets and their parts, union or intersection", () => {
    const model = new BoardModel(testBoard());
    const { a, b, pa, pb, both } = twoNets(model);
    const union = model.setIsolation([a, b], "union");
    expect(new Set(union)).toEqual(new Set([...pa, ...pb]));
    for (let i = 0; i < model.parts.length; i++) expect(model.partHidden(i)).toBe(!pa.has(i) && !pb.has(i));
    for (let i = 0; i < model.pins.length; i++) {
      const on = model.pins[i].net === a || model.pins[i].net === b;
      expect(model.pinHidden(i)).toBe(!on);
    }
    for (let n = 0; n < model.nets.length; n++) expect(model.netHidden(n)).toBe(n !== a && n !== b);

    expect(new Set(model.setIsolation([a, b], "intersection"))).toEqual(new Set(both));
    expect(model.isolationBounds()).toBeDefined();

    model.setIsolation(null);
    expect(model.isolated).toBe(false);
    expect(model.parts.some((_, i) => model.partHidden(i))).toBe(false);
  });

  it("shows ground pins of the shown parts only when asked", () => {
    const model = new BoardModel(testBoard());
    const ground = model.nets.findIndex((n) => n.kind === "ground");
    const groundPin = model.nets[ground].pins[0];
    const part = model.pins[groundPin].part;
    const signal = model.pins.find((p, i) => p.part === part && i !== groundPin && model.nets[p.net].kind !== "ground")?.net;
    expect(signal).toBeDefined();
    model.setIsolation([signal!], "union");
    expect(model.pinHidden(groundPin)).toBe(true);
    model.setIsolation([signal!], "union", (k) => k === "ground");
    expect(model.pinHidden(groundPin)).toBe(false);
    // Ground's copper elsewhere stays hidden.
    expect(model.netHidden(ground)).toBe(true);
  });
});
