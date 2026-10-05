import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { compare, condOf, conditionsFit, formatValue, parseValue, QUANTITIES, type HistoryEntry, type Quantity, type Reading, type Value } from "../workbench/measure";
import { conditionsText } from "./Conditions";
import {
  activeCase,
  addCase,
  clearHistory,
  clearPointHistory,
  pointsOnNet,
  setPointValue,
  setReading,
  setValue,
  spread,
  type BoardNotes,
  type Target,
} from "../workbench/notes";
import { METER_VALUE_EVENT, readMeter, useMeter } from "../workbench/meter";

interface Props {
  net: string;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  tolerance: number;
  /** Heading instead of "Readings" (e.g. "Net PP3V3" under a measuring point). */
  title?: string;
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
  bind,
}: {
  value: Value | undefined;
  quantity: Quantity;
  onChange(v: Value | undefined): void;
  status?: "ok" | "deviation" | "mismatch";
  label: string;
  /** What the field stands for (board, target, net, quantity): a reading that arrives late goes there, not to whatever the field shows by then. */
  bind?: string;
}) {
  const { t, lang } = useI18n();
  const shown = formatValue(value, quantity, lang);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const editing = useRef(false);
  // Escape: the blur that follows must not save what was typed.
  const cancelled = useRef(false);
  const bindRef = useRef(bind);
  bindRef.current = bind;
  const inputRef = useRef<HTMLInputElement>(null);
  const meter = useMeter();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // A reading from the multimeter (button here, or the pedal while focused).
  const take = (v: Value) => {
    editing.current = false;
    setInvalid(false);
    setText(formatValue(v, quantity, lang));
    onChangeRef.current(v);
  };
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const listener = (e: Event) => take((e as CustomEvent<Value>).detail);
    el.addEventListener(METER_VALUE_EVENT, listener);
    return () => el.removeEventListener(METER_VALUE_EVENT, listener);
  });

  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);

  const commit = () => {
    editing.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      setInvalid(false);
      setText(shown);
      return;
    }
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

  const input = (
    <input
      ref={inputRef}
      data-quantity={quantity}
      className={`value-input${invalid ? " invalid" : ""}${status ? ` status-${status}` : ""}`}
      value={text}
      aria-label={label}
      aria-invalid={invalid}
      data-bind={bind}
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
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
  if (!meter.connected) return input;
  return (
    <span className="value-with-meter">
      {input}
      <button
        className="tool icon-only meter-take"
        disabled={meter.busy}
        title={t("meter.take")}
        aria-label={`${label}: ${t("meter.take")}`}
        onClick={() => {
          // The reading belongs to the field as it was when asked for.
          const to = onChangeRef.current;
          const asked = bindRef.current;
          void readMeter(quantity).then(
            (v) => (bindRef.current === asked ? take(v) : to(v)),
            () => {},
          );
        }}
      >
        ⇣
      </button>
    </span>
  );
}

