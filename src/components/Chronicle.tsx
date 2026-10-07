/** The repair chronicle of a case (F54): work steps with photos, and the readings before and after them. */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useI18n } from "../i18n";
import { chronicle, type Evidence, type MeasureEvent } from "../workbench/chronicle";
import { formatValue } from "../workbench/measure";
import { addStep, removeStep, STEP_ACTIONS, updateStep, type BoardNotes, type RepairCase, type RepairStep, type StepAction } from "../workbench/notes";
import { askConfirm } from "./Ask";
import { Thumb } from "./CaseEditor";

/** What is selected on the board, as a step would name it. */
export interface StepSubject {
  target?: string;
  nets: string[];
}

interface Props {
  notes: BoardNotes;
  repair: RepairCase;
  update(change: (n: BoardNotes) => BoardNotes): void;
  subject?: StepSubject;
  onMessage(message: string | null): void;
}

/** "2026-10-07T09:30" for a datetime-local input, in local time. */
const localInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function Chronicle({ notes, repair, update, subject, onMessage }: Props) {
  const { t, lang } = useI18n();
  const [action, setAction] = useState<StepAction>("removed");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [showReadings, setShowReadings] = useState(false);
  const entries = chronicle(repair);
  const time = (iso: string) => new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const value = (e?: MeasureEvent) => (e ? formatValue(e.value, e.q, lang) : "–");
  const change = (id: string, c: Partial<Omit<RepairStep, "id">>) => update((n) => updateStep(n, repair.id, id, c));

  const add = () => {
    const name = target.trim() || subject?.target;
    // The nets of the selection when the step is about it; a typed target keeps only what was typed.
    const nets = !target.trim() || target.trim() === subject?.target ? subject?.nets ?? [] : [];
    update((n) =>
      addStep(n, repair.id, {
        action,
        ...(name && { target: name }),
        ...(nets.length && { nets }),
        ...(note.trim() && { note: note.trim() }),
      }),
    );
    setNote("");
    setTarget("");
  };

  const addPhotos = async (step: RepairStep) => {
    const picked = await open({
      title: t("case.addPhotos"),
      multiple: true,
      directory: false,
      filters: [{ name: t("case.photos"), extensions: ["jpg", "jpeg", "png", "heic", "webp"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    try {
      const stored: string[] = [];
      for (const path of paths) stored.push(await invoke<string>("import_photo", { key: notes.key, side: "case", path }));
      update((n) => {
        const now = n.cases.find((c) => c.id === repair.id)?.steps?.find((s) => s.id === step.id);
        return updateStep(n, repair.id, step.id, { photos: [...(now?.photos ?? []), ...stored] });
      });
    } catch (e) {
      onMessage(String(e));
    }
  };

  const evidenceRow = (e: Evidence) => {
    const moved = e.before && e.after && e.before.value !== e.after.value;
    return (
      <tr key={`${e.point ? "p" : "n"}${e.subject}${e.q}`}>
        <td className="mono">{e.subject}</td>
        <td className="muted">{t(`measure.${e.q}`)}</td>
        <td className="mono" title={e.before ? time(e.before.at) : t("chron.noBefore")}>
          {value(e.before)}
        </td>
        <td>→</td>
        <td className={`mono${moved ? " changed" : ""}`} title={e.after ? time(e.after.at) : t("chron.noAfter")}>
          {value(e.after)}
        </td>
      </tr>
    );
  };

  return (
    <section className="chronicle">
      <h4 title={t("chron.hint")}>{t("chron.title")}</h4>
      <div className="chron-add">
        <select value={action} onChange={(e) => setAction(e.target.value as StepAction)} aria-label={t("chron.action")}>
          {STEP_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`chron.action.${a}`)}
            </option>
          ))}
        </select>
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={subject?.target ?? t("chron.target")} aria-label={t("chron.target")} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("chron.note")} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="small primary" onClick={add}>
          + {t("chron.add")}
        </button>
      </div>
      {subject && !target.trim() && subject.nets.length > 0 && (
        <p className="muted chron-subject">{t("chron.subject", { nets: subject.nets.slice(0, 6).join(", ") + (subject.nets.length > 6 ? " …" : "") })}</p>
      )}
      {entries.length > 0 && (
        <label className="check chron-toggle">
          <input type="checkbox" checked={showReadings} onChange={(e) => setShowReadings(e.target.checked)} /> {t("chron.showReadings")}
        </label>
      )}
      <ol className="chron-list">
        {entries.map((entry) => {
          if (entry.kind === "measure") {
            if (!showReadings) return null;
            const e = entry.event;
            return (
              <li key={`m${e.at}${e.subject}${e.q}`} className="chron-measure">
                <span className="muted">{time(e.at)}</span> <span className="mono">{e.subject}</span> {t(`measure.${e.q}`)} <span className="mono">{value(e)}</span>
              </li>
            );
          }
          const s = entry.step;
          return (
            <li key={s.id} className={`chron-step${s.report === false ? " off-report" : ""}`}>
              <div className="chron-head">
                <input
                  type="datetime-local"
                  className="chron-time"
                  value={localInput(s.at)}
                  onChange={(e) => e.target.value && change(s.id, { at: new Date(e.target.value).toISOString() })}
                />
                <strong>{t(`chron.action.${s.action}`)}</strong>
                {s.target && <span className="mono">{s.target}</span>}
                <select
                  value={s.result ?? ""}
                  className={s.result ? `result-${s.result}` : undefined}
                  onChange={(e) => change(s.id, { result: (e.target.value || undefined) as RepairStep["result"] })}
                  aria-label={t("chron.result")}
                >
                  <option value="">{t("chron.result.open")}</option>
                  <option value="ok">{t("chron.result.ok")}</option>
                  <option value="fail">{t("chron.result.fail")}</option>
                </select>
                <label className="check" title={t("chron.reportHint")}>
                  <input type="checkbox" checked={s.report !== false} onChange={(e) => change(s.id, { report: e.target.checked ? undefined : false })} /> {t("chron.inReport")}
                </label>
                <button
                  className="tool icon-only"
                  title={t("chron.remove")}
                  aria-label={t("chron.remove")}
                  onClick={async () => (await askConfirm(t("chron.removeAsk"), { danger: true, ok: t("chron.remove") })) && update((n) => removeStep(n, repair.id, s.id))}
                >
                  ×
                </button>
              </div>
              {s.note && <p className="chron-note">{s.note}</p>}
              {entry.evidence.length > 0 ? (
                <table className="wb-table chron-evidence">
                  <thead>
                    <tr>
                      <th />
                      <th />
                      <th>{t("chron.before")}</th>
                      <th />
                      <th>{t("chron.after")}</th>
                    </tr>
                  </thead>
                  <tbody>{entry.evidence.map(evidenceRow)}</tbody>
                </table>
              ) : (
                (s.nets?.length || s.target) && <p className="muted">{t("chron.noEvidence")}</p>
              )}
              <div className="case-photos">
                {(s.photos ?? []).map((file) => (
                  <Thumb key={file} file={file} label={t("case.removePhoto")} onRemove={() => change(s.id, { photos: (s.photos ?? []).filter((p) => p !== file) })} />
                ))}
                <button className="small" onClick={() => void addPhotos(s)}>
                  + {t("chron.photo")}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {!(repair.steps ?? []).length && <p className="muted">{t("chron.empty")}</p>}
    </section>
  );
}
