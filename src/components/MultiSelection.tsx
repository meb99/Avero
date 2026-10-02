import { useMemo, useState } from "react";
import type { BoardModel } from "../core/board";
import { sharedNets } from "../core/multi";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";

/** Several parts chosen with ⌘/Shift-click: the nets they have in common. */
export function MultiSelection({
  model,
  parts,
  onSelect,
  onRemove,
  onClear,
}: {
  model: BoardModel;
  parts: readonly number[];
  onSelect(selection: Selection, zoom: boolean): void;
  onRemove(part: number): void;
  onClear(): void;
}) {
  const { t } = useI18n();
  const [withGround, setWithGround] = useState(false);
  const shared = useMemo(() => sharedNets(model, parts, withGround), [model, parts, withGround]);
  return (
    <section className="details-section multi-selection">
      <div className="wb-row wb-head">
        <h3>{t("multi.title", { n: parts.length })}</h3>
        <button className="small" onClick={onClear}>
          {t("multi.clear")}
        </button>
      </div>
      <div className="multi-parts">
        {parts.map((p) => (
          <span key={p} className="multi-chip">
            <button className="link mono" onClick={() => onSelect({ kind: "part", part: p }, true)}>
              {model.parts[p].name}
            </button>
            <button className="tool icon-only" onClick={() => onRemove(p)} aria-label={t("multi.remove")} title={t("multi.remove")}>
              ×
            </button>
          </span>
        ))}
      </div>
      <label className="check small-check">
        <input type="checkbox" checked={withGround} onChange={(e) => setWithGround(e.target.checked)} />
        {t("multi.withGround")}
      </label>
      <h3>
        {t("multi.shared")} <span className="muted">{shared.length}</span>
      </h3>
      {shared.length === 0 ? (
        <p className="muted">{t("multi.none")}</p>
      ) : (
        <table className="wb-table multi-table">
          <tbody>
            {shared.map((s) => (
              <tr key={s.net} onClick={() => onSelect({ kind: "net", net: s.net }, false)}>
                <td>
                  <span className={`net-chip kind-${model.nets[s.net].kind}`}>{model.nets[s.net].name}</span>
                </td>
                <td className="muted">{t("multi.count", { n: s.parts.length, m: parts.length })}</td>
                <td className="muted mono">{s.parts.map((p) => model.parts[p].name).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
