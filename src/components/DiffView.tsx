import { useMemo, useState } from "react";
import type { BoardModel } from "../core/board";
import { diffBoards, type PartChange } from "../core/diff";
import type { Selection } from "../core/types";
import { useI18n, type MessageKey } from "../i18n";
import { Dialog } from "./Dialogs";

type Section = "changed" | "onlyA" | "onlyB" | "pins" | "nets";

/** What differs between the board in view (A) and the compared board (B). */
export function DiffView({
  a,
  b,
  nameA,
  nameB,
  onSelect,
  onMark,
  onClose,
}: {
  a: BoardModel;
  b: BoardModel;
  nameA: string;
  nameB: string;
  onSelect(selection: Selection, zoom: boolean): void;
  /** Highlights parts of A on the board (changed and removed ones). */
  onMark(parts: number[] | null): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const diff = useMemo(() => diffBoards(a, b), [a, b]);
  const [section, setSection] = useState<Section>(diff.changed.length ? "changed" : diff.pins.length ? "pins" : "onlyA");
  const [marked, setMarked] = useState(false);
  const counts: Record<Section, number> = {
    changed: diff.changed.length,
    onlyA: diff.onlyA.length,
    onlyB: diff.onlyB.length,
    pins: diff.pins.length,
    nets: diff.netsOnlyA.length + diff.netsOnlyB.length,
  };
  const partRow = (c: PartChange, side: "a" | "b") => (
    <tr key={`${side}${c.name}`} className={side === "a" ? "clickable" : undefined} onClick={() => side === "a" && c.a !== undefined && onSelect({ kind: "part", part: c.a }, true)}>
      <td className="mono">{c.name}</td>
      <td className="muted">{c.changes.map((x) => t(`diff.change.${x}` as MessageKey)).join(", ")}</td>
      <td className="mono">{side === "a" || c.deviceA ? c.deviceA ?? "" : ""}</td>
      <td className="mono">{c.deviceB ?? ""}</td>
    </tr>
  );

  return (
    <Dialog title={t("diff.title")} onClose={onClose} className="diff-dialog">
      <p className="muted">
        A: <strong>{nameA}</strong> · B: <strong>{nameB}</strong> · {t("diff.same", { n: diff.same })}
      </p>
      <div className="diff-bar">
        <div className="segmented" role="tablist">
          {(["changed", "pins", "onlyA", "onlyB", "nets"] as Section[]).map((s) => (
            <button key={s} role="tab" aria-selected={section === s} className={section === s ? "on" : ""} onClick={() => setSection(s)}>
              {t(`diff.section.${s}` as MessageKey)} <span className="count">{counts[s]}</span>
            </button>
          ))}
        </div>
        <label className="check small-check">
          <input
            type="checkbox"
            checked={marked}
            onChange={(e) => {
              setMarked(e.target.checked);
              onMark(e.target.checked ? [...diff.changed, ...diff.onlyA].flatMap((c) => (c.a !== undefined ? [c.a] : [])) : null);
            }}
          />
          {t("diff.mark")}
        </label>
      </div>
      <div className="diff-body">
        {counts[section] === 0 ? (
          <p className="muted">{t("diff.none")}</p>
        ) : section === "pins" ? (
          <table className="wb-table">
            <thead>
              <tr>
                <th>{t("details.pin")}</th>
                <th>A</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>
              {diff.pins.slice(0, 2000).map((p) => (
                <tr key={`${p.part}.${p.pin}`} className="clickable" onClick={() => onSelect({ kind: "pin", pin: p.a }, true)}>
                  <td className="mono">
                    {p.part}.{p.pin}
                  </td>
                  <td className="mono">{p.netA}</td>
                  <td className="mono">{p.netB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : section === "nets" ? (
          <div className="diff-nets">
            <div>
              <h3>{t("diff.netsOnlyA")}</h3>
              <ul className="mono">{diff.netsOnlyA.slice(0, 2000).map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
            <div>
              <h3>{t("diff.netsOnlyB")}</h3>
              <ul className="mono">{diff.netsOnlyB.slice(0, 2000).map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          </div>
        ) : (
          <table className="wb-table">
            <thead>
              <tr>
                <th>{t("details.part")}</th>
                <th>{t("diff.what")}</th>
                <th>A</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>{(section === "changed" ? diff.changed : section === "onlyA" ? diff.onlyA : diff.onlyB).slice(0, 2000).map((c) => partRow(c, section === "onlyB" ? "b" : "a"))}</tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}
