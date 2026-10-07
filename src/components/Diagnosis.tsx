import { useEffect, useMemo, useState } from "react";
import { askConfirm, askText } from "./Ask";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n, type MessageKey } from "../i18n";
import type { SchematicFacts } from "../schematic/partInfo";
import { loadStore, saveStore } from "../workbench/appStore";
import { consoleGuides } from "../workbench/consoleGuides";
import { noPowerGuide, type DiagStep, type Expect } from "../workbench/diagnosis";
import {
  expectText,
  flowFromCase,
  flowPath,
  judgeFlow,
  newFlow,
  newStep,
  parseFlows,
  stepState,
  type Flow,
  type FlowExpect,
  type FlowPoint,
  type FlowStep,
} from "../workbench/flows";
import { QUANTITIES, type Quantity } from "../workbench/measure";
import { activeCase, addCase, addList, setValue, type BoardNotes } from "../workbench/notes";
import { ValueInput } from "./MeasureBlock";
import { NetHintCard } from "./NetHint";
import { caseHints } from "../workbench/hints";

interface Props {
  model: BoardModel;
  notes: BoardNotes | null;
  update(change: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
  schematicFacts?: SchematicFacts | null;
  selection: Selection;
  tolerance?: number;
}

/** A guide on offer: built in (generated for this board) or saved by the user. */
interface Guide {
  id: string;
  title: string;
  intro?: string;
  steps: FlowStep[];
  /** Saved by the user: can be edited and deleted. */
  own?: Flow;
}

const SOURCE_KEYS: Record<string, MessageKey> = {
  datasheet: "diag.source.datasheet",
  name: "diag.source.name",
  standard: "diag.source.standard",
  schematic: "diag.source.schematic",
  reference: "flow.source.reference",
  case: "flow.source.case",
  wiki: "flow.source.wiki",
};

function toFlowExpect(e: Expect): FlowExpect {
  switch (e.kind) {
    case "volts":
      return { kind: "value", value: e.volts, tolerance: 0.1 };
    case "range":
      return { kind: "range", min: e.min, max: e.max };
    default:
      return { kind: e.kind };
  }
}

/** The notebook guide in the common flow format. */
function notebookSteps(model: BoardModel, steps: DiagStep[]): FlowStep[] {
  return steps.map((s) => ({
    id: s.id,
    title: s.title,
    text: s.text,
    hint: s.hint,
    points: s.points.map((p) => ({ net: model.nets[p.net].name, quantity: "voltage" as Quantity, expect: toFlowExpect(p.expect), label: p.label, source: p.source })),
  }));
}

/** Share of a flow's nets that exist on the board (to offer flows made on another board of the same kind). */
function netShare(model: BoardModel, flow: Flow): number {
  const nets = new Set(flow.steps.flatMap((s) => s.points.map((p) => p.net)));
  if (nets.size === 0) return 0;
  let found = 0;
  for (const n of nets) if (model.findNet(n) !== undefined) found++;
  return found / nets.size;
}

/** The "Fault finding" tab: guides from the adapter to the CPU, console guides and own repair routes. */
export function Diagnosis({ model, notes, update, onSelect, schematicFacts, selection, tolerance = 0.1 }: Props) {
  const { t } = useI18n();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [chosen, setChosen] = useState("notebook");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadStore("flows").then(
      (json) => setFlows(parseFlows(json)),
      () => setFlows([]),
    );
  }, []);
  const saveFlows = (next: Flow[]) => {
    setFlows(next);
    saveStore("flows", next).catch((e) => setMessage(String(e)));
  };

  const notebook = useMemo(() => {
    // Voltages the schematic draws nets with, by net index.
    const volts = new Map<number, number>();
    if (schematicFacts)
      model.nets.forEach((n, i) => {
        const v = schematicFacts.netVoltages.get(n.name.toUpperCase()) ?? schematicFacts.netVoltages.get(model.fileNetName(i).toUpperCase());
        if (v) volts.set(i, Number.parseFloat(v));
      });
    return notebookSteps(model, noPowerGuide(model, volts));
  }, [model, schematicFacts]);

  const guides = useMemo<Guide[]>(() => {
    const own = flows
      .filter((f) => f.boardKey === notes?.key || netShare(model, f) >= 0.5)
      .map((f) => ({ id: f.id, title: f.title, steps: f.steps, own: f }));
    const nb = { id: "notebook", title: t("diag.title"), intro: t("diag.intro"), steps: notebook };
    // A notebook guide without a single point here (a console board) goes last.
    const nbUseful = notebook.some((step) => step.points.length > 0);
    const builtin = nbUseful ? [nb, ...consoleGuides(model, t)] : [...consoleGuides(model, t), nb];
    return [...builtin, ...own];
  }, [flows, notebook, model, notes?.key, t]);
  const guide = guides.find((g) => g.id === chosen) ?? guides[0];
  const current = notes ? activeCase(notes) : undefined;

  const changeOwn = (flow: Flow) => saveFlows(flows.map((f) => (f.id === flow.id ? flow : f)));

  return (
    <div className="diagnosis">
      <CaseHints model={model} notes={notes} tolerance={tolerance} onSelect={onSelect} />
      <div className="diag-pick">
        <select
          value={guide.id}
          onChange={(e) => {
            setChosen(e.target.value);
            setEditing(false);
          }}
          aria-label={t("flow.choose")}
        >
          <optgroup label={t("flow.builtin")}>
            {guides.filter((g) => !g.own).map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </optgroup>
          {guides.some((g) => g.own) && (
            <optgroup label={t("flow.own")}>
              {guides.filter((g) => g.own).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className="diag-actions">
        {notes && guide.steps.some((s) => s.points.length) && (
          <button
            className="small"
            onClick={() => {
              const items = guide.steps.flatMap((s) => s.points.map((p) => ({ net: p.net, quantity: p.quantity, label: s.title })));
              update((n) => addList(n, guide.title, items));
              setMessage(t("flow.listSaved", { title: guide.title }));
            }}
          >
            {t("lists.fromGuide")}
          </button>
        )}
        {notes && current && (
          <button
            className="small"
            title={t("flow.fromCaseHint")}
            onClick={async () => {
              const title = await askText(t("flow.fromCaseTitle"), current.title);
              if (!title?.trim()) return;
              const flow = flowFromCase(notes, current.id, title.trim());
              if (!flow) return setMessage(t("flow.fromCaseEmpty"));
              saveFlows([...flows, flow]);
              setChosen(flow.id);
            }}
          >
            {t("flow.fromCase")}
          </button>
        )}
        <button
          className="small"
          onClick={async () => {
            const title = await askText(t("flow.newTitle"), t("flow.newDefault"));
            if (!title?.trim()) return;
            const flow = newFlow(title.trim(), notes?.key);
            saveFlows([...flows, flow]);
            setChosen(flow.id);
            setEditing(true);
          }}
        >
          + {t("flow.new")}
        </button>
        {guide.own && (
          <>
            <button className={editing ? "small on" : "small"} onClick={() => setEditing((v) => !v)}>
              {editing ? t("flow.done") : t("flow.edit")}
            </button>
            <button
              className="small danger"
              onClick={async () => {
                if (!(await askConfirm(t("flow.deleteAsk", { title: guide.title }), { danger: true, ok: t("flow.delete") }))) return;
                saveFlows(flows.filter((f) => f.id !== guide.id));
                setChosen("notebook");
              }}
            >
              {t("flow.delete")}
            </button>
          </>
        )}
      </div>
      {message && <p className="muted diag-message">{message}</p>}
      {guide.own && editing ? (
        <FlowEditor model={model} flow={guide.own} selection={selection} onChange={changeOwn} />
      ) : (
        <FlowRunner model={model} notes={notes} update={update} onSelect={onSelect} guide={guide} />
      )}
    </div>
  );
}

/** Walks through a guide: values go into the active repair case, the first deviation shows its hint. */
function FlowRunner({
  model,
  notes,
  update,
  onSelect,
  guide,
}: {
  model: BoardModel;
  notes: BoardNotes | null;
  update(change: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
  guide: Guide;
}) {
  const { t, lang } = useI18n();
  const current = notes ? activeCase(notes) : undefined;
  const words = { high: t("diag.expect.high"), low: t("flow.expect.low"), present: t("diag.expect.present"), noShort: t("flow.expect.noShort") };
  const value = (p: FlowPoint) => current?.readings[p.net]?.[p.quantity];
  const states = guide.steps.map((s) => stepState(s, value));
  const path = flowPath(guide.steps, states);
  const rest = guide.steps.map((_, i) => i).filter((i) => !path.includes(i));
  const stop = path.at(-1);
  const stuck = stop !== undefined && states[stop] === "bad" ? guide.steps[stop] : undefined;

  return (
    <>
      <h2>{guide.title}</h2>
      {guide.intro && <p className="muted">{guide.intro}</p>}
      {notes &&
        (current ? (
          <p className="muted">{t("diag.case", { title: current.title })}</p>
        ) : (
          <p className="diag-case">
            {t("diag.noCase")}{" "}
            <button className="small" onClick={() => update((n) => addCase(n, guide.title))}>
              {t("diag.createCase")}
            </button>
          </p>
        ))}
      {stuck && (
        <div className="kb-note kb-warning diag-first">
          <strong>
            {t("diag.firstProblem")}: {stuck.title}
          </strong>
          {stuck.hint && (
            <>
              <br />
              {stuck.hint}
            </>
          )}
        </div>
      )}
      <ol className="diag-steps">
        {path.map((i) => {
          const step = guide.steps[i];
          const state = states[i];
          return (
            <li key={step.id} className={`diag-step diag-${state}`}>
              <h3>
                <span className="diag-mark">{state === "ok" ? "✓" : state === "bad" ? "✗" : "○"}</span> {step.title}
                {step.points.length > 0 && (
                  <span className="muted diag-count">
                    {" "}
                    {t("diag.measured", { n: step.points.filter((p) => value(p) !== undefined).length, m: step.points.length })}
                  </span>
                )}
              </h3>
              {step.text && <p>{step.text}</p>}
              {step.points.length === 0 ? (
                <p className="muted">{t("diag.none")}</p>
              ) : (
                <table className="diag-table">
                  <tbody>
                    {step.points.map((p) => {
                      const net = model.findNet(p.net);
                      const result = judgeFlow(p.expect, value(p), p.quantity);
                      return (
                        <tr key={`${p.net}|${p.quantity}`} className={result ? `diag-${result}` : net === undefined ? "missing" : undefined}>
                          <td>
                            <button
                              className={`link net-chip kind-${net !== undefined ? model.nets[net].kind : "signal"}`}
                              disabled={net === undefined}
                              title={net === undefined ? t("flow.notOnBoard") : undefined}
                              onClick={() => net !== undefined && onSelect({ kind: "net", net }, true)}
                            >
                              {p.net}
                            </button>
                            {p.label && <div className="muted diag-label">{p.label}</div>}
                          </td>
                          <td className="diag-expect" title={p.source && SOURCE_KEYS[p.source] ? t(SOURCE_KEYS[p.source]) : undefined}>
                            <span className="muted">{t(`measure.${p.quantity}`)}</span> {expectText(p.expect, p.quantity, lang, words)}
                            {p.source && SOURCE_KEYS[p.source] && <div className="muted diag-source">{t(SOURCE_KEYS[p.source])}</div>}
                          </td>
                          <td className="diag-value">
                            {current && notes ? (
                              <ValueInput
                                value={value(p)}
                                quantity={p.quantity}
                                label={`${p.net} · ${current.title}`}
                                status={result === "bad" ? "deviation" : result}
                                onChange={(v) => update((n) => setValue(n, { caseId: current.id }, p.net, p.quantity, v))}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {state === "bad" && step.hint && step.onBad !== undefined && <p className="diag-hint">{step.hint}</p>}
            </li>
          );
        })}
      </ol>
      {rest.length > 0 && (
        <details className="diag-rest">
          <summary>{t("flow.rest", { n: rest.length })}</summary>
          <ul>
            {rest.map((i) => (
              <li key={guide.steps[i].id}>{guide.steps[i].title}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

const EXPECT_KINDS: FlowExpect["kind"][] = ["value", "range", "high", "low", "present", "ol", "noShort"];

/** Edits an own flow: steps, texts, points with expectations, and where to go after ok / a deviation. */
function FlowEditor({ model, flow, selection, onChange }: { model: BoardModel; flow: Flow; selection: Selection; onChange(flow: Flow): void }) {
  const { t } = useI18n();
  const setStep = (i: number, change: Partial<FlowStep>) => onChange({ ...flow, steps: flow.steps.map((s, k) => (k === i ? { ...s, ...change } : s)) });
  const move = (i: number, d: number) => {
    const steps = [...flow.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    onChange({ ...flow, steps });
  };
  const selectedNet = model.selectedNet(selection);
  const branchValue = (b: string | null | undefined) => (b === undefined ? "" : b === null ? "__end" : b);
  const branchFrom = (v: string) => (v === "" ? undefined : v === "__end" ? null : v);

  return (
    <div className="flow-editor">
      <label className="wb-label">
        {t("flow.title")}
        <input value={flow.title} onChange={(e) => onChange({ ...flow, title: e.target.value })} />
      </label>
      <label className="wb-label">
        {t("flow.device")}
        <input value={flow.device ?? ""} placeholder="Switch OLED" onChange={(e) => onChange({ ...flow, device: e.target.value || undefined })} />
      </label>
      <ol className="flow-steps">
        {flow.steps.map((step, i) => (
          <li key={step.id} className="flow-step">
            <div className="wb-row">
              <input className="flow-step-title" value={step.title} onChange={(e) => setStep(i, { title: e.target.value })} aria-label={t("flow.stepTitle")} />
              <button className="tool icon-only" onClick={() => move(i, -1)} title={t("flow.up")} aria-label={t("flow.up")}>
                ↑
              </button>
              <button className="tool icon-only" onClick={() => move(i, 1)} title={t("flow.down")} aria-label={t("flow.down")}>
                ↓
              </button>
              <button
                className="tool icon-only danger"
                onClick={() => onChange({ ...flow, steps: flow.steps.filter((_, k) => k !== i) })}
                title={t("flow.removeStep")}
                aria-label={t("flow.removeStep")}
              >
                ×
              </button>
            </div>
            <textarea rows={2} value={step.text ?? ""} placeholder={t("flow.text")} onChange={(e) => setStep(i, { text: e.target.value || undefined })} />
            <input value={step.hint ?? ""} placeholder={t("flow.hint")} onChange={(e) => setStep(i, { hint: e.target.value || undefined })} />
            <div className="flow-points">
                {step.points.map((p, k) => {
                  const setPoint = (change: Partial<FlowPoint>) => setStep(i, { points: step.points.map((x, j) => (j === k ? { ...x, ...change } : x)) });
                  const e = p.expect;
                  return (
                    <div key={k} className="flow-point">
                      <span className="mono flow-point-net">{p.net}</span>
                      <span className="flow-point-cell">
                        <select value={p.quantity} onChange={(ev) => setPoint({ quantity: ev.target.value as Quantity })}>
                          {QUANTITIES.map((q) => (
                            <option key={q} value={q}>
                              {t(`measure.${q}`)}
                            </option>
                          ))}
                        </select>
                      </span>
                      <span className="flow-point-cell">
                        <select
                          value={e.kind}
                          onChange={(ev) => {
                            const kind = ev.target.value as FlowExpect["kind"];
                            setPoint({
                              expect: kind === "value" ? { kind, value: 0, tolerance: 0.1 } : kind === "range" ? { kind, min: 0, max: 1 } : ({ kind } as FlowExpect),
                            });
                          }}
                        >
                          {EXPECT_KINDS.map((k2) => (
                            <option key={k2} value={k2}>
                              {t(`flow.kind.${k2}`)}
                            </option>
                          ))}
                        </select>
                        {e.kind === "value" && (
                          <>
                            <input className="flow-num" type="number" step="any" value={e.value} onChange={(ev) => setPoint({ expect: { ...e, value: Number(ev.target.value) } })} />
                            ±
                            <input
                              className="flow-num"
                              type="number"
                              step="1"
                              value={Math.round(e.tolerance * 100)}
                              onChange={(ev) => setPoint({ expect: { ...e, tolerance: Number(ev.target.value) / 100 } })}
                            />
                            %
                          </>
                        )}
                        {e.kind === "range" && (
                          <>
                            <input className="flow-num" type="number" step="any" value={e.min} onChange={(ev) => setPoint({ expect: { ...e, min: Number(ev.target.value) } })} />–
                            <input className="flow-num" type="number" step="any" value={e.max} onChange={(ev) => setPoint({ expect: { ...e, max: Number(ev.target.value) } })} />
                          </>
                        )}
                      </span>
                      <span className="flow-point-cell">
                        <button className="tool icon-only" onClick={() => setStep(i, { points: step.points.filter((_, j) => j !== k) })} aria-label={t("lists.remove")}>
                          ×
                        </button>
                      </span>
                    </div>
                  );
                })}
            </div>
            <button
              className="small"
              disabled={selectedNet === undefined}
              onClick={() =>
                selectedNet !== undefined &&
                setStep(i, { points: [...step.points, { net: model.nets[selectedNet].name, quantity: "voltage", expect: { kind: "present" } }] })
              }
            >
              + {t("lists.addNet")}
            </button>
            <div className="flow-branches">
              <label>
                {t("flow.onOk")}
                <select value={branchValue(step.onOk)} onChange={(e) => setStep(i, { onOk: branchFrom(e.target.value) })}>
                  <option value="">{t("flow.next")}</option>
                  <option value="__end">{t("flow.end")}</option>
                  {flow.steps.filter((s) => s.id !== step.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      → {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("flow.onBad")}
                <select value={branchValue(step.onBad)} onChange={(e) => setStep(i, { onBad: branchFrom(e.target.value) })}>
                  <option value="">{t("flow.stop")}</option>
                  <option value="__end">{t("flow.end")}</option>
                  {flow.steps.filter((s) => s.id !== step.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      → {s.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ol>
      <button className="small" onClick={() => onChange({ ...flow, steps: [...flow.steps, newStep(String(flow.steps.length + 1))] })}>
        + {t("flow.addStep")}
      </button>
    </div>
  );
}

/** The nets of the active case that stand out, each with its explained hint (F37). */
function CaseHints({ model, notes, tolerance, onSelect }: { model: BoardModel; notes: BoardNotes | null; tolerance: number; onSelect(selection: Selection, zoom: boolean): void }) {
  const { t } = useI18n();
  const hints = useMemo(() => (notes ? caseHints(model, notes, tolerance, t("measure.reference")) : []), [model, notes, tolerance, t]);
  const repair = notes ? activeCase(notes) : undefined;
  return (
    <section className="case-hints">
      <h3 title={t("hint.notVerdict")}>{t("hint.caseTitle")}</h3>
      {!repair ? (
        <p className="muted">{t("hint.noCase")}</p>
      ) : hints.length === 0 ? (
        <p className="muted">{t("hint.caseEmpty")}</p>
      ) : (
        hints.slice(0, 20).map((h, i) => {
          const net = model.nets.findIndex((n) => n.name === h.net);
          return (
            <details key={h.net} className="net-hint-box" open={i === 0 || undefined}>
              <summary>
                <button className="link mono" onClick={(e) => {
                    e.preventDefault();
                    onSelect({ kind: "net", net }, true);
                  }}>
                  {h.net}
                </button>{" "}
                <span className={`hint-tag finding-${h.finding}`}>{t(`hint.finding.${h.finding}`)}</span>
              </summary>
              <NetHintCard model={model} hint={h} onSelect={onSelect} />
            </details>
          );
        })
      )}
    </section>
  );
}
