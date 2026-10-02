import { useMemo, useState } from "react";
import { ballGrid, probePoints } from "../core/bga";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { formatLength } from "../format";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialogs";

/**
 * A BGA as its ball map: every ball in its net's color, a search that
 * lights up matching nets, and for the chosen ball the places its net can
 * be reached with a probe.
 */
export function BgaView({
  model,
  part,
  units,
  onSelect,
  onClose,
}: {
  model: BoardModel;
  part: number;
  units: "mm" | "mil";
  onSelect(selection: Selection, zoom: boolean): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const grid = useMemo(() => ballGrid(model, part), [model, part]);
  const [query, setQuery] = useState("");
  const [ball, setBall] = useState<number | null>(null);
  const q = query.trim().toUpperCase();
  if (!grid) return null;
  const net = ball !== null ? model.pins[ball].net : undefined;
  const probes = net !== undefined ? probePoints(model, net, part) : [];
  const matches = (pin: number) => {
    const n = model.nets[model.pins[pin].net];
    return q !== "" && n.name.toUpperCase().includes(q);
  };
  const matchCount = q ? [...grid.balls.values()].filter(matches).length : 0;

  return (
    <Dialog title={t("bga.title", { part: model.parts[part].name })} onClose={onClose} className="bga-dialog">
      <div className="bga-bar">
        <input type="search" autoFocus placeholder={t("bga.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {q && <span className="muted">{t("bga.matches", { n: matchCount })}</span>}
        <span className="muted bga-legend">
          <span className="bga-ball kind-power" /> {t("bga.power")} <span className="bga-ball kind-ground" /> {t("bga.ground")} <span className="bga-ball kind-signal" /> {t("bga.signal")}{" "}
          <span className="bga-ball kind-unconnected" /> {t("bga.nc")}
        </span>
      </div>
      <div className="bga-body">
        <div className="bga-grid" style={{ gridTemplateColumns: `24px repeat(${grid.cols}, minmax(14px, 1fr))` }}>
          <span />
          {Array.from({ length: grid.cols }, (_, c) => (
            <span key={c} className="bga-head">
              {c + 1}
            </span>
          ))}
          {grid.rows.map((row) => (
            <div key={row} className="bga-row">
              <span className="bga-head">{row}</span>
              {Array.from({ length: grid.cols }, (_, c) => {
                const pin = grid.balls.get(`${row}|${c + 1}`);
                if (pin === undefined) return <span key={c} className="bga-empty" />;
                const n = model.nets[model.pins[pin].net];
                const on = (net !== undefined && model.pins[pin].net === net) || matches(pin);
                return (
                  <button
                    key={c}
                    className={`bga-ball kind-${n.kind}${on ? " on" : ""}${pin === ball ? " chosen" : ""}`}
                    title={`${row}${c + 1} · ${n.name}`}
                    onClick={() => {
                      setBall(pin);
                      onSelect({ kind: "pin", pin }, false);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <aside className="bga-side">
          {ball === null || net === undefined ? (
            <p className="muted">{t("bga.pick")}</p>
          ) : (
            <>
              <h3>
                {model.parts[part].name}.{model.pins[ball].number}
              </h3>
              <p>
                <button className={`link net-chip kind-${model.nets[net].kind}`} onClick={() => onSelect({ kind: "net", net }, true)}>
                  {model.nets[net].name}
                </button>
              </p>
              <p className="muted">{t("bga.netBalls", { n: [...grid.balls.values()].filter((p) => model.pins[p].net === net).length })}</p>
              <h3>{t("bga.probes")}</h3>
              {probes.length === 0 ? (
                <p className="muted">{t("bga.noProbes")}</p>
              ) : (
                <ul className="bga-probes">
                  {probes.map((p) => (
                    <li key={`${p.kind}${p.index}`}>
                      <button
                        className="link mono"
                        onClick={() => onSelect(p.kind === "part" ? { kind: "part", part: p.index } : { kind: "testPoint", testPoint: p.index }, true)}
                      >
                        {p.name}
                      </button>{" "}
                      <span className="muted">{formatLength(p.distance, units)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </Dialog>
  );
}
