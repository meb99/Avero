import { useMemo, useState } from "react";
import { ballGrid, ballPitch, ballPlaces, cornerBall, missingBalls, probePoints, type BallView } from "../core/bga";
import type { BoardModel } from "../core/board";
import { saveBytes } from "../core/loader";
import { pinKey } from "../core/points";
import type { Selection } from "../core/types";
import { formatLength } from "../format";
import { useI18n } from "../i18n";
import { bgaTemplateSvg, templateBlocked } from "../workbench/bgaTemplate";
import { formatValue, QUANTITIES, type Reading } from "../workbench/measure";
import { activeCase, PAD_DAMAGE, setPadDamage, type BoardNotes, type PadDamage } from "../workbench/notes";
import { Dialog } from "./Dialogs";

/**
 * A BGA as its ball map (F42): every ball in its net's colour, seen as the datasheet draws
 * it from the top or from below, or where it lies on the board; A1 marked in every view and
 * turn; pads left out by the design apart from pads damaged in the repair case; the values
 * measured on the balls; and for the chosen ball the places its net can be reached with a probe.
 */
export function BgaView({
  model,
  part,
  units,
  notes,
  update,
  onSelect,
  onClose,
}: {
  model: BoardModel;
  part: number;
  units: "mm" | "mil";
  notes?: BoardNotes | null;
  update?(f: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
  onClose(): void;
}) {
  const { t, lang } = useI18n();
  const grid = useMemo(() => ballGrid(model, part), [model, part]);
  const pitch = useMemo(() => (grid ? ballPitch(model, grid) : null), [model, grid]);
  const [query, setQuery] = useState("");
  const [ball, setBall] = useState<number | null>(null);
  const [view, setView] = useState<BallView>("top");
  const [turns, setTurns] = useState(0);
  const [tab, setTab] = useState<"probes" | "values">("probes");
  const [tool, setTool] = useState<PadDamage | "clear" | "">("");
  const q = query.trim().toUpperCase();
  if (!grid) return null;
  const p = model.parts[part];
  const repair = notes ? activeCase(notes) : undefined;
  const damage = repair?.padDamage ?? {};
  const a1 = cornerBall(grid);
  const gaps = missingBalls(grid);
  const places = ballPlaces(model, grid, view, turns);
  const step = view === "board" ? Math.max(pitch?.col ?? 40, 1) : 1;
  const r = view === "board" ? step * 0.36 : 0.36;
  const xs = places.map((b) => b.x);
  const ys = places.map((b) => b.y);
  // Room around the balls for the A1 corner mark and its name.
  const pad = step * 2.2;
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  const net = ball !== null ? model.pins[ball].net : undefined;
  const probes = net !== undefined ? probePoints(model, net, part) : [];
  const matches = (pin: number) => q !== "" && model.nets[model.pins[pin].net].name.toUpperCase().includes(q);
  const matchCount = q ? [...grid.balls.values()].filter(matches).length : 0;
  const lit = (pin: number) => (net !== undefined && model.pins[pin].net === net) || matches(pin);
  const anyLit = net !== undefined || q !== "";

  const valueText = (r?: Reading) =>
    r
      ? QUANTITIES.flatMap((qq) => (r[qq] !== undefined ? [formatValue(r[qq], qq, lang)] : [])).join(" · ")
      : "";
  const valuesOf = (pin: number) => {
    const key = pinKey(model, pin);
    const name = model.nets[model.pins[pin].net].name;
    return {
      key,
      ref: valueText(notes?.referencePoints?.[key]) || valueText(notes?.reference[name]),
      now: valueText(repair?.points?.[key]) || valueText(repair?.readings[name]),
    };
  };

  const a1Place = places.find((b) => b.pin === a1);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const corner = a1Place && {
    x: a1Place.x + (a1Place.x < cx ? -1 : 1) * step * 0.95,
    y: a1Place.y + (a1Place.y < cy ? -1 : 1) * step * 0.95,
    dx: a1Place.x < cx ? 1 : -1,
    dy: a1Place.y < cy ? 1 : -1,
  };

  const direction =
    view === "top" ? t("bga.view.topHint") : view === "bottom" ? t("bga.view.bottomHint") : t(p.side === "bottom" ? "bga.view.boardBottomHint" : "bga.view.boardTopHint");
  const blocked = templateBlocked(model, part, grid);
  const printTemplate = async () => {
    const pitchMm = pitch ? `${((pitch.col * 25.4) / 1000).toFixed(2)} × ${((pitch.row * 25.4) / 1000).toFixed(2)} mm` : "";
    const svg = bgaTemplateSvg(model, grid, view === "bottom", turns, {
      title: `${p.name}${p.device ? ` · ${p.device}` : ""}`,
      direction: view === "bottom" ? t("bga.template.fromBelow") : t(p.side === "bottom" ? "bga.template.boardBottom" : "bga.template.boardTop"),
      pitch: t("bga.template.pitch", { pitch: pitchMm, n: grid.balls.size }),
      scale: t("bga.template.scale"),
      check: t("bga.template.check"),
    });
    await saveBytes(new TextEncoder().encode(svg), t("bga.template.save"), `${p.name}-${view === "bottom" ? "balls" : "pads"}-1zu1.svg`, { name: "SVG", extensions: ["svg"] });
  };

  const pick = (pin: number) => {
    if (tool && repair && update) {
      const key = pinKey(model, pin);
      update((n) => setPadDamage(n, repair.id, key, tool === "clear" ? null : tool));
    }
    setBall(pin);
    onSelect({ kind: "pin", pin }, false);
  };

  const damaged = Object.keys(damage).length;
  const valueRows = [...grid.balls.values()]
    .map((pin) => ({ pin, ...valuesOf(pin), damage: damage[pinKey(model, pin)] }))
    .filter((row) => row.ref || row.now || row.damage);

  return (
    <Dialog title={t("bga.title", { part: p.name })} onClose={onClose} className="bga-dialog">
      <div className="bga-bar">
        <input type="search" autoFocus placeholder={t("bga.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        {q && <span className="muted">{t("bga.matches", { n: matchCount })}</span>}
        <div className="segmented small-seg" role="group" aria-label={t("bga.view.title")}>
          {(["top", "bottom", "board"] as const).map((v) => (
            <button key={v} className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
              {t(`bga.view.${v}`)}
            </button>
          ))}
        </div>
        <button className="small" onClick={() => setTurns((n) => (n + 1) % 4)} title={t("bga.turnHint")}>
          ⟳ {turns * 90}°
        </button>
        <select value={tool} disabled={!repair || !update} title={repair ? t("bga.damage.hint") : t("bga.damage.noCase")} onChange={(e) => setTool(e.target.value as PadDamage | "clear" | "")}>
          <option value="">{t("bga.damage.off")}</option>
          {PAD_DAMAGE.map((d) => (
            <option key={d} value={d}>
              {t(`bga.damage.${d}`)}
            </option>
          ))}
          <option value="clear">{t("bga.damage.clear")}</option>
        </select>
        <button className="small" disabled={blocked !== null} title={blocked ? t(`bga.template.blocked.${blocked}`) : t("bga.template.hint")} onClick={() => void printTemplate()}>
          {t("bga.template.button")}
        </button>
      </div>
      <p className="bga-facts muted">
        {t("bga.facts", { rows: grid.rows.length, cols: grid.cols, n: grid.balls.size })}
        {pitch && (
          <>
            {" · "}
            {t("bga.pitch", { pitch: formatLength(pitch.col, units) })}{" "}
            <span className="src-tag" title={t(pitch.consistent ? "bga.pitchFileHint" : "bga.pitchUnevenHint")}>
              {t(pitch.consistent ? "bga.pitchFile" : "bga.pitchUneven")}
            </span>
          </>
        )}
        {gaps.length > 0 && ` · ${t("bga.gaps", { n: gaps.length })}`}
        {damaged > 0 && ` · ${t("bga.damaged", { n: damaged })}`}
        {" · "}
        <strong>{direction}</strong>
      </p>
      <div className="bga-body">
        <div className="bga-map">
          <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" className={anyLit ? "lit" : undefined}>
            {places.map((b) => {
              if (b.pin < 0)
                return (
                  <circle key={`gap${b.row}${b.col}`} cx={b.x} cy={b.y} r={r * 0.7} className="bga-gap">
                    <title>{t("bga.gapTitle", { ball: `${b.row}${b.col}` })}</title>
                  </circle>
                );
              const n = model.nets[model.pins[b.pin].net];
              const dmg = damage[pinKey(model, b.pin)];
              return (
                <g key={b.pin} className={`bga-dot kind-${n.kind}${lit(b.pin) ? " on" : ""}${b.pin === ball ? " chosen" : ""}`} onClick={() => pick(b.pin)}>
                  <title>
                    {`${b.row}${b.col} · ${n.name}`}
                    {dmg ? ` · ${t(`bga.damage.${dmg}`)}` : ""}
                  </title>
                  <circle cx={b.x} cy={b.y} r={r} />
                  {dmg && <circle cx={b.x} cy={b.y} r={r * 1.3} className={`bga-dmg dmg-${dmg}`} />}
                  {dmg && dmg !== "repaired" && (
                    <path d={`M${b.x - r} ${b.y - r}L${b.x + r} ${b.y + r}M${b.x + r} ${b.y - r}L${b.x - r} ${b.y + r}`} className={`bga-dmg dmg-${dmg}`} />
                  )}
                </g>
              );
            })}
            {a1Place && corner && (
              <g className="bga-a1" pointerEvents="none">
                <circle cx={a1Place.x} cy={a1Place.y} r={r * 1.55} />
                <path d={`M${corner.x} ${corner.y}l${corner.dx * step * 0.7} 0l${-corner.dx * step * 0.7} ${corner.dy * step * 0.7}z`} />
                <text x={corner.x - corner.dx * step * 0.15} y={corner.y - corner.dy * step * 0.25} fontSize={step * 0.62} textAnchor={corner.dx > 0 ? "end" : "start"}>
                  {model.pins[a1!].number}
                </text>
              </g>
            )}
          </svg>
          <p className="muted bga-legend">
            <span className="bga-key kind-power" /> {t("bga.power")} <span className="bga-key kind-ground" /> {t("bga.ground")} <span className="bga-key kind-signal" /> {t("bga.signal")}{" "}
            <span className="bga-key kind-unconnected" /> {t("bga.nc")} <span className="bga-key gap" /> {t("bga.gapKey")} <span className="bga-key dmg" /> {t("bga.damageKey")}
          </p>
        </div>
        <aside className="bga-side">
          <div className="segmented small-seg">
            <button className={tab === "probes" ? "on" : ""} onClick={() => setTab("probes")}>
              {t("bga.ball")}
            </button>
            <button className={tab === "values" ? "on" : ""} onClick={() => setTab("values")}>
              {t("bga.values")} {valueRows.length > 0 && <span className="count">{valueRows.length}</span>}
            </button>
          </div>
          {tab === "values" ? (
            valueRows.length === 0 ? (
              <p className="muted">{t("bga.noValues")}</p>
            ) : (
              <table className="wb-table bga-values">
                <thead>
                  <tr>
                    <th>{t("bga.ball")}</th>
                    <th>{t("details.net")}</th>
                    <th>{t("bga.refCol")}</th>
                    <th>{t("bga.caseCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {valueRows.map((row) => (
                    <tr key={row.pin} onClick={() => pick(row.pin)} className={row.pin === ball ? "on" : undefined}>
                      <td className="mono">
                        {model.pins[row.pin].number}
                        {row.damage && <span className="src-tag warn">{t(`bga.damage.${row.damage}`)}</span>}
                      </td>
                      <td className="mono">{model.nets[model.pins[row.pin].net].name}</td>
                      <td className="mono">{row.ref}</td>
                      <td className="mono">{row.now}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : ball === null || net === undefined ? (
            <p className="muted">{t("bga.pick")}</p>
          ) : (
            <>
              <h3>
                {p.name}.{model.pins[ball].number}
                {ball === a1 && <span className="src-tag">A1</span>}
              </h3>
              <p>
                <button className={`link net-chip kind-${model.nets[net].kind}`} onClick={() => onSelect({ kind: "net", net }, true)}>
                  {model.nets[net].name}
                </button>
              </p>
              {(() => {
                const v = valuesOf(ball);
                const dmg = damage[v.key];
                return (
                  <dl className="props">
                    {v.ref && (
                      <>
                        <dt>{t("bga.refCol")}</dt>
                        <dd className="mono">{v.ref}</dd>
                      </>
                    )}
                    {v.now && (
                      <>
                        <dt>{t("bga.caseCol")}</dt>
                        <dd className="mono">{v.now}</dd>
                      </>
                    )}
                    <dt>{t("bga.pad")}</dt>
                    <dd>{dmg ? <span className="src-tag warn">{t(`bga.damage.${dmg}`)}</span> : t("bga.padOk")}</dd>
                  </dl>
                );
              })()}
              <p className="muted">{t("bga.netBalls", { n: [...grid.balls.values()].filter((x) => model.pins[x].net === net).length })}</p>
              <h3 title={t("bga.probesHint")}>{t("bga.probes")}</h3>
              {probes.length === 0 ? (
                <p className="muted">{t("bga.noProbes")}</p>
              ) : (
                <ul className="bga-probes">
                  {probes.map((pp) => (
                    <li key={`${pp.kind}${pp.index}`}>
                      <button
                        className="link mono"
                        onClick={() => onSelect(pp.kind === "part" ? { kind: "part", part: pp.index } : { kind: "testPoint", testPoint: pp.index }, true)}
                      >
                        {pp.name}
                      </button>{" "}
                      <span className="muted">{formatLength(pp.distance, units)}</span>
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
