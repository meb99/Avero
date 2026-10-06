/**
 * Single measuring points: a pin ("U7000.21"), a named test point
 * ("TP:TP12") or a via by its position ("VIA@1200,850"). The id stays the
 * same when the file is opened again, so readings at a point find it.
 */
import type { BoardModel } from "./board";
import type { Selection } from "./types";

export interface MeasurePoint {
  id: string;
  /** What the user reads: "U7000.21", "TP12", "Via 1.2/0.85 mm". */
  label: string;
  net: number;
}

/**
 * A pin's id: "U7000.21", and where a part has several pins of the same
 * name ("GND", "NC") the occurrence after it, "U7.GND#2", so each stays
 * addressable. Pins with unique names keep the plain form.
 */
export function pinKey(model: BoardModel, i: number): string {
  const pin = model.pins[i];
  const part = model.parts[pin.part];
  let k = 0;
  let total = 0;
  for (let j = part.firstPin; j < part.firstPin + part.pinCount; j++) {
    if (model.pins[j].number !== pin.number) continue;
    total++;
    if (j <= i) k++;
  }
  const label = model.pinLabel(i);
  return total > 1 ? `${label}#${k}` : label;
}

export function pointOf(model: BoardModel, sel: Selection): MeasurePoint | undefined {
  if (sel.kind === "pin") {
    const pin = model.pins[sel.pin];
    const id = pinKey(model, sel.pin);
    return { id, label: id, net: pin.net };
  }
  if (sel.kind === "testPoint") {
    const tp = model.testPoints[sel.testPoint];
    if (tp.name) return { id: `TP:${tp.name}`, label: tp.name, net: tp.net };
    const id = `VIA@${Math.round(tp.x)},${Math.round(tp.y)}`;
    return { id, label: `${tp.kind === "via" ? "Via" : "TP"} ${(tp.x * 0.0254).toFixed(2)}/${(tp.y * 0.0254).toFixed(2)} mm`, net: tp.net };
  }
  return undefined;
}

/** The pin or test point a point id stands for on this board. */
export function findPoint(model: BoardModel, id: string): Selection | undefined {
  if (id.startsWith("TP:")) {
    const name = id.slice(3);
    const i = model.testPoints.findIndex((t) => t.name === name);
    return i >= 0 ? { kind: "testPoint", testPoint: i } : undefined;
  }
  const via = /^VIA@(-?\d+),(-?\d+)$/.exec(id);
  if (via) {
    const [x, y] = [Number(via[1]), Number(via[2])];
    const i = model.testPoints.findIndex((t) => Math.round(t.x) === x && Math.round(t.y) === y);
    return i >= 0 ? { kind: "testPoint", testPoint: i } : undefined;
  }
  const [plain, nth] = id.split("#");
  const dot = plain.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const part = model.findPart(plain.slice(0, dot));
  if (part === undefined) return undefined;
  const number = plain.slice(dot + 1);
  if (nth !== undefined) {
    // The n-th pin of that name.
    const p = model.parts[part];
    let k = 0;
    for (let j = p.firstPin; j < p.firstPin + p.pinCount; j++) {
      if (model.pins[j].number === number && ++k === Number(nth)) return { kind: "pin", pin: j };
    }
    return undefined;
  }
  const pin = model.findPin(part, number);
  return pin === undefined ? undefined : { kind: "pin", pin };
}

/** The label of a point id as shown in lists. */
export function pointLabel(model: BoardModel, id: string): string {
  const sel = findPoint(model, id);
  return sel ? (pointOf(model, sel)?.label ?? id) : id;
}
