import type { BoardModel } from "../core/board";
import { useI18n } from "../i18n";
import { layerColor, type Palette } from "../render/palette";

interface Props {
  model: BoardModel;
  palette: Palette;
  hidden: ReadonlySet<number>;
  onChange(hidden: ReadonlySet<number>): void;
}

/** Trace layers with their colors, each switchable on its own. */
export function LayerList({ model, palette, hidden, onChange }: Props) {
  const { t } = useI18n();
  const layers = model.layers;
  const counts = new Array<number>(layers.length).fill(0);
  for (const tr of model.traces) counts[tr.layer]++;
  const toggle = (i: number) => {
    const next = new Set(hidden);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onChange(next);
  };
  const only = (side: "top" | "bottom" | "both") =>
    onChange(new Set(layers.flatMap((l, i) => (l.side === side ? [] : [i]))));

  return (
    <div className="layer-list">
      <div className="layer-actions">
        <button className="small" onClick={() => onChange(new Set())}>
          {t("layers.all")}
        </button>
        <button className="small" onClick={() => onChange(new Set(layers.keys()))}>
          {t("layers.none")}
        </button>
        <button className="small" onClick={() => only("top")}>
          {t("layers.onlyTop")}
        </button>
        <button className="small" onClick={() => only("bottom")}>
          {t("layers.onlyBottom")}
        </button>
      </div>
      <ul>
        {layers.map((l, i) => {
          const [r, g, b] = layerColor(palette, layers, i);
          const number = /(\d+)$/.exec(l.name)?.[1];
          return (
            <li key={l.name}>
              <label className="layer-row">
                <input type="checkbox" checked={!hidden.has(i)} onChange={() => toggle(i)} />
                <span className="layer-swatch" style={{ background: `rgb(${r} ${g} ${b})` }} />
                <span className="layer-name">{number ? t("layers.numbered", { n: number }) : l.name}</span>
                <span className="muted">{t(`layers.side.${l.side}`)}</span>
                <span className="list-meta">{counts[i]}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="muted layer-hint">{t("layers.hint")}</p>
    </div>
  );
}