/** Reference and repair-case readings for one net, in the details panel. */
export function MeasureBlock({ net, notes, update, tolerance, title }: Props) {
  const { t, lang } = useI18n();
  const current = activeCase(notes);
  const ref = notes.reference[net];
  const mine = current?.readings[net];
  const target: Target | null = current ? { caseId: current.id } : null;
  const noteTarget: Target = target ?? "reference";
  const note = (target ? mine?.note : ref?.note) ?? "";
  const [noteText, setNoteText] = useState(note);
  useEffect(() => setNoteText(note), [note, net]);
  // Changes go to this board only, even when they land after a switch.
  const key = notes.key;
  const change = (f: (n: BoardNotes) => BoardNotes) => update((n) => (n.key === key ? f(n) : n));
  const bindOf = (to: Target, q: Quantity) => `${key}|${to === "reference" ? "ref" : to.caseId}|${net}|${q}`;

  return (
    <section className="details-section measure">
      <h3>{title ?? t("measure.title")}</h3>
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
                  bind={bindOf("reference", q)}
                  onChange={(v) => change((n) => setValue(n, "reference", net, q, v))}
                />
              </td>
              {target && current && (
                <td>
                  <ValueInput
                    value={mine?.[q]}
                    quantity={q}
                    label={`${t(LABEL[q])} · ${current.title}`}
                    bind={bindOf(target, q)}
                    status={
                      ref?.[q] !== undefined && mine?.[q] !== undefined && !conditionsFit(condOf(ref, q), condOf(mine, q), q)
                        ? "mismatch"
                        : compare(ref?.[q], mine?.[q], q, tolerance)
                    }
                    onChange={(v) => change((n) => setValue(n, target, net, q, v))}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {(conditionsLine(ref, t) || (current && conditionsLine(mine, t))) && (
        <p className="muted measure-cond">
          {conditionsLine(ref, t) && (
            <span>
              {t("measure.reference")}: {conditionsLine(ref, t)}
            </span>
          )}
          {current && conditionsLine(mine, t) && (
            <span>
              {current.title}: {conditionsLine(mine, t)}
            </span>
          )}
        </p>
      )}
      <History reading={ref} title={t("measure.reference")} lang={lang} onClear={() => change((n) => clearHistory(n, "reference", net))} />
      {current && target && <History reading={mine} title={current.title} lang={lang} onClear={() => change((n) => clearHistory(n, target, net))} />}
      <input
        className="note-input"
        placeholder={t("measure.note")}
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        onBlur={() => {
          if (noteText !== note) change((n) => setReading(n, noteTarget, net, { note: noteText || undefined }));
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

/**
 * Readings at one point (a pin, test point or via): its own values next to
 * the net's. Without a point reference the net's reference is compared,
 * marked as such.
 */
export function PointMeasureBlock({
  point,
  label,
  net,
  notes,
  update,
  tolerance,
}: {
  point: string;
  label: string;
  net: string;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  tolerance: number;
}) {
  const { t, lang } = useI18n();
  const current = activeCase(notes);
  const ref = notes.referencePoints?.[point];
  const netRef = notes.reference[net];
  const mine = current?.points?.[point];
  const target: Target | null = current ? { caseId: current.id } : null;
  const key = notes.key;
  const change = (f: (n: BoardNotes) => BoardNotes) => update((n) => (n.key === key ? f(n) : n));
  const bindOf = (to: Target, q: Quantity) => `${key}|${to === "reference" ? "ref" : to.caseId}|@${point}|${q}`;
  return (
    <section className="details-section measure measure-point">
      <h3 title={t("point.hint")}>
        {t("point.title")} <span className="mono">{label}</span>
      </h3>
      <table className="measure-table">
        <thead>
          <tr>
            <th />
            <th title={t("measure.referenceHint")}>{t("measure.reference")}</th>
            {current && <th>{current.title}</th>}
          </tr>
        </thead>
        <tbody>
          {QUANTITIES.map((q) => {
            // The point's own reference, else the net's (shown as such).
            const usedRef = ref?.[q] !== undefined ? ref : netRef;
            const fromNet = ref?.[q] === undefined && netRef?.[q] !== undefined;
            return (
              <tr key={q}>
                <th scope="row">{t(LABEL[q])}</th>
                <td>
                  <ValueInput
                    value={ref?.[q]}
                    quantity={q}
                    label={`${t(LABEL[q])} · ${label} · ${t("measure.reference")}`}
                    bind={bindOf("reference", q)}
                    onChange={(v) => change((n) => setPointValue(n, "reference", point, net, q, v))}
                  />
                  {fromNet && (
                    <span className="muted point-net-ref" title={t("point.netRefHint")}>
                      {" "}
                      {t("point.netRef", { value: formatValue(netRef?.[q], q, lang) })}
                    </span>
                  )}
                </td>
                {target && current && (
                  <td>
                    <ValueInput
                      value={mine?.[q]}
                      quantity={q}
                      label={`${t(LABEL[q])} · ${label} · ${current.title}`}
                      bind={bindOf(target, q)}
                      status={
                        usedRef?.[q] !== undefined && mine?.[q] !== undefined && !conditionsFit(condOf(usedRef, q), condOf(mine, q), q)
                          ? "mismatch"
                          : compare(usedRef?.[q], mine?.[q], q, tolerance)
                      }
                      onChange={(v) => change((n) => setPointValue(n, target, point, net, q, v))}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {(conditionsLine(ref, t) || (current && conditionsLine(mine, t))) && (
        <p className="muted measure-cond">
          {conditionsLine(ref, t) && (
            <span>
              {t("measure.reference")}: {conditionsLine(ref, t)}
            </span>
          )}
          {current && conditionsLine(mine, t) && (
            <span>
              {current.title}: {conditionsLine(mine, t)}
            </span>
          )}
        </p>
      )}
      <History reading={ref} title={`${label} · ${t("measure.reference")}`} lang={lang} onClear={() => change((n) => clearPointHistory(n, "reference", point))} />
      {current && target && (
        <History reading={mine} title={`${label} · ${current.title}`} lang={lang} onClear={() => change((n) => clearPointHistory(n, target, point))} />
      )}
    </section>
  );
}

/** The points measured on a net: each with its values, and the spread over them. */
export function NetPoints({
  net,
  notes,
  labelOf,
  onPoint,
}: {
  net: string;
  notes: BoardNotes;
  labelOf(id: string): string;
  onPoint(id: string): void;
}) {
  const { t, lang } = useI18n();
  const current = activeCase(notes);
  const target: Target = current ? { caseId: current.id } : "reference";
  const points = pointsOnNet(notes, target, net);
  if (points.length === 0) return null;
  const readings = points.map(([, r]) => r);
  return (
    <section className="details-section net-points">
      <h3 title={t("point.netHint")}>
        {t("point.onNet", { n: points.length })} <span className="muted">{current?.title ?? t("measure.reference")}</span>
      </h3>
      <ul className="net-points-list">
        {points
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([id, r]) => (
            <li key={id}>
              <button className="link mono" onClick={() => onPoint(id)}>
                {labelOf(id)}
              </button>{" "}
              <span className="muted">
                {QUANTITIES.filter((q) => r[q] !== undefined)
                  .map((q) => `${SHORT[q]} ${formatValue(r[q], q, lang)}`)
                  .join(" · ")}
              </span>
            </li>
          ))}
      </ul>
      <p className="muted point-spread">
        {QUANTITIES.flatMap((q) => {
          const s = spread(readings, q);
          if (!s) return [];
          const range = s.count === 0 ? "" : s.min === s.max ? formatValue(s.min, q, lang) : `${formatValue(s.min, q, lang)} – ${formatValue(s.max, q, lang)}`;
          const open = s.open ? t("point.open", { n: s.open }) : "";
          return [`${SHORT[q]}: ${[range, open].filter(Boolean).join(", ")} (${t("point.count", { n: s.count + s.open })})`];
        }).join(" · ")}
      </p>
    </section>
  );
}

const SHORT: Record<Quantity, string> = { diode: "D", voltage: "U", resistance: "R" };

/** Conditions and origin of each value: "D aus · rot an Masse; U an (aus Fall 2)". */
function conditionsLine(r: Reading | undefined, t: ReturnType<typeof useI18n>["t"]): string {
  if (!r) return "";
  const parts: string[] = [];
  for (const q of QUANTITIES) {
    if (r[q] === undefined) continue;
    const cond = conditionsText(condOf(r, q), t);
    const origin = r.origin?.[q];
    if (!cond && !origin) continue;
    parts.push(`${SHORT[q]} ${[cond, origin && t("measure.origin", { from: origin })].filter(Boolean).join(" ")}`);
  }
  return parts.join("; ");
}

/** Earlier values of a reading, newest first, with the current one on top: before and after a repair. */
function History({ reading, title, lang, onClear }: { reading: Reading | undefined; title: string; lang: string; onClear(): void }) {
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
    ...(QUANTITIES.some((q) => reading[q] !== undefined) ? [{ at: reading.updated, text: values(reading), cond: conditionsLine(reading, t), now: true }] : []),
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
      <button className="link danger-link" onClick={onClear}>
        {t("measure.clearHistory")}
      </button>
    </details>
  );
}
