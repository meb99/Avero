/** A jumper repair planned before the iron is hot (F43): both ends, the way, the wire, the tests. */
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { jumperPlan, type JumperTarget } from "../core/jumper";
import { formatLength } from "../format";
import { useI18n } from "../i18n";
import { formatValue } from "../workbench/measure";
import { addDrawing, type BoardNotes } from "../workbench/notes";

interface Props {
  model: BoardModel;
  pin: number;
  target: JumperTarget;
  side: "top" | "bottom";
  units: "mm" | "mil";
  notes: BoardNotes | null;
  update(f: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, center: boolean): void;
}

export function JumperPlanCard({ model, pin, target, side, units, notes, update, onSelect }: Props) {
  const { t, lang } = useI18n();
  const plan = jumperPlan(model, pin, target, side);
  const ref = notes?.reference[plan.from.net];
  const refText = [
    ref?.resistance !== undefined && `${formatValue(ref.resistance, "resistance", lang)}`,
    ref?.diode !== undefined && `${formatValue(ref.diode, "diode", lang)} ${t("measure.diode")}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const partLink = (i: number) => (
    <button key={i} className="link mono" onClick={() => onSelect({ kind: "part", part: i }, true)}>
      {model.parts[i].name}
    </button>
  );
  const ends = { a: plan.from.label, b: plan.to.label };
  return (
    <div className="jumper-plan">
      <dl className="props">
        <dt>{t("jumper.plan.ends")}</dt>
        <dd>
          <span className="mono">{plan.from.label}</span> → <span className="mono">{plan.to.label}</span>
          <span className="src-tag" title={t("jumper.plan.confirmedHint")}>
            {t("jumper.plan.confirmed")}
          </span>
        </dd>
        <dt>{t("details.net")}</dt>
        <dd className="mono">{plan.from.net}</dd>
        <dt>{t("jumper.plan.wire")}</dt>
        <dd>
          ≈ {plan.wireMm.toLocaleString(lang, { maximumFractionDigits: 1 })} mm{" "}
          <span className="muted">
            ({t("jumper.plan.straight")} {formatLength(plan.straight, units)}
            {plan.route.length > 2 && `, ${t("jumper.plan.routed", { n: plan.route.length - 2 })} ${formatLength(plan.routed, units)}`})
          </span>
        </dd>
      </dl>
      {plan.signal !== "plain" && <p className="kb-note kb-warning">{t(plan.signal === "highSpeed" ? "jumper.plan.highSpeed" : "jumper.plan.clock")}</p>}
      {plan.inTheWay.length > 0 && (
        <p className="muted">
          {t("jumper.plan.inTheWay")} {plan.inTheWay.slice(0, 8).map((i, k) => [k > 0 && ", ", partLink(i)])}
          {plan.inTheWay.length > 8 && " …"}
          {plan.crossed.length === 0 ? ` – ${t("jumper.plan.around")}` : ` – ${t("jumper.plan.over", { n: plan.crossed.length })}`}
        </p>
      )}
      <h4>{t("jumper.plan.tests")}</h4>
      <ol className="jumper-steps">
        <li>{t("jumper.plan.before", ends)}</li>
        <li>{t("jumper.plan.after", ends)}</li>
        <li>
          {plan.neighbours.length > 0
            ? t("jumper.plan.neighbours", { nets: plan.neighbours.map((n) => n.net).join(", ") })
            : t("jumper.plan.noNeighbours")}
        </li>
        <li>{refText ? t("jumper.plan.reference", { net: plan.from.net, value: refText }) : t("jumper.plan.noReference", { net: plan.from.net })}</li>
      </ol>
      {notes && (
        <button
          className="small"
          onClick={() =>
            update((n) =>
              addDrawing(n, {
                kind: "jumper",
                side,
                points: plan.route.map((p) => ({ x: p.x, y: p.y })),
                from: `${plan.from.label} · ${plan.from.net}`,
                to: plan.to.label,
                plan: { net: plan.from.net, wireMm: plan.wireMm, ...(plan.signal !== "plain" && { signal: plan.signal }) },
              }),
            )
          }
        >
          {t("jumper.draw")}
        </button>
      )}
    </div>
  );
}
