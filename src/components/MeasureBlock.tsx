import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { compare, conditionsFit, formatValue, parseValue, QUANTITIES, type HistoryEntry, type Quantity, type Reading, type Value } from "../workbench/measure";
import { conditionsText } from "./Conditions";
import { activeCase, addCase, setReading, setValue, type BoardNotes, type Target } from "../workbench/notes";

interface Props {
  net: string;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  tolerance: number;
}

const LABEL: Record<Quantity, MessageKey> = {
  diode: "measure.diode",
  voltage: "measure.voltage",
  resistance: "measure.resistance",
};

/** A reading field: shows the formatted value, edits the raw text. */
export function ValueInput({
  value,
  quantity,
  onChange,
  status,
  label,
}: {
  value: Value | undefined;
  quantity: Quantity;
  onChange(v: Value | undefined): void;
  status?: "ok" | "deviation" | "mismatch";
  label: string;
}) {
  const { t, lang } = useI18n();
  const shown = formatValue(value, quantity, lang);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);

  const commit = () => {
    editing.current = false;
    if (text === shown) {
      setInvalid(false);
      return;
    }
    const parsed = parseValue(text, quantity);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(parsed);
    setText(formatValue(parsed, quantity, lang));
  };

  return (
    <input
      className={`value-input${invalid ? " invalid" : ""}${status ? ` status-${status}` : ""}`}
      value={text}
      aria-label={label}
      aria-invalid={invalid}
      title={invalid ? t("measure.invalid") : status ? t(`measure.status.${status}`) : undefined}
      spellCheck={false}
      onFocus={(e) => {
        editing.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          editing.current = false;
          setInvalid(false);
          setText(shown);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Reference and repair-case readings for one net, in the details panel. */
export function MeasureBlock({ net, notes, update, tolerance }: Props) {
  const { t, lang } = useI18n();
  const current = activeCase(notes);
  const ref = notes.reference[net];
  const mine = current?.readings[net];
  const target: Target | null = current ? { caseId: current.id } : null;
  const noteTarget: Target = target ?? "reference";
  const note = (target ? mine?.note : ref?.note) ?? "";
  const [noteText, setNoteText] = useState(note);
  useEffect(() => setNoteText(note), [note, net]);

  return (
    <section className="details-section measure">
      <h3>{t("measure.title")}</h3>
      <table className="measure-table">
        <thead>
          <tr>
            <th />
            <th title={t("measure.referenceHint")}>{t("measure.reference")}</th>
            {current && <th>{current.title}</th>}
          </tr>
        </thead>
        <tbody>
          {QUANTITIES.map((q) => (
            <tr key={q}>
              <th scope="row">{t(LABEL[q])}</th>
              <td>
                <ValueInput
                  value={ref?.[q]}
                  quantity={q}
                  label={`${t(LABEL[q])} · ${t("measure.reference")}`}
                  onChange={(v) => update((n) => setValue(n, "reference", net, q, v))}
                />
              </td>
              {target && current && (
                <td>
                  <ValueInput
                    value={mine?.[q]}
                    quantity={q}
                    label={`${t(LABEL[q])} · ${current.title}`}
                    status={
                      ref?.[q] !== undefined && mine?.[q] !== undefined && !conditionsFit(ref.cond, mine.cond, q)
                        ? "mismatch"
                        : compare(ref?.[q], mine?.[q], q, tolerance)
                    }
                    onChange={(v) => update((n) => setValue(n, target, net, q, v))}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {(ref?.cond || mine?.cond) && (
        <p className="muted measure-cond">
          {ref?.cond && (
            <span>
              {t("measure.reference")}: {conditionsText(ref.cond, t)}
            </span>
          )}
          {mine?.cond && current && (
            <span>
              {current.title}: {conditionsText(mine.cond, t)}
            </span>
          )}
        </p>
      )}
      <History reading={ref} title={t("measure.reference")} lang={lang} />
      {current && <History reading={mine} title={current.title} lang={lang} />}
      <input
        className="note-input"
        placeholder={t("measure.note")}
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        onBlur={() => {
          if (noteText !== note) update((n) => setReading(n, noteTarget, net, { note: noteText || undefined }));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {!current && (
        <p className="measure-hint">
          <button className="link" onClick={() => update((n) => addCase(n, t("measure.caseTitle", { n: n.cases.length + 1 })))}>
            {t("measure.newCase")}
          </button>{" "}
          <span className="muted">{t("measure.addCaseHint")}</span>
        </p>
      )}
    </section>
  );
}

const SHORT: Record<Quantity, string> = { diode: "D", voltage: "U", resistance: "R" };

/** Earlier values of a reading, newest first, with the current one on top: before and after a repair. */
function History({ reading, title, lang }: { reading: Reading | undefined; title: string; lang: string }) {
  const { t } = useI18n();
  const history = reading?.history ?? [];
  if (history.length === 0 || !reading) return null;
  const when = (iso: string) =>
    new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const values = (r: HistoryEntry | Reading) =>
    QUANTITIES.filter((q) => r[q] !== undefined)
      .map((q) => `${SHORT[q]} ${formatValue(r[q], q, lang)}`)
      .join(" · ");
  const entries: { at?: string; text: string; cond: string; now?: boolean }[] = [
    { at: reading.updated, text: values(reading), cond: conditionsText(reading.cond, t), now: true },
    ...[...history].reverse().map((h) => ({ at: h.at, text: values(h), cond: conditionsText(h.cond, t) })),
  ];
  return (
    <details className="measure-history">
      <summary>
        {t("measure.history", { title, n: history.length })}
      </summary>
      <ol>
        {entries.map((e, i) => (
          <li key={i} className={e.now ? "now" : undefined}>
            <span className="muted">{e.at ? when(e.at) : ""}</span> {e.text}
            {e.cond && <span className="muted"> · {e.cond}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
