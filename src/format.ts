import { MILS_PER_MM } from "./core/types";

/** Formats a length given in mils for display. */
export function formatLength(mils: number, units: "mm" | "mil"): string {
  if (units === "mil") return `${Math.round(mils)} mil`;
  const mm = mils / MILS_PER_MM;
  const digits = Math.abs(mm) < 10 ? 2 : 1;
  return `${mm.toFixed(digits)} mm`;
}

export function formatSize(w: number, h: number, units: "mm" | "mil"): string {
  if (units === "mil") return `${Math.round(w)} × ${Math.round(h)} mil`;
  return `${(w / MILS_PER_MM).toFixed(2)} × ${(h / MILS_PER_MM).toFixed(2)} mm`;
}
