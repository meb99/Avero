import { useMemo } from "react";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { judge, noPowerGuide, type DiagStep, type Expect } from "../workbench/diagnosis";
import { activeCase, addCase, setValue, type BoardNotes } from "../workbench/notes";
import { ValueInput } from "./MeasureBlock";
import type { SchematicFacts } from "../schematic/partInfo";

interface Props {
  model: BoardModel;
  notes: BoardNotes | null;
  update(change: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
  schematicFacts?: SchematicFacts | null;
}

type StepState = "ok" | "bad" | "open" | "empty";

/** The fault-finding guide: steps from the adapter to the CPU, with the board's measuring points. */
export function Diagnosis({ model, notes, update, onSelect, schematicFacts }: Props) {
  const { t, lang } = useI18n();
  const steps = useMemo(() => {
    // Voltages the schematic draws nets with, by net index.
    const volts = new Map<number, number>();
    if (schematicFacts)
      model.nets.forEach((n, i) => {
        const v = schematicFacts.netVoltages.get(n.name.toUpperCase()) ?? schematicFacts.netVoltages.get(model.fileNetName(i).toUpperCase());
        if (v) volts.set(i, Number.parseFloat(v));
      });
    return noPowerGuide(model, volts);
  }, [model, schematicFacts]);
  const current = notes ? activeCase(notes) : undefined;
  const volts = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 });
  const expectText = (e: Expect) =>
    e.kind === "volts"
      ? `${volts(e.volts)} V`
      : e.kind === "range"
        ? `${volts(e.min)}–${volts(e.max)} V`
        : t(e.kind === "high" ? "diag.expect.high" : "diag.expect.present");

  const reading = (name: string) => current?.readings[name]?.voltage;
  const stateOf = (step: DiagStep): StepState => {
    if (step.points.length === 0) return "empty";
    const results = step.points.map((p) => judge(p.expect, reading(p.name)));
    if (results.includes("bad")) return "bad";
    return results.every((r) => r === "ok") ? "ok" : "open";
  };
  const states = steps.map(stateOf);
  const firstBad = states.indexOf("bad");

  return (
    <div className="diagnosis">
      <h2>{t("diag.title")}</h2>
      <p className="muted">{t("diag.intro")}</p>
      {notes &&
        (current ? (
          <p className="muted">{t("diag.case", { title: current.title })}</p>
        ) : (
          <p className="diag-case">
            {t("diag.noCase")}{" "}
            <button className="small" onClick={() => update((n) => addCase(n, t("diag.caseTitle")))}>
              {t("diag.createCase")}
            </button>
          </p>
        ))}
      {firstBad >= 0 && (
        <div className="kb-note kb-warning diag-first">
          <strong>
            {t("diag.firstProblem")}: {steps[firstBad].title}
          </strong>
          <br />
          {steps[firstBad].hint}
        </div>
      )}
      <ol className="diag-steps">
        {steps.map((step, i) => (
          <li key={step.id} className={`diag-step diag-${states[i]}`}>
            <h3>
              <span className="diag-mark">{states[i] === "ok" ? "✓" : states[i] === "bad" ? "✗" : "○"}</span> {step.title}
              {step.points.length > 0 && (
                <span className="muted diag-count">
                  {" "}
                  {t("diag.measured", { n: step.points.filter((p) => reading(p.name) !== undefined).length, m: step.points.length })}
                </span>
              )}
            </h3>
            <p>{step.text}</p>
            {step.points.length === 0 ? (
              <p className="muted">{t("diag.none")}</p>
            ) : (
              <table className="diag-table">
                <tbody>
                  {step.points.map((p) => {
                    const result = judge(p.expect, reading(p.name));
                    return (
                      <tr key={p.net} className={result ? `diag-${result}` : undefined}>
                        <td>
                          <button className={`link net-chip kind-${model.nets[p.net].kind}`} onClick={() => onSelect({ kind: "net", net: p.net }, true)}>
                            {p.name}
                          </button>
                          <div className="muted diag-label">{p.label}</div>
                        </td>
                        <td className="diag-expect" title={t(`diag.source.${p.source}`)}>
                          {expectText(p.expect)}
                          <div className="muted diag-source">{t(`diag.source.${p.source}`)}</div>
                        </td>
                        <td className="diag-value">
                          {current && notes ? (
                            <ValueInput
                              value={reading(p.name)}
                              quantity="voltage"
                              label={`${p.name} · ${current.title}`}
                              status={result === "bad" ? "deviation" : result}
                              onChange={(v) => update((n) => setValue(n, { caseId: current.id }, p.name, "voltage", v))}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {states[i] === "bad" && <p className="diag-hint">{step.hint}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
