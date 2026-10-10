/**
 * Groups of parts one often wants out of the way: shields over the pads,
 * parts on ground only (shield clips, mounting pads), and objects without any
 * net (fiducials, holes, logos).
 */
import type { BoardModel } from "./board";

export type HideGroup = "shields" | "groundOnly" | "noNet";
export const HIDE_GROUPS: HideGroup[] = ["shields", "groundOnly", "noNet"];

const SHIELD = /SHIELD|SHLD|EMI|^SH\d|SHIELDING|FRAME|COVER|CAN_/i;

/** What decides the groups: the nets a part is on, its size in mil and its name. */
function facts(model: BoardModel, i: number) {
  const p = model.parts[i];
  const kinds = new Set<string>();
  for (let k = p.firstPin; k < p.firstPin + p.pinCount; k++) kinds.add(model.nets[model.pins[k].net].kind);
  const b = p.bounds;
  return {
    onlyGround: kinds.size === 1 && kinds.has("ground"),
    noNet: p.pinCount === 0 || (kinds.size === 1 && kinds.has("unconnected")),
    size: Math.max(b.maxX - b.minX, b.maxY - b.minY),
    named: SHIELD.test(p.name) || SHIELD.test(p.device ?? ""),
  };
}

export function partsInGroup(model: BoardModel, group: HideGroup): number[] {
  const out: number[] = [];
  model.parts.forEach((_, i) => {
    const f = facts(model, i);
    const big = f.size > 400; // over 10 mm
    if (group === "shields" && (f.named || (f.onlyGround && big))) out.push(i);
    else if (group === "groundOnly" && f.onlyGround) out.push(i);
    else if (group === "noNet" && f.noNet) out.push(i);
  });
  return out;
}

/**
 * Parts kept out of sight from the start, as FlexBV does: parts named as shields or frames,
 * and parts of 25.4 mm or more on ground or on no net only. Only their bodies go; the pads
 * stay, so nothing on the board is lost.
 */
export function mechanicalParts(model: BoardModel): number[] {
  return model.parts.flatMap((_, i) => {
    const f = facts(model, i);
    return f.named || ((f.onlyGround || f.noNet) && f.size >= 1000) ? [i] : [];
  });
}
