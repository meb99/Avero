import { useEffect, useMemo, useState } from "react";
import type { BoardModel } from "../core/board";
import { alignmentMatters, diffBoards, netNamesOnB, type PartChange } from "../core/diff";
import { findPoint } from "../core/points";
import type { Selection } from "../core/types";
import { useI18n, type MessageKey } from "../i18n";
import { formatValue } from "../workbench/measure";
import type { BoardNotes } from "../workbench/notes";
import { diffReadings, type ReadingDifference } from "../workbench/readingDiff";
import { Dialog } from "./Dialogs";

type Area = "population" | "connections" | "readings";
type Section = "changed" | "onlyA" | "onlyB" | "pins" | "netChanges" | "renamed" | "nets" | "readings";

const SECTIONS: Record<Area, Section[]> = {
  population: ["changed", "onlyA", "onlyB"],
  connections: ["pins", "netChanges", "renamed", "nets"],
  readings: ["readings"],
};

/**
 * What differs between the board in view (A) and the compared board (B),
 * apart by population (parts and values), connections (what each net
 * connects; a renamed net with the same pins is no change) and readings.
 * Every row leads to its place on board A.
 */
export function DiffView({
  a,
  b,
  nameA,
  nameB,
  notesA,
  loadNotesB,
  tolerance,
  onSelect,
  onMark,
  onSaveCsv,
  onClose,
}: {
  a: BoardModel;
  b: BoardModel;
  nameA: string;
  nameB: string;
  notesA: BoardNotes | null;
  /** B's notes, for its readings. */
  loadNotesB(): Promise<BoardNotes | null>;
  tolerance: number;
  onSelect(selection: Selection, zoom: boolean): void;
  /** Highlights parts of A on the board (changed and removed ones). */
  onMark(parts: number[] | null): void;
  onSaveCsv(readings: ReadingDifference[], diff: ReturnType<typeof diffBoards>): void;
  onClose(): void;
}) {
  const { t, lang } = useI18n();
  const diff = useMemo(() => diffBoards(a, b), [a, b]);
  const [notesB, setNotesB] = useState<BoardNotes | null>(null);
  useEffect(() => {
    let live = true;
    void loadNotesB()
      .then((n) => live && setNotesB(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [b]);
  // B's name of each net of A, as the boards were paired (a reading on a net A does not have keeps its name).
  const netOnB = useMemo(() => {
    const paired = netNamesOnB(a, b, diff.netMap);
    return (net: string) => (a.findNet(net) === undefined ? net : paired(net));
  }, [a, b, diff]);
  const readings = useMemo(() => (notesA && notesB ? diffReadings(notesA, notesB, netOnB, tolerance) : []), [notesA, notesB, netOnB, tolerance]);
  const readingsOff = readings.filter((r) => r.status !== "ok");
  // Population: parts with another value, pins, side or place (wiring alone is a connection).
  const fitted = diff.changed.filter((c) => c.changes.some((x) => x !== "nets"));
  const counts: Record<Section, number> = {
    changed: fitted.length,
    onlyA: diff.onlyA.length,
    onlyB: diff.onlyB.length,
    pins: diff.pins.length,
    netChanges: diff.netChanges.length,
    renamed: diff.renamed.length,
    nets: diff.netsOnlyA.length + diff.netsOnlyB.length,
    readings: readingsOff.length,
  };
  const areaCount = (area: Area) => SECTIONS[area].filter((s) => s !== "renamed").reduce((n, s) => n + counts[s], 0);
  const first = (["changed", "onlyA", "onlyB", "pins", "netChanges", "nets"] as Section[]).find((s) => counts[s] > 0) ?? "changed";
  const [section, setSection] = useState<Section>(first);
  const area = (Object.keys(SECTIONS) as Area[]).find((x) => SECTIONS[x].includes(section))!;
  const [marked, setMarked] = useState(false);
  const [allReadings, setAllReadings] = useState(false);

  const goNet = (name: string) => {
    const i = a.findNet(name);
    if (i !== undefined) onSelect({ kind: "net", net: i }, true);
  };
  const goPoint = (id: string) => {
    const sel = findPoint(a, id);
    if (sel) onSelect(sel, true);
  };
  const ref = (label: string, go: (() => void) | null, key?: string) =>
    go ? (
      <button key={key} className="link mono" onClick={go}>
        {label}
      </button>
    ) : (
      <span key={key} className="mono muted" title={t("diff.notOnA")}>
        {label}
      </span>
    );
  const pinRef = (id: string) => ref(id, findPoint(a, id) ? () => goPoint(id) : null, id);

  const partRow = (c: PartChange, side: "a" | "b") => (
    <tr key={`${side}${c.name}`} className={side === "a" ? "clickable" : undefined} onClick={() => side === "a" && c.a !== undefined && onSelect({ kind: "part", part: c.a }, true)}>
      <td className="mono">{c.name}</td>
      <td className="muted">{c.changes.filter((x) => x !== "nets").map((x) => t(`diff.change.${x}` as MessageKey)).join(", ")}</td>
      <td className="mono">{c.deviceA ?? ""}</td>
      <td className="mono">{c.deviceB ?? ""}</td>
    </tr>
  );
  const value = (r: ReadingDifference, v: ReadingDifference["a"]) => (v === undefined ? "–" : formatValue(v, r.quantity, lang));
  const angle = diff.aligned ? (diff.aligned.angle * 180) / Math.PI : 0;

  return (
    <Dialog title={t("diff.title")} onClose={onClose} className="diff-dialog">
      <p className="muted">
        A: <strong>{nameA}</strong> · B: <strong>{nameB}</strong> · {t("diff.same", { n: diff.same })}
        {alignmentMatters(diff.aligned) && (
          <>
            {" · "}
            <span title={t("diff.alignedHint")}>
              {t("diff.aligned", {
                angle: angle.toFixed(1),
                dx: Math.round(diff.aligned!.dx),
                dy: Math.round(diff.aligned!.dy),
                scale: diff.aligned!.scale.toFixed(3),
              })}
            </span>
          </>
        )}
      </p>
      <div className="diff-bar">
        <div className="segmented" role="tablist" aria-label={t("diff.areas")}>
          {(Object.keys(SECTIONS) as Area[]).map((x) => (
            <button
              key={x}
              role="tab"
              aria-selected={area === x}
              className={area === x ? "on" : ""}
              onClick={() => setSection(SECTIONS[x].find((s) => counts[s] > 0) ?? SECTIONS[x][0])}
            >
              {t(`diff.area.${x}` as MessageKey)} <span className="count">{areaCount(x)}</span>
            </button>
          ))}
        </div>
        <button className="small" onClick={() => onSaveCsv(readings, diff)}>
          {t("diff.saveList")}
        </button>
      </div>
      {SECTIONS[area].length > 1 && (
        <div className="diff-bar">
          <div className="segmented small-seg" role="tablist">
            {SECTIONS[area].map((s) => (
              <button key={s} role="tab" aria-selected={section === s} className={section === s ? "on" : ""} onClick={() => setSection(s)}>
                {t(`diff.section.${s}` as MessageKey)} <span className="count">{counts[s]}</span>
              </button>
            ))}
          </div>
          {area === "population" && (
            <label className="check small-check">
              <input
                type="checkbox"
                checked={marked}
                onChange={(e) => {
                  setMarked(e.target.checked);
                  onMark(e.target.checked ? [...fitted, ...diff.onlyA].flatMap((c) => (c.a !== undefined ? [c.a] : [])) : null);
                }}
              />
              {t("diff.mark")}
            </label>
          )}
        </div>
      )}
      {section === "renamed" && <p className="muted">{t("diff.renamedHint")}</p>}
      {section === "netChanges" && <p className="muted">{t("diff.netChangesHint")}</p>}
      <div className="diff-body">
        {section === "readings" ? (
          !notesA || !notesB ? (
            <p className="muted">{t("diff.readingsLoading")}</p>
          ) : readings.length === 0 ? (
            <p className="muted">{t("diff.noReadings")}</p>
          ) : (
            <>
              <label className="check small-check">
                <input type="checkbox" checked={allReadings} onChange={(e) => setAllReadings(e.target.checked)} />
                {t("diff.showAgreeing", { n: readings.length - readingsOff.length })}
              </label>
              <table className="wb-table">
                <thead>
                  <tr>
                    <th>{t("diff.where")}</th>
                    <th>{t("diff.quantity")}</th>
                    <th>A</th>
                    <th>B</th>
                    <th>{t("diff.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(allReadings ? readings : readingsOff).slice(0, 2000).map((r) => (
                    <tr key={`${r.point ?? r.net}/${r.quantity}`} className={`status-${r.status}`}>
                      <td>
                        {r.point ? pinRef(r.point) : ref(r.net, a.findNet(r.net) !== undefined ? () => goNet(r.net) : null)}
                        {r.netB && <span className="muted"> → {r.netB}</span>}
                      </td>
                      <td>{t(`measure.${r.quantity}` as MessageKey)}</td>
                      <td className="mono">{value(r, r.a)}</td>
                      <td className="mono">{value(r, r.b)}</td>
                      <td>{t(`diff.reading.${r.status}` as MessageKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        ) : counts[section] === 0 ? (
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
        ) : section === "netChanges" ? (
          <table className="wb-table">
            <thead>
              <tr>
                <th>{t("diff.net")}</th>
                <th>{t("diff.added")}</th>
                <th>{t("diff.removed")}</th>
              </tr>
            </thead>
            <tbody>
              {diff.netChanges.slice(0, 2000).map((n) => (
                <tr key={n.name}>
                  <td>
                    {ref(n.name, () => goNet(n.name))}
                    {n.renamedTo && <span className="muted"> → {n.renamedTo}</span>}
                  </td>
                  <td className="diff-pins">{n.added.slice(0, 200).map(pinRef)}</td>
                  <td className="diff-pins">{n.removed.slice(0, 200).map(pinRef)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : section === "renamed" ? (
          <table className="wb-table">
            <thead>
              <tr>
                <th>A</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>
              {diff.renamed.slice(0, 2000).map((r) => (
                <tr key={r.a}>
                  <td>{ref(r.a, () => goNet(r.a))}</td>
                  <td className="mono">{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : section === "nets" ? (
          <div className="diff-nets">
            <div>
              <h3>{t("diff.netsOnlyA")}</h3>
              <ul className="mono">
                {diff.netsOnlyA.slice(0, 2000).map((n) => (
                  <li key={n}>{ref(n, () => goNet(n))}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>{t("diff.netsOnlyB")}</h3>
              <ul className="mono">
                {diff.netsOnlyB.slice(0, 2000).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
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
            <tbody>
              {(section === "changed" ? fitted : section === "onlyA" ? diff.onlyA : diff.onlyB).slice(0, 2000).map((c) => partRow(c, section === "onlyB" ? "b" : "a"))}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}
