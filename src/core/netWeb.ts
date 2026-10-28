/**
 * The net web, as OpenBoardView and FlexBV draw it: a line from the selected pin to every
 * other pin of its net, so it shows at a glance where that one pin goes. The connection
 * lines (`BoardModel.ratsnest`) join all pins of a net instead, each to its nearest.
 * Ground and unconnected pins get no web, it would cover the board.
 */
import { visibleFrom, type BoardModel, type ViewSide } from "./board";

export function netWeb(model: BoardModel, pin: number, view?: ViewSide, maxPins = 2500): [number, number][] {
  const net = model.nets[model.pins[pin].net];
  if (!net || net.kind === "ground" || net.kind === "unconnected" || net.pins.length > maxPins) return [];
  return net.pins.filter((p) => p !== pin && (!view || visibleFrom(model.pins[p].side, view))).map((p) => [pin, p]);
}
