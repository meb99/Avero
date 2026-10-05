/**
 * What the board writes at pads: for the chosen quantity, the reading of the
 * active repair case at that very point (pin, test point) or else on its net,
 * with the reference under it and the comparison as color. Without a case the
 * reference alone is shown.
 */
import type { BoardModel } from "../core/board";
import { pointOf } from "../core/points";
import type { PadValue, PadValues } from "../render/labels";
import { compare, condOf, conditionsFit, formatValue, type Quantity, type Reading } from "./measure";
import { activeCase, type BoardNotes } from "./notes";

export function padValueSource(
  model: BoardModel,
  notes: BoardNotes,
  q: Quantity,
  tolerance: number,
  lang: string,
  refLabel: string,
): PadValues {
  const c = activeCase(notes);
  const refPoints = notes.referencePoints ?? {};
  const casePoints = c?.points ?? {};
  const value = (ref: Reading | undefined, got: Reading | undefined): PadValue | undefined => {
    const r = ref?.[q];
    const g = got?.[q];
    if (g !== undefined) {
      const status =
        r === undefined ? "measured" : !conditionsFit(condOf(ref, q), condOf(got, q), q) ? "mismatch" : (compare(r, g, q, tolerance) ?? "measured");
      return { text: formatValue(g, q, lang), sub: r !== undefined ? `${refLabel} ${formatValue(r, q, lang)}` : undefined, status };
    }
    if (r !== undefined) return { text: `${refLabel} ${formatValue(r, q, lang)}`, status: "reference" };
    return undefined;
  };
  const at = (pointId: string | undefined, net: number): PadValue | undefined => {
    const n = model.nets[net];
    if (n.kind === "unconnected") return undefined;
    // A reading at the point itself wins over the net's; a point without its own reference is compared with the net's.
    const pRef = pointId ? refPoints[pointId] : undefined;
    const pGot = pointId ? casePoints[pointId] : undefined;
    const nRef = notes.reference[n.name];
    const nGot = c?.readings[n.name];
    const ref = pRef?.[q] !== undefined ? pRef : nRef;
    const got = pGot?.[q] !== undefined ? pGot : nGot;
    return value(ref, got);
  };
  return {
    pin: (i) => at(model.pinLabel(i), model.pins[i].net),
    testPoint: (i) => at(pointOf(model, { kind: "testPoint", testPoint: i })?.id, model.testPoints[i].net),
  };
}
