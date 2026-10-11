/**
 * The search for component / network, laid out like FlexBV's: search, reset and close; parts
 * and/or nets; anywhere, at the start or the whole name; two entries side by side, each with
 * its hits as you type. A click shows a hit and keeps the dialog open; Enter takes the first
 * hit and closes it. The second entry adds to what the first chose: a part to the parts
 * selected, a net pinned in its own colour.
 */
import { useMemo, useRef, useState } from "react";
import type { BoardModel } from "../core/board";
import { findNames, type SearchMode, type SearchResult } from "../core/search";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialogs";

const KEY = "avero.find.v1";

interface Options {
  parts: boolean;
  nets: boolean;
  mode: SearchMode;
}

/** The options last chosen, kept per Mac (a convenience; may be unavailable). */
function loadOptions(): Options {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { parts: true, nets: true, mode: "substring", ...(JSON.parse(raw) as Partial<Options>) };
  } catch {
    // Defaults then.
  }
  return { parts: true, nets: true, mode: "substring" };
}

export function FindDialog({
  model,
  initial,
  onPick,
  onPickSecond,
  onClose,
}: {
  model: BoardModel;
  initial?: string;
  onPick(selection: Selection): void;
  onPickSecond(selection: Selection): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [options, setOptions] = useState<Options>(loadOptions);
  const [queries, setQueries] = useState<[string, string]>([initial ?? "", ""]);
  const firstRef = useRef<HTMLInputElement>(null);
  const change = (next: Options) => {
    setOptions(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not kept then.
    }
  };
  const hits = useMemo(
    () => queries.map((q) => findNames(model, q, { ...options, limit: 300 })) as [SearchResult[], SearchResult[]],
    [model, queries, options],
  );
  const pick = (column: number, hit: SearchResult | undefined) => {
    if (!hit) return;
    if (column === 0) onPick(hit.selection);
    else onPickSecond(hit.selection);
  };
  /** The hit Enter takes: the name typed in full if it is there ("GND", not "AGND"), else the first. */
  const best = (column: 0 | 1) => {
    const q = queries[column].trim().toUpperCase();
    return hits[column].find((h) => h.label.toUpperCase() === q) ?? hits[column][0];
  };
  /** Enter or "Search": the best hit of each filled entry, then the dialog closes. */
  const commit = () => {
    pick(0, best(0));
    pick(1, best(1));
    if (best(0) || best(1)) onClose();
  };
  const reset = () => {
    setQueries(["", ""]);
    firstRef.current?.focus();
  };
  return (
    <Dialog title={t("find.title")} onClose={onClose} className="find-dialog">
      <div className="find-bar">
        <button onClick={commit}>{t("find.search")}</button>
        <button onClick={reset}>{t("find.reset")}</button>
        <button onClick={onClose}>{t("find.close")}</button>
        <span className="muted">{t("find.keys")}</span>
      </div>
      <div className="find-options">
        <label className="check">
          <input type="checkbox" checked={options.parts} onChange={(e) => change({ ...options, parts: e.target.checked })} />
          {t("find.parts")}
        </label>
        <label className="check">
          <input type="checkbox" checked={options.nets} onChange={(e) => change({ ...options, nets: e.target.checked })} />
          {t("find.nets")}
        </label>
        <span>{t("find.mode")}</span>
        {(["substring", "prefix", "strict"] as const).map((mode) => (
          <label className="check" key={mode}>
            <input type="radio" name="find-mode" checked={options.mode === mode} onChange={() => change({ ...options, mode })} />
            {t(`find.mode.${mode}`)}
          </label>
        ))}
      </div>
      <div className="find-columns">
        {([0, 1] as const).map((column) => (
          <div className="find-column" key={column}>
            <label htmlFor={`find-${column}`}>{t("find.entry", { n: column + 1 })}</label>
            <input
              id={`find-${column}`}
              ref={column === 0 ? firstRef : undefined}
              type="search"
              autoFocus={column === 0}
              spellCheck={false}
              autoComplete="off"
              value={queries[column]}
              onChange={(e) => setQueries((q) => (column === 0 ? [e.target.value, q[1]] : [q[0], e.target.value]))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
            />
            <ul className="find-results" aria-label={t("find.entry", { n: column + 1 })}>
              {hits[column].map((hit) => (
                <li key={`${hit.kind}-${hit.label}`}>
                  <button className="find-hit" onClick={() => pick(column, hit)}>
                    <span className="mono">{hit.label}</span>
                    {hit.kind === "pin" && <span className="muted">{hit.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
