import { useMemo } from "react";
import type { BoardModel } from "../core/board";
import { shortCandidates } from "../core/shortFinder";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { activeCase, type BoardNotes } from "../workbench/notes";

const SIZE_NAMES = ["", "01005", "0201", "0402", "0603", "0805", "1206", "1210", "1812+"];

/** A net's readings say it is shorted to ground: almost nothing in diode or resistance mode. */
function looksShorted(notes: BoardNotes | null, net: string): boolean {
  const r = notes ? (activeCase(notes)?.readings[net] ?? undefined) : undefined;
  if (!r) return false;
  const low = (v: number | "OL" | undefined, limit: number) => typeof v === "number" && v < limit;
  return low(r.diode, 0.05) || low(r.resistance, 2);
}

/**
 * Where to look for a short on this net: the parts that can short it to
 * ground, big ceramic capacitors first, with a way to mark them all.
 * Opens by itself when the repair case's reading says "short".
 */
export function ShortFinder({
  model,
  net,
  notes,
  marked,
  onMarkParts,
  onSelect,
}: {
  model: BoardModel;
  net: number;
  notes: BoardNotes | null;
  marked: { parts: number[]; label: string } | null;
  onMarkParts(parts: number[] | null, label?: string): void;
  onSelect(selection: Selection, zoom: boolean): void;
}) {
  const { t } = useI18n();
  const candidates = useMemo(() => shortCandidates(model, net), [model, net]);
  if (candidates.length === 0) return null;
  const name = model.nets[net].name;
  const shorted = looksShorted(notes, name);
  const key = `short:${name}`;
  const on = marked?.label === key;
  return (
    <details className={`short-finder${shorted ? " shorted" : ""}`} open={shorted || undefined}>
      <summary>
        {shorted ? t("short.titleShorted") : t("short.title")} <span className="muted">{candidates.length}</span>
      </summary>
      <p className="muted short-hint">{t("short.hint")}</p>
      <button className={`small${on ? " on" : ""}`} onClick={() => onMarkParts(on ? null : candidates.map((c) => c.part), key)}>
        {on ? t("short.unmark") : t("short.mark", { n: candidates.length })}
      </button>
      <ul className="short-list">
        {candidates.slice(0, 60).map((c) => {
          const p = model.parts[c.part];
          return (
            <li key={c.part}>
              <button className="link part-name" onClick={() => onSelect({ kind: "part", part: c.part }, true)}>
                {p.name}
              </button>
              <span className="muted">
                {t(`short.kind.${c.kind}`)}
                {c.size ? ` · ${SIZE_NAMES[c.size]}` : ""} · {t(p.side === "bottom" ? "side.bottom" : "side.top")}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
