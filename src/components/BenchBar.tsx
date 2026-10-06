import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardModel } from "../core/board";
import { findPoint } from "../core/points";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { formatValue, parseValue, type Quantity, type Value } from "../workbench/measure";
import { looksOpen, movedFrom, readMeter, readStable, useMeter } from "../workbench/meter";
import { activeCase, judgeTaken, listProgress, setPointValue, setValue, type BoardNotes, type ListItem, type Target } from "../workbench/notes";

/** Speaks with a voice of this Mac only (never a voice that goes online); false when there is none. */
export function speakLocal(text: string, lang: string): boolean {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth) return false;
  const voices = synth.getVoices().filter((v) => v.localService);
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase())) ?? voices[0];
  if (!voice) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  synth.speak(u);
  return true;
}

export interface BenchHandle {
  commit(): void;
  skip(): void;
  repeat(): void;
}

interface Props {
  model: BoardModel;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  undo(): void;
  tolerance: number;
  onSelect(selection: Selection): void;
  onClose(): void;
  /** Set to the bar's actions, for the pedal and keys. */
  handle?: { current: BenchHandle | null };
}

/**
 * The bench mode: the measuring list's next point large, a big field or the
 * meter to take its value, and skip, repeat and undo – all with the same
 * pedal or keys. Manual or automatic taking is switched visibly; a meter
 * value is only taken once the display has settled. On request the point
 * and the result are read out with a voice of this Mac.
 *
 * A meter reading is saved only for the point, case and run it was started
 * for: switching automatic off, moving on or changing the case while the
 * meter is read throws the reading away. After a meter value is taken, the
 * automatic waits for the display to leave it (the probe lifted) before it
 * takes anything for the next point, and it never takes "no contact" (OL,
 * about 0 V) on its own – that needs the pedal.
 */
