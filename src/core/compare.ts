import type { BoardModel } from "./board";
import type { Selection } from "./types";

const NONE: Selection = { kind: "none" };

/**
 * The same thing on another board, found by name: a part by designator, a
 * pin by designator and pin number, a net (or a test point's net) by name.
 * Boards of the same design or of related revisions line up this way.
 * `nets` (from `matchNets`) also finds a net renamed on the other board.
 */
export function mapSelection(from: BoardModel, to: BoardModel, sel: Selection, nets?: ReadonlyMap<number, number>): Selection {
  switch (sel.kind) {
    case "part": {
      const part = to.findPart(from.parts[sel.part].name);
      return part === undefined ? NONE : { kind: "part", part };
    }
    case "pin": {
      const pin = from.pins[sel.pin];
      const part = to.findPart(from.parts[pin.part].name);
      if (part === undefined) return mapNet(from, to, pin.net, nets);
      const other = to.findPin(part, pin.number);
      return other === undefined ? { kind: "part", part } : { kind: "pin", pin: other };
    }
    case "testPoint":
      return mapNet(from, to, from.testPoints[sel.testPoint].net, nets);
    case "net":
      return mapNet(from, to, sel.net, nets);
    case "none":
      return NONE;
  }
}

function mapNet(from: BoardModel, to: BoardModel, net: number, nets?: ReadonlyMap<number, number>): Selection {
  // By the name in the file: own names (Net10 -> GND) belong to one board.
  const other = nets?.get(net) ?? to.findNet(from.fileNetName(net)) ?? to.findNet(from.nets[net].name);
  return other === undefined || to.nets[other].kind === "unconnected" ? NONE : { kind: "net", net: other };
}
