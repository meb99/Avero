/**
 * What the board's tooltip shows, as FlexBV lays it out: a table for the pin (or test point,
 * track) with its net, side, mount and position, one for its part, and the readings of the
 * net – the reference and OpenBoardData's known-good values.
 */
import type { BoardModel, Hit } from "../core/board";
import { formatLength } from "../format";
import type { Translate } from "../i18n";
import { netReadings, type ObdData } from "../knowledge/obdata";
import { formatValue, type Reading } from "./measure";

export interface HoverDetails {
  /** Groups of label/value rows, each drawn as its own table. */
  rows: [string, string][][];
  /** Readings of the net: condition, diode, voltage, resistance, note. */
  readings: { condition: string; d: string; v: string; r: string; note: string }[];
}

export interface HoverContext {
  t: Translate;
  lang: string;
  units: "mm" | "mil";
  /** The reference readings by net name (BoardNotes.reference). */
  reference?: Record<string, Reading>;
  obdata?: ObdData | null;
  /** A part's value where the schematic gives one. */
  value?(part: number): string | undefined;
}

export function hoverDetails(model: BoardModel, hit: Hit | undefined, ctx: HoverContext): HoverDetails | null {
  if (!hit) return null;
  const { t } = ctx;
  const side = (s: string) => t(s === "top" ? "side.top" : s === "bottom" ? "side.bottom" : "side.both");
  const at = (x: number, y: number) => `${formatLength(x, ctx.units)}, ${formatLength(y, ctx.units)}`;
  const partRows = (i: number): [string, string][] => {
    const p = model.parts[i];
    const value = ctx.value?.(i) ?? p.device;
    return [
      [t("tip.part"), p.name],
      [t("details.side"), side(p.side)],
      [t("details.mount"), t(p.mount === "th" ? "mount.th" : "mount.smd")],
      ...(value ? [[t("tip.value"), value] as [string, string]] : []),
      [t("details.pins"), String(p.pinCount)],
    ];
  };
  const readingsOf = (net: number): HoverDetails["readings"] => {
    const name = model.nets[net].name;
    const out: HoverDetails["readings"] = [];
    const r = ctx.reference?.[name];
    if (r && (r.diode !== undefined || r.voltage !== undefined || r.resistance !== undefined))
      out.push({
        condition: t("tip.reference"),
        d: formatValue(r.diode, "diode", ctx.lang) || "–",
        v: formatValue(r.voltage, "voltage", ctx.lang) || "–",
        r: formatValue(r.resistance, "resistance", ctx.lang) || "–",
        note: r.note ?? "",
      });
    if (ctx.obdata)
      for (const row of netReadings(ctx.obdata, name).rows) out.push({ condition: row.condition, d: row.d || "–", v: row.v || "–", r: row.r || "–", note: row.notes.join(" · ") });
    return out;
  };
  switch (hit.kind) {
    case "pin": {
      const pin = model.pins[hit.pin];
      const part = model.parts[pin.part];
      return {
        rows: [
          [
            [t("tip.pin"), pin.name && pin.name !== pin.number ? `${pin.number} (${pin.name})` : pin.number],
            [t("details.net"), model.nets[pin.net].name],
            [t("details.mount"), t(part.mount === "th" ? "mount.th" : "mount.smd")],
            [t("details.side"), side(pin.side)],
            [t("details.position"), at(pin.x, pin.y)],
          ],
          partRows(pin.part),
        ],
        readings: readingsOf(pin.net),
      };
    }
    case "testPoint": {
      const tp = model.testPoints[hit.testPoint];
      return {
        rows: [
          [
            [tp.kind === "via" ? t("details.via") : t("details.testPoint"), tp.name ?? (tp.probe !== undefined ? String(tp.probe) : "–")],
            [t("details.net"), model.nets[tp.net].name],
            [t("details.side"), side(tp.side)],
            [t("details.position"), at(tp.x, tp.y)],
          ],
        ],
        readings: readingsOf(tp.net),
      };
    }
    case "trace": {
      const tr = model.traces[hit.trace];
      return {
        rows: [
          [
            [t("details.trace"), model.layers[tr.layer]?.name ?? "–"],
            [t("details.net"), model.nets[hit.net].name],
          ],
        ],
        readings: readingsOf(hit.net),
      };
    }
    case "part":
      return { rows: [partRows(hit.part)], readings: [] };
  }
}
