/**
 * The info panel's own sections, laid out like FlexBV's: the selection history, the
 * selected net (readings, linked nets, pins) and the selected parts with their pins.
 * They read the board session; the panel around them is in Sidebar.tsx.
 */
import { useState } from "react";
import type { BoardModel } from "../core/board";
import { traceNet } from "../core/trace";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { netReadings } from "../knowledge/obdata";
import { formatValue } from "../workbench/measure";
import type { Reading } from "../workbench/measure";
import { useBoardSession } from "./BoardSession";
import { selectionLabel } from "./StatusBar";

const SIDE: Record<string, string> = { top: "T", bottom: "B", both: "TB" };

/** "D: 0,45 V  V: 3,30 V  R: –" from a reading, as FlexBV's Measure line. */
function measureLine(r: Reading | undefined, lang: string): string {
  const v = (q: "diode" | "voltage" | "resistance") => formatValue(r?.[q], q, lang) || "–";
  return `D: ${v("diode")}  V: ${v("voltage")}  R: ${v("resistance")}`;
}

/** The parts a FlexBV prefix search finds: same letters, same leading digits ("C77" for C7782). */
export function prefixOf(name: string): string | null {
  const m = /^([A-Za-z]+)(\d+)/.exec(name);
  if (!m) return null;
  return m[1] + m[2].slice(0, Math.max(1, m[2].length - 2));
}

export function HistoryList() {
  const { model, history, onSelect } = useBoardSession();
  const { t } = useI18n();
  if (history.length === 0) return <p className="muted info-empty">{t("info.historyEmpty")}</p>;
  return (
    <ul className="info-list">
      {history.slice(0, 40).map((sel, i) => (
        <li key={i}>
          <button className="link mono" onClick={() => onSelect(sel, true)}>
            {selectionLabel(model, sel)}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function NetSection({ net }: { net: number }) {
  const { model, notes, obdata, onSelect, documents, onSchematicJump } = useBoardSession();
  const { t, lang } = useI18n();
  const n = model.nets[net];
  const reference = notes?.reference[n.name];
  const obd = obdata ? netReadings(obdata, n.name).rows : [];
  const linked = traceNet(model, net).filter((l) => l.depth === 1).slice(0, 16);
  return (
    <table className="info-table">
      <tbody>
        <tr>
          <th>{t("info.measure")}</th>
          <td className="mono">{measureLine(reference, lang)}</td>
        </tr>
        {obd.map((row) => (
          <tr key={row.condition}>
            <th>OBData</th>
            <td className="mono">
              {row.condition}: D: {row.d || "–"} V: {row.v || "–"} R: {row.r || "–"}
            </td>
          </tr>
        ))}
        <tr>
          <th>{t("info.linked")}</th>
          <td>
            {linked.length === 0 && <span className="muted">–</span>}
            {linked.map((l) => (
              <button key={l.net} className="info-chip" title={t("info.via", { part: model.parts[l.via].name })} onClick={() => onSelect({ kind: "net", net: l.net }, true)}>
                {model.nets[l.net].name}
              </button>
            ))}
          </td>
        </tr>
        <tr>
          <th>{t("info.pins")}</th>
          <td>
            <ul className="info-pins">
              {n.pins.slice(0, 400).map((pin) => {
                const p = model.pins[pin];
                return (
                  <li key={pin}>
                    <button className="link mono" onClick={() => onSelect({ kind: "pin", pin }, true)}>
                      {SIDE[p.side]} {model.parts[p.part].name}:{p.number}
                    </button>
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
        {documents.length > 0 && (
          <tr>
            <th />
            <td>
              <button className="small" onClick={() => onSchematicJump(n.name, 0, documents[0])}>
                {t("info.schematic")}
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** One selected part: its row of buttons, then its value and pins. */
function PartBlock({ model, part, first }: { model: BoardModel; part: number; first: boolean }) {
  const { selection, notes, schematicFacts, onSelect, onCenter, onMarkParts, documents, onSchematicJump } = useBoardSession();
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(first);
  const p = model.parts[part];
  const selectedNet = model.selectedNet(selection);
  const value = schematicFacts?.parts.get(p.name.toUpperCase())?.value ?? p.device;
  const prefix = prefixOf(p.name);
  const sel: Selection = { kind: "part", part };
  return (
    <div className="info-part">
      <div className="info-part-row">
        <button className="info-disclosure" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="mono">{p.name}</span>
        </button>
        <button className="small" onClick={() => onCenter(sel)}>
          {t("info.view")}
        </button>
        <button className="small" title={t("info.zoomHint")} onClick={() => onSelect(sel, true)}>
          Z
        </button>
        {documents.length > 0 && (
          <button className="small" onClick={() => onSchematicJump(p.name, 0, documents[0])}>
            {t("info.schematic")}
          </button>
        )}
        {prefix && (
          <button
            className="small"
            title={t("info.prefixHint", { prefix })}
            onClick={() => onMarkParts(model.parts.flatMap((q, i) => (q.name.toUpperCase().startsWith(prefix.toUpperCase()) ? [i] : [])), `prefix:${prefix}`)}
          >
            {t("info.prefix")}
          </button>
        )}
        <span className="muted">{t("info.pinCount", { n: p.pinCount })}</span>
      </div>
      {open && (
        <table className="info-table info-pin-table">
          <tbody>
            {value && (
              <tr>
                <th colSpan={3}>{t("info.value")}</th>
                <td colSpan={3}>{value}</td>
              </tr>
            )}
            {Array.from({ length: Math.min(p.pinCount, 300) }, (_, k) => p.firstPin + k).map((pin) => {
              const q = model.pins[pin];
              const net = model.nets[q.net];
              const r = notes?.reference[net.name];
              return (
                <tr key={pin} className={q.net === selectedNet ? "on-net" : ""} onClick={() => onSelect({ kind: "pin", pin }, false)}>
                  <td className="mono">{SIDE[q.side]}</td>
                  <td className="mono">{q.number}</td>
                  <td className="mono">{net.name}</td>
                  <td className="mono">{formatValue(r?.diode, "diode", lang) || "–"}</td>
                  <td className="mono">{formatValue(r?.voltage, "voltage", lang) || "–"}</td>
                  <td className="mono">{formatValue(r?.resistance, "resistance", lang) || "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The selected part and the parts chosen with it. */
export function partsSelected(model: BoardModel, selection: Selection, multiParts: readonly number[]): number[] {
  const part = model.selectedPart(selection);
  return [...new Set([...(part !== undefined ? [part] : []), ...multiParts])];
}

export function PartsSection({ parts }: { parts: number[] }) {
  const { model } = useBoardSession();
  return (
    <div className="info-parts">
      {parts.slice(0, 40).map((part, i) => (
        <PartBlock key={part} model={model} part={part} first={i === 0} />
      ))}
    </div>
  );
}
