import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { formatValue, QUANTITIES, type Reading } from "../workbench/measure";
import { activeCase, addCase, netStatuses, removeCase, updateCase, type BoardNotes, type NetStatus } from "../workbench/notes";
import { exportNotes, importNotes } from "../workbench/store";
import { CaseEditor, CaseHistory } from "./CaseEditor";

interface Props {
  model: BoardModel;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  tolerance: number;
  onTolerance(t: number): void;
  onSelect(selection: Selection, zoom: boolean): void;
  error: string | null;
}

const SHORT = { diode: "D", voltage: "U", resistance: "R" } as const;

function summary(r: Reading | undefined, lang: string): string {
  if (!r) return "";
  return QUANTITIES.filter((q) => r[q] !== undefined)
    .map((q) => `${SHORT[q]} ${formatValue(r[q], q, lang)}`)
    .join(" · ");
}

/** Text area that saves when it loses focus instead of on every key. */
function NotesField({ value, onSave, placeholder }: { value: string; onSave(v: string): void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      className="notes-field"
      value={text}
      placeholder={placeholder}
      rows={3}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)}
    />
  );
}

/** The "Measure" tab: repair cases, all measured nets, notes, import/export. */
export function Workbench({ model, notes, update, tolerance, onTolerance, onSelect, error }: Props) {
  const { t, lang } = useI18n();
  const [onlyDeviations, setOnlyDeviations] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const current = activeCase(notes);
  const statuses = useMemo(() => netStatuses(notes, tolerance), [notes, tolerance]);

  const rows = useMemo(() => {
    const names = new Set([...Object.keys(notes.reference), ...Object.keys(current?.readings ?? {})]);
    return [...names]
      .filter((n) => statuses.has(n))
      .filter((n) => !onlyDeviations || statuses.get(n) === "deviation")
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [notes, current, statuses, onlyDeviations]);

  const statusLabel = (s: NetStatus) => t(`measure.status.${s}`);

  return (
    <div className="workbench">
      <section className="wb-section">
        <label className="wb-label" htmlFor="wb-case">
          {t("measure.case")}
        </label>
        <div className="wb-row">
          <select
            id="wb-case"
            value={notes.activeCase ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id === "__new") update((n) => addCase(n, t("measure.caseTitle", { n: n.cases.length + 1 })));
              else update((n) => ({ ...n, activeCase: id || null }));
            }}
          >
            <option value="">{t("measure.noCase")}</option>
            {notes.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value="__new">+ {t("measure.newCase")}</option>
          </select>
          {current && (
            <>
              <button className="small" onClick={() => setRenaming(current.title)}>
                {t("measure.rename")}
              </button>
              <button
                className="small danger"
                onClick={() =>
                  void ask(t("measure.deleteConfirm", { title: current.title }), { title: t("measure.delete"), kind: "warning" }).then(
                    (yes) => yes && update((n) => removeCase(n, current.id)),
                  )
                }
              >
                {t("measure.delete")}
              </button>
            </>
          )}
        </div>
        {current && renaming !== null && (
          <input
            className="rename-input"
            autoFocus
            value={renaming}
            aria-label={t("measure.rename")}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={() => {
              if (renaming.trim()) update((n) => updateCase(n, current.id, { title: renaming.trim() }));
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        )}
        <CaseHistory notes={notes} onPick={(id) => update((n) => ({ ...n, activeCase: id }))} />
        {current && (
          <NotesField
            value={current.notes}
            placeholder={t("measure.caseNotes")}
            onSave={(v) => update((n) => updateCase(n, current.id, { notes: v }))}
          />
        )}
        {current && <CaseEditor notes={notes} repair={current} update={update} tolerance={tolerance} onMessage={setMessage} />}
      </section>

      <section className="wb-section">
        <div className="wb-row wb-head">
          <h3>
            {t("measure.list")} <span className="muted">{rows.length}</span>
          </h3>
          <label className="check small-check">
            <input type="checkbox" checked={onlyDeviations} onChange={(e) => setOnlyDeviations(e.target.checked)} />
            {t("measure.onlyDeviations")}
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="muted wb-empty">{t("measure.empty")}</p>
        ) : (
          <table className="wb-table">
            <thead>
              <tr>
                <th />
                <th>{t("details.net")}</th>
                <th>{t("measure.reference")}</th>
                {current && <th>{current.title}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((name) => {
                const status = statuses.get(name)!;
                const net = model.findNet(name);
                return (
                  <tr
                    key={name}
                    className={net === undefined ? "missing" : undefined}
                    onClick={() => net !== undefined && onSelect({ kind: "net", net }, true)}
                  >
                    <td>
                      <span className={`status-dot status-${status}`} title={statusLabel(status)} />
                    </td>
                    <td className="mono">{name}</td>
                    <td>{summary(notes.reference[name], lang)}</td>
                    {current && <td>{summary(current.readings[name], lang)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="wb-row">
          <label className="wb-label" htmlFor="wb-tol">
            {t("measure.tolerance")}
          </label>
          <select id="wb-tol" value={tolerance} onChange={(e) => onTolerance(Number(e.target.value))}>
            {[0.05, 0.1, 0.15, 0.2, 0.3].map((v) => (
              <option key={v} value={v}>
                ± {Math.round(v * 100)} %
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="wb-section">
        <label className="wb-label">{t("measure.boardNotes")}</label>
        <NotesField value={notes.notes} placeholder={notes.key} onSave={(v) => update((n) => ({ ...n, notes: v }))} />
      </section>

      <section className="wb-section wb-row">
        <button className="small" onClick={() => void exportNotes(notes, t("measure.export")).catch((e) => setMessage(String(e)))}>
          {t("measure.export")}
        </button>
        <button
          className="small"
          onClick={() =>
            void importNotes(notes, t("measure.import"))
              .then((merged) => merged && update(() => merged))
              .catch(() => setMessage(t("measure.importError")))
          }
        >
          {t("measure.import")}
        </button>
        <span className="muted wb-key" title={t("measure.board")}>
          {notes.key}
        </span>
      </section>
      {(message || error) && <p className="wb-error">{message ?? t("measure.saveError", { message: error ?? "" })}</p>}
    </div>
  );
}
