/**
 * How complete an imported board is: what came over, what Avero estimated,
 * and what is missing, as a report a person can judge the file by.
 */
import type { BoardModel } from "./board";

export type QualityLevel = "ok" | "info" | "warn";

export interface QualityCheck {
  /** Message key suffix: quality.<id> */
  id:
    | "outline"
    | "noOutline"
    | "partsWithPins"
    | "partsWithoutPins"
    | "markerParts"
    | "estimated"
    | "namedNets"
    | "unnamedNets"
    | "ground"
    | "noGround"
    | "singlePinNets"
    | "unconnectedPins"
    | "bothSides"
    | "oneSide"
    | "duplicates"
    | "traces"
    | "locked";
  level: QualityLevel;
  n?: number;
  m?: number;
  /** A few examples (part or net names). */
  examples?: string[];
}

const UNNAMED = /^(N\d+|NET\d*[_-]?\d+|N\$\d+|UNNAMED.*|\$\d+)$/i;

export function importQuality(model: BoardModel): QualityCheck[] {
  const b = model.board;
  const out: QualityCheck[] = [];
  const parts = b.parts;
  const pct = (n: number, m: number) => (m ? n / m : 0);

  out.push(b.outline.some((p) => p.length >= 3) ? { id: "outline", level: "ok", n: b.outline.length } : { id: "noOutline", level: "warn" });

  const withPins = parts.filter((p) => p.pinCount > 0).length;
  const pinless = parts.filter((p) => p.pinCount === 0 && !p.marker);
  out.push({ id: "partsWithPins", level: pct(withPins, parts.length) > 0.9 ? "ok" : "warn", n: withPins, m: parts.length });
  if (pinless.length) out.push({ id: "partsWithoutPins", level: pct(pinless.length, parts.length) > 0.1 ? "warn" : "info", n: pinless.length, examples: pinless.slice(0, 6).map((p) => p.name) });
  const markers = parts.filter((p) => p.marker);
  if (markers.length) out.push({ id: "markerParts", level: "warn", n: markers.length, examples: markers.slice(0, 6).map((p) => p.name) });
  const estimated = parts.filter((p) => p.estimated);
  if (estimated.length) out.push({ id: "estimated", level: "info", n: estimated.length, examples: estimated.slice(0, 6).map((p) => p.name) });

  const real = b.nets.filter((n) => n.kind !== "unconnected");
  const unnamed = real.filter((n) => UNNAMED.test(n.name));
  out.push({ id: "namedNets", level: pct(unnamed.length, real.length) > 0.5 ? "warn" : "ok", n: real.length - unnamed.length, m: real.length });
  if (unnamed.length) out.push({ id: "unnamedNets", level: "info", n: unnamed.length, examples: unnamed.slice(0, 6).map((n) => n.name) });
  const ground = b.nets.filter((n) => n.kind === "ground");
  out.push(ground.length ? { id: "ground", level: "ok", n: ground.length, examples: ground.slice(0, 4).map((n) => n.name) } : { id: "noGround", level: "warn" });
  const single = real.filter((n) => n.pins.length + n.testPoints.length === 1);
  if (single.length) out.push({ id: "singlePinNets", level: pct(single.length, real.length) > 0.3 ? "warn" : "info", n: single.length, examples: single.slice(0, 6).map((n) => n.name) });
  const unconnected = b.pins.filter((p) => b.nets[p.net]?.kind === "unconnected").length;
  if (unconnected) out.push({ id: "unconnectedPins", level: pct(unconnected, b.pins.length) > 0.3 ? "warn" : "info", n: unconnected, m: b.pins.length });

  const bottom = parts.filter((p) => p.side === "bottom").length;
  const top = parts.filter((p) => p.side === "top").length;
  out.push(bottom > 0 && top > 0 ? { id: "bothSides", level: "ok", n: top, m: bottom } : { id: "oneSide", level: "info", n: top || bottom });

  const seen = new Map<string, number>();
  for (const p of parts) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
  const dupes = [...seen].filter(([, c]) => c > 1);
  if (dupes.length) out.push({ id: "duplicates", level: "warn", n: dupes.length, examples: dupes.slice(0, 6).map(([n]) => n) });

  if ((b.traces?.length ?? 0) > 0) out.push({ id: "traces", level: "ok", n: b.traces!.length, m: b.layers?.length ?? 0 });
  if ((b.lockedParts ?? 0) > 0) out.push({ id: "locked", level: "warn", n: b.lockedParts });
  return out;
}
