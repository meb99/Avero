import { ask } from "@tauri-apps/plugin-dialog";
import { askText } from "./Ask";
import { useEffect, useMemo, useState } from "react";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { formatValue, QUANTITIES, type Reading } from "../workbench/measure";
import {
  activeCase,
  addCase,
  netStatuses,
  removeBookmark,
  removeCase,
  DRAWING_COLORS,
  lockDrawing,
  removeDrawing,
  renameBookmark,
  setConditions,
  setDrawingFields,
  updateCase,
  updateDrawing,
  type BoardNotes,
  type Bookmark,
  type DrawingColor,
  type DrawingKind,
  type NetStatus,
} from "../workbench/notes";
import { formatLength } from "../format";
import { exportNotes, importNotes } from "../workbench/store";
import { CaseEditor, CaseHistory } from "./CaseEditor";
import { ConditionsEditor } from "./Conditions";
import { MeasureLists } from "./MeasureLists";
import { Versions } from "./Versions";

interface Props {
  model: BoardModel;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  tolerance: number;
  onTolerance(t: number): void;
  onSelect(selection: Selection, zoom: boolean): void;
  onShowMarker(id: string): void;
  onShowDrawing(id: string): void;
  onShowBookmark(b: Bookmark): void;
  onAddBookmark(): void;
  error: string | null;
  selection: Selection;
  units: "mm" | "mil";
  listFocus?: { listId: string; index: number; n: number } | null;
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
export function Workbench({ model, notes, update, tolerance, onTolerance, onSelect, onShowMarker, onShowDrawing, onShowBookmark, onAddBookmark, error, selection, units, listFocus }: Props) {
  const { t, lang } = useI18n();
  const boundLabel = useBoundLabel();
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
        <details className="wb-conditions">
          <summary>{t("cond.title")}</summary>
          {current && (
            <>
              <div className="wb-label">{current.title}</div>
              <ConditionsEditor value={current.conditions} onChange={(c) => update((n) => setConditions(n, { caseId: current.id }, c))} />
            </>
          )}
          <div className="wb-label">{t("measure.reference")}</div>
          <ConditionsEditor value={notes.referenceConditions} onChange={(c) => update((n) => setConditions(n, "reference", c))} />
          <p className="muted">{t("cond.hint")}</p>
        </details>
      </section>

      <MeasureLists model={model} notes={notes} update={update} selection={selection} onSelect={onSelect} focus={listFocus} />

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
        <div className="wb-row wb-head">
          <h3>
            {t("bookmark.title")} <span className="muted">{notes.bookmarks?.length ?? 0}</span>
          </h3>
          <button className="small" onClick={onAddBookmark} title="⌘D">
            + {t("bookmark.add")}
          </button>
        </div>
        {(notes.bookmarks?.length ?? 0) === 0 ? (
          <p className="muted">{t("bookmark.empty")}</p>
        ) : (
          <ul className="marker-list bookmark-list">
            {notes.bookmarks!.map((b) => (
              <li key={b.id}>
                <button className="link" onClick={() => onShowBookmark(b)} title={b.target}>
                  {b.name}
                </button>
                <span className="muted">{t(b.side === "top" ? "side.top" : "side.bottom")}</span>
                <button
                  className="tool icon-only"
                  title={t("measure.rename")}
                  aria-label={t("measure.rename")}
                  onClick={async () => {
                    const name = await askText(t("bookmark.rename"), b.name);
                    if (name?.trim()) update((n) => renameBookmark(n, b.id, name.trim()));
                  }}
                >
                  ✎
                </button>
                <button className="tool icon-only" title={t("bookmark.remove")} aria-label={t("bookmark.remove")} onClick={() => update((n) => removeBookmark(n, b.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(notes.markers?.length ?? 0) > 0 && (
        <section className="wb-section">
          <h3>
            {t("marker.list")} <span className="muted">{notes.markers!.length}</span>
          </h3>
          <ul className="marker-list">
            {notes.markers!.map((m) => (
              <li key={m.id}>
                {m.target?.startsWith("net:") ? (
                  <span>{m.text || t("marker.empty")}</span>
                ) : (
                  <button className="link" onClick={() => onShowMarker(m.id)}>
                    {m.text || t("marker.empty")}
                  </button>
                )}
                {m.target && <span className="src-tag">{boundLabel(m.target)}</span>}
                {(m.photos?.length ?? 0) > 0 && <span className="muted"> 📷 {m.photos!.length}</span>}
                <span className="muted">{t(m.side === "top" ? "side.top" : "side.bottom")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(notes.drawings?.length ?? 0) > 0 && (
        <DrawingList notes={notes} update={update} units={units} onShowDrawing={onShowDrawing} />
      )}

      <section className="wb-section">
        <label className="wb-label">{t("measure.boardNotes")}</label>
        <NotesField value={notes.notes} placeholder={notes.key} onSave={(v) => update((n) => ({ ...n, notes: v }))} />
      </section>

      <Versions notes={notes} update={update} />

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

/** "Bauteil U7", "Pin U7.21", "Netz PP3V3" for a note's binding. */
function useBoundLabel() {
  const { t } = useI18n();
  return (target: string) =>
    target.startsWith("part:")
      ? t("bound.part", { name: target.slice(5) })
      : target.startsWith("net:")
        ? t("bound.net", { name: target.slice(4) })
        : t("bound.point", { name: target.replace(/^TP:/, "") });
}

const COLOR_HEX: Record<DrawingColor, string> = { orange: "#ff9800", red: "#ef5350", green: "#22c55e", blue: "#42a5f5", yellow: "#ffd600", white: "#ffffff" };

/**
 * The board's drawings, filterable by kind and group: text, color and
 * width per drawing, groups that move and lock together, a lock against
 * changes, moving to a new spot on the board, deleting.
 */
function DrawingList({
  notes,
  update,
  units,
  onShowDrawing,
}: {
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  units: "mm" | "mil";
  onShowDrawing(id: string): void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<DrawingKind | "">("");
  const [group, setGroup] = useState("");
  const all = notes.drawings ?? [];
  const groups = [...new Set(all.flatMap((d) => (d.group ? [d.group] : [])))].sort();
  const kinds = [...new Set(all.map((d) => d.kind))];
  const shown = all.filter((d) => (!kind || d.kind === kind) && (!group || d.group === group));
  return (
    <section className="wb-section">
      <h3>
        {t("draw.list")} <span className="muted">{shown.length === all.length ? all.length : `${shown.length}/${all.length}`}</span>
      </h3>
      {(kinds.length > 1 || groups.length > 0) && (
        <div className="wb-row drawing-filter">
          <select value={kind} onChange={(e) => setKind(e.target.value as DrawingKind | "")} aria-label={t("draw.filterKind")}>
            <option value="">{t("draw.allKinds")}</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`draw.kind.${k}`)}
              </option>
            ))}
          </select>
          {groups.length > 0 && (
            <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label={t("draw.filterGroup")}>
              <option value="">{t("draw.allGroups")}</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <ul className="marker-list drawing-list">
        {shown.map((d) => {
          const length = d.points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - d.points[i].x, p.y - d.points[i].y), 0);
          const locked = !!d.locked;
          return (
            <li key={d.id} className={locked ? "locked" : undefined}>
              <button className="link" onClick={() => onShowDrawing(d.id)}>
                {t(`draw.kind.${d.kind}`)}
                {d.kind === "jumper" && d.from && d.to ? `: ${d.from} → ${d.to}` : ""}
              </button>
              {(d.kind === "line" || d.kind === "jumper" || d.kind === "arrow") && (
                <span className="muted"> {t("draw.length", { length: formatLength(length, units) })}</span>
              )}
              <span className="muted"> · {t(d.side === "top" ? "side.top" : "side.bottom")}</span>
              {d.group && <span className="src-tag">{d.group}</span>}
              <input
                className="drawing-text"
                defaultValue={d.text ?? ""}
                disabled={locked}
                placeholder={t("draw.text")}
                onBlur={(e) => e.target.value !== (d.text ?? "") && update((n) => updateDrawing(n, d.id, e.target.value.trim()))}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              <span className="drawing-style">
                {DRAWING_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`swatch${(d.color ?? "") === c ? " on" : ""}`}
                    style={{ background: COLOR_HEX[c] }}
                    disabled={locked}
                    title={t(`draw.color.${c}`)}
                    aria-label={t(`draw.color.${c}`)}
                    onClick={() => update((n) => setDrawingFields(n, d.id, { color: d.color === c ? undefined : c }))}
                  />
                ))}
                <select
                  value={d.width ?? 2}
                  disabled={locked}
                  aria-label={t("draw.width")}
                  onChange={(e) => update((n) => setDrawingFields(n, d.id, { width: Number(e.target.value) as 1 | 2 | 3 }))}
                >
                  <option value={1}>{t("draw.thin")}</option>
                  <option value={2}>{t("draw.normal")}</option>
                  <option value={3}>{t("draw.thick")}</option>
                </select>
                <button
                  className="tool icon-only"
                  disabled={locked}
                  title={t("draw.groupHint")}
                  aria-label={t("draw.group")}
                  onClick={async () => {
                    const name = await askText(t("draw.groupAsk"), d.group ?? "", { title: t("draw.group") });
                    if (name !== null) update((n) => setDrawingFields(n, d.id, { group: name.trim() || undefined }));
                  }}
                >
                  ⧉
                </button>
                <button
                  className="tool icon-only"
                  disabled={locked}
                  title={t("draw.moveHint")}
                  aria-label={t("draw.move")}
                  onClick={() => window.dispatchEvent(new CustomEvent("avero:move-drawing", { detail: d.id }))}
                >
                  ✥
                </button>
                <button
                  className={`tool icon-only${locked ? " on" : ""}`}
                  aria-pressed={locked}
                  title={t(locked ? "draw.unlock" : "draw.lock")}
                  aria-label={t(locked ? "draw.unlock" : "draw.lock")}
                  onClick={() => update((n) => lockDrawing(n, d.id, !locked))}
                >
                  {locked ? "🔒" : "🔓"}
                </button>
                <button
                  className="tool icon-only danger"
                  disabled={locked}
                  onClick={() => update((n) => removeDrawing(n, d.id))}
                  title={t("draw.delete")}
                  aria-label={t("draw.delete")}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