export function BenchBar({ model, notes, update, undo, tolerance, onSelect, onClose, handle }: Props) {
  const { t, lang } = useI18n();
  const meter = useMeter();
  const lists = notes.lists ?? [];
  const list = lists.find((l) => l.id === notes.activeList) ?? lists[0];
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [repeatAt, setRepeatAt] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [voice, setVoice] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // The value just taken and how it compares, kept while the next point is shown.
  const [last, setLast] = useState<{ label: string; text: string; verdict?: string } | null>(null);
  const progress = list ? listProgress(notes, list) : null;
  const index = useMemo(() => {
    if (!list || !progress) return -1;
    if (repeatAt !== null) return repeatAt;
    return progress.done.findIndex((d, i) => !d && !skipped.has(i));
  }, [list, progress, skipped, repeatAt]);
  const item: ListItem | undefined = list && index >= 0 ? list.items[index] : undefined;
  const c = activeCase(notes);
  const target: Target = c ? { caseId: c.id } : "reference";
  const label = item ? (item.label ?? item.point ?? item.net) : "";
  // What a reading started now belongs to; checked again when it comes back.
  const pointKey = item && list ? `${list.id}|${index}|${item.point ?? ""}|${item.net}|${item.quantity}|${c?.id ?? "reference"}` : "";
  const live = useRef({ key: pointKey, auto });
  live.current = { key: pointKey, auto };
  // The meter value taken last: the next point waits until the display has left it.
  const lastTaken = useRef<{ value: Value; quantity: Quantity } | null>(null);
  // The manual reading under way, stopped when the point, the case or the bar goes.
  const manual = useRef<AbortController | null>(null);
  useEffect(() => () => manual.current?.abort(), [pointKey]);

  // Arriving at a point: show it on the board, and say it.
  useEffect(() => {
    if (!item) return;
    const net = model.findNet(item.net);
    const at = item.point ? findPoint(model, item.point) : net !== undefined ? ({ kind: "net", net } as const) : undefined;
    if (at) onSelect(at);
    setText("");
    setMessage(null);
    if (voice && !speakLocal(`${label}. ${t(`measure.${item.quantity}`)}`, lang)) setMessage(t("bench.noVoice"));
    // The point is what matters, not each render's copies.
  }, [list?.id, index]);

  const save = (value: Value) => {
    if (!item || !list) return;
    update((n) => (item.point ? setPointValue(n, target, item.point, item.net, item.quantity, value) : setValue(n, target, item.net, item.quantity, value)));
    // How it compares – under the conditions it is saved with, for the display and the voice.
    const verdict = judgeTaken(notes, target, t("measure.reference"), item.net, item.quantity, value, tolerance, item.point);
    const word = verdict === "ok" ? t("bench.ok") : verdict === "deviation" ? t("bench.deviation") : verdict === "mismatch" ? t("measure.status.mismatch") : "";
    const said = `${formatValue(value, item.quantity, lang)}${word ? `, ${word}` : ""}`;
    if (voice) speakLocal(said, lang);
    setLast({ label, text: formatValue(value, item.quantity, lang), ...(verdict && { verdict }) });
    setRepeatAt(null);
    setMessage(null);
  };

  /** Taken by hand (pedal, Enter): a settled reading, saved if the point is still the one it was read for. */
  const measure = async (q: Quantity) => {
    if (!meter.connected) return setMessage(t("bench.noMeter"));
    manual.current?.abort();
    const ctl = new AbortController();
    manual.current = ctl;
    const key = pointKey;
    const { value, stable, aborted } = await readStable(q, 10, 250, ctl.signal);
    if (aborted || ctl.signal.aborted || live.current.key !== key) return setMessage(t("bench.discarded"));
    if (!stable) {
      setMessage(t("meter.unstable"));
      if (voice) speakLocal(t("meter.unstable"), lang);
      return;
    }
    lastTaken.current = { value, quantity: q };
    save(value);
  };

  const actions: BenchHandle = {
    commit: () => {
      if (!item) return;
      const parsed = text.trim() ? parseValue(text, item.quantity) : null;
      if (parsed !== null && parsed !== undefined) return save(parsed);
      void measure(item.quantity);
    },
    skip: () => {
      if (index < 0) return;
      setSkipped((s) => new Set(s).add(index));
      setRepeatAt(null);
    },
    repeat: () => {
      if (!progress) return;
      // The last point done before this one, to measure it again.
      const before = index < 0 ? progress.done.length : index;
      for (let i = before - 1; i >= 0; i--) if (progress.done[i]) return setRepeatAt(i);
    },
  };
  if (handle) handle.current = actions;

  // Automatic: first the display has to leave the value taken last (the probe lifted and put on
  // the next point), then a settled reading that is not "no contact" is taken. One run per point;
  // a run ends when automatic goes off, the point or case changes or the bar closes, and a run
  // waits for the one before so the meter is never asked twice at once.
  const previousRun = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!auto || !item || !meter.connected) return;
    const ctl = new AbortController();
    const key = pointKey;
    const q = item.quantity;
    const valid = () => !ctl.signal.aborted && live.current.key === key && live.current.auto;
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const run = previousRun.current.then(async () => {
      try {
        const last = lastTaken.current;
        if (last) {
          setMessage(t("bench.lift"));
          while (valid()) {
            const v = await readMeter(q);
            if (!valid()) return;
            // Another quantity switches the meter; then only "no contact" shows the probe was lifted.
            if (last.quantity === q ? movedFrom(last.value, v, q, tolerance) : looksOpen(v, q)) break;
            await pause(300);
          }
        }
        while (valid()) {
          const { value, stable, aborted } = await readStable(q, 10, 250, ctl.signal);
          if (aborted || !valid()) return;
          if (stable && !looksOpen(value, q)) {
            lastTaken.current = { value, quantity: q };
            setMessage(null);
            save(value);
            return;
          }
          setMessage(stable ? t("bench.openHint") : t("meter.unstable"));
          await pause(400);
        }
      } catch {
        // The meter's error shows in its state.
      }
    });
    previousRun.current = run;
    return () => ctl.abort();
  }, [auto, pointKey, meter.connected]);

  if (!list) {
    return (
      <div className="bench-bar">
        <p>{t("bench.noList")}</p>
        <button className="small" onClick={onClose}>
          {t("bench.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="bench-bar" role="region" aria-label={t("bench.title")}>
      <div className="bench-head">
        <strong>{t("bench.title")}</strong>
        <span className="muted">
          {list.title} · {progress!.count}/{list.items.length}
          {c ? ` · ${c.title}` : ` · ${t("measure.reference")}`}
        </span>
        <span className="bench-spacer" />
        <div className="bench-mode" role="group" aria-label={t("bench.mode")}>
          <button className={`small${!auto ? " on" : ""}`} aria-pressed={!auto} onClick={() => setAuto(false)}>
            {t("bench.manual")}
          </button>
          <button className={`small${auto ? " on" : ""}`} aria-pressed={auto} disabled={!meter.connected} title={meter.connected ? t("bench.autoHint") : t("bench.noMeter")} onClick={() => setAuto(true)}>
            {t("bench.auto")}
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> {t("bench.voice")}
        </label>
        <button className="tool icon-only" onClick={onClose} aria-label={t("bench.close")} title={t("bench.close")}>
          ×
        </button>
      </div>
      {item ? (
        <div className="bench-main">
          <div className="bench-point">
            <span className="bench-label">{label}</span>
            <span className="bench-q">{t(`measure.${item.quantity}`)}</span>
            {repeatAt !== null && <span className="src-tag">{t("bench.again")}</span>}
          </div>
          <input
            className="bench-input"
            value={text}
            inputMode="decimal"
            placeholder={meter.connected ? t("bench.placeholderMeter") : t("bench.placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                actions.commit();
              }
            }}
          />
          <button className="bench-button primary" onClick={actions.commit}>
            {text.trim() || !meter.connected ? t("bench.take") : t("bench.measure")}
          </button>
          <button className="bench-button" onClick={actions.skip}>
            {t("bench.skip")}
          </button>
          <button className="bench-button" onClick={actions.repeat}>
            {t("bench.repeat")}
          </button>
          <button className="bench-button" onClick={undo}>
            {t("bench.undo")}
          </button>
        </div>
      ) : (
        <div className="bench-main">
          <span>{t("lists.allDone", { title: list.title })}</span>
          {skipped.size > 0 && (
            <button className="bench-button" onClick={() => setSkipped(new Set())}>
              {t("bench.skippedBack", { n: skipped.size })}
            </button>
          )}
        </div>
      )}
      {last && (
        <p className={`bench-message bench-last status-${last.verdict ?? "measured"}`}>
          {t("bench.last", { label: last.label, value: last.text })}
          {last.verdict === "ok" && ` ✓ ${t("bench.ok")}`}
          {last.verdict === "deviation" && ` ✗ ${t("bench.deviation")}`}
          {last.verdict === "mismatch" && ` ≠ ${t("measure.status.mismatch")}`}
        </p>
      )}
      {message && <p className="bench-message">{message}</p>}
    </div>
  );
}
