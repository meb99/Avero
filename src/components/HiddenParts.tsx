import type { BoardModel } from "../core/board";
import { HIDE_GROUPS, partsInGroup } from "../core/hideGroups";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { hideParts, setHideMode, showParts, type BoardNotes } from "../workbench/notes";

/**
 * Parts out of the way: what is hidden (each one back with a click, or all),
 * whether their pads go too, and groups to hide at once.
 */
export function HiddenParts({
  model,
  notes,
  update,
  onSelect,
}: {
  model: BoardModel;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
}) {
  const { t } = useI18n();
  const hidden = notes.hidden?.parts ?? [];
  const key = notes.key;
  const change = (f: (n: BoardNotes) => BoardNotes) => update((n) => (n.key === key ? f(n) : n));
  return (
    <details className="hidden-parts" open={hidden.length > 0 || undefined}>
      <summary>
        {t("hide.title")} <span className="muted">{hidden.length}</span>
      </summary>
      <div className="hidden-groups">
        {HIDE_GROUPS.map((g) => {
          const parts = partsInGroup(model, g).map((i) => model.parts[i].name);
          return (
            <button key={g} className="small" disabled={parts.length === 0} title={t(`hide.group.${g}Hint`)} onClick={() => change((n) => hideParts(n, parts))}>
              {t(`hide.group.${g}`, { n: parts.length })}
            </button>
          );
        })}
      </div>
      {hidden.length > 0 && (
        <>
          <div className="hidden-mode">
            <label>
              <input type="radio" checked={notes.hidden?.mode !== "all"} onChange={() => change((n) => setHideMode(n, "body"))} /> {t("hide.modeBody")}
            </label>
            <label>
              <input type="radio" checked={notes.hidden?.mode === "all"} onChange={() => change((n) => setHideMode(n, "all"))} /> {t("hide.modeAll")}
            </label>
            <button className="small" onClick={() => change((n) => showParts(n))}>
              {t("hide.showAll")}
            </button>
          </div>
          <ul className="hidden-list">
            {hidden.slice(0, 300).map((name) => {
              const i = model.findPart(name);
              return (
                <li key={name}>
                  <button className="link mono" disabled={i === undefined} onClick={() => i !== undefined && onSelect({ kind: "part", part: i }, true)}>
                    {name}
                  </button>
                  <button className="link" onClick={() => change((n) => showParts(n, [name]))}>
                    {t("hide.show")}
                  </button>
                </li>
              );
            })}
          </ul>
          {hidden.length > 300 && <p className="muted">{t("hide.more", { n: hidden.length - 300 })}</p>}
        </>
      )}
    </details>
  );
}
