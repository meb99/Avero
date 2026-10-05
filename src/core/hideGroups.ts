/**
 * Groups of parts one often wants out of the way: shields over the pads,
 * parts on ground only (shield clips, mounting pads), and objects without any
 * net (fiducials, holes, logos).
 */
import type { BoardModel } from "./board";

export type HideGroup = "shields" | "groundOnly" | "noNet";
export const HIDE_GROUPS: HideGroup[] = ["shields", "groundOnly", "noNet"];

const SHIELD = /SHIELD|SHLD|EMI|^SH\d|SHIELDING|FRAME|COVER|CAN_/i;

export function partsInGroup(model: BoardModel, group: HideGroup): number[] {
  const out: number[] = [];
  model.parts.forEach((p, i) => {
    const kinds = new Set<string>();
    for (let k = p.firstPin; k < p.firstPin + p.pinCount; k++) kinds.add(model.nets[model.pins[k].net].kind);
    const onlyGround = kinds.size === 1 && kinds.has("ground");
    const noNet = p.pinCount === 0 || (kinds.size === 1 && kinds.has("unconnected"));
    const b = p.bounds;
    const big = Math.max(b.maxX - b.minX, b.maxY - b.minY) > 400; // over 10 mm
    const named = SHIELD.test(p.name) || SHIELD.test(p.device ?? "");
    if (group === "shields" && (named || (onlyGround && big))) out.push(i);
    else if (group === "groundOnly" && onlyGround) out.push(i);
    else if (group === "noNet" && noNet) out.push(i);
  });
  return out;
}
