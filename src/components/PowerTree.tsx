import { useMemo, useState } from "react";
import type { BoardModel } from "../core/board";
import { buildPowerTree, powerTreeRoots, type ConverterKind, type TreeNode } from "../core/powerTree";
import { findPoint } from "../core/points";
import type { Selection } from "../core/types";
import { useI18n, type MessageKey } from "../i18n";
import type { SchematicFacts } from "../schematic/partInfo";
import { formatValue, type Value } from "../workbench/measure";
import { activeCase, type BoardNotes } from "../workbench/notes";
import {
  expectedSequence,
  diagnosisState,
  measuredCourse,
  resolvePower,
  sequenceFinding,
  setConverterEdit,
  supplyStates,
  type MeasuredPoint,
  type PowerState,
  type ConverterEdit,
  type Provenance,
  type ResolvedConverter,
  type ResolvedTree,
} from "../workbench/power";

type Status = "ok" | "bad" | "measured" | "conflict" | undefined;

interface Props {
  model: BoardModel;
  notes: BoardNotes | null;
  schematicFacts: SchematicFacts | null;
  onSelect(selection: Selection, zoom: boolean): void;
  update?(change: (n: BoardNotes) => BoardNotes): void;
}

const KINDS: ConverterKind[] = ["regulator", "linear", "switch", "boost", "charger"];
const SOURCES = ["schematic", "datasheet", "measured", "manual", "own"] as const;

/**
 * Which regulator makes which rail from which, as a tree from the adapter
 * down, with the voltages of the repair case next to each rail. Every
 * statement says where it comes from: read from the copper (and why), or
 * set by hand with a source. Below, kept apart: the expected power-up order
 * and what was actually measured, in the order it was measured.
 */
export function PowerTree({ model, notes, schematicFacts, onSelect, update }: Props) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [sequenceText, setSequenceText] = useState<string | null>(null);
  const [sequenceSource, setSequenceSource] = useState("");
  // Opened by hand, or by suspects; never closed by saving a correction.
  const [open, setOpen] = useState<boolean | null>(null);

  const copper = useMemo(() => {
    const volts = new Map<number, number>();
    if (schematicFacts)
      model.nets.forEach((n, i) => {
        const v = schematicFacts.netVoltages.get(n.name.toUpperCase());
        const parsed = v ? Number.parseFloat(v) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) volts.set(i, parsed);
      });
    return buildPowerTree(model, volts);
  }, [model, schematicFacts]);
  const power = notes?.power;
  const tree = useMemo(() => resolvePower(model, copper, power), [model, copper, power]);
  const { roots, unfed } = useMemo(() => powerTreeRoots(tree), [tree]);
  const sequence = useMemo(() => expectedSequence(model, tree, power?.sequence), [model, tree, power?.sequence]);

  const kase = notes ? activeCase(notes) : undefined;
  const readings = kase?.readings;
  const points = kase?.points;
  // Net and point values of the case, each with the state it was taken in.
  const course = useMemo(() => measuredCourse(model, tree, readings, points), [model, tree, readings, points]);
  const measuredStates = useMemo(() => [...new Set(course.map((p) => p.power ?? "none"))], [course]);
  const [chosenState, setChosenState] = useState<PowerState | "auto">("auto");
  const state = chosenState === "auto" ? diagnosisState(course) : chosenState;
  const states = useMemo(() => supplyStates(model, tree, course, state), [model, tree, course, state]);
  const finding = sequenceFinding(sequence, states);
  const fits = (p: MeasuredPoint) => p.power === state || (p.power === undefined && state !== "off");

  // The supply's latest value in the judged state (a conflict shows the first place).
  const measured = (supply: number): Value | undefined => states.get(supply)?.places.at(-1)?.value;
  const status = (supply: number): Status => {
    const st = states.get(supply)?.status;
    if (st === undefined || st === "idle") return undefined;
    if (st === "conflict") return "conflict";
    return st === "ok" ? "ok" : st === "measured" ? "measured" : "bad";
  };

  // Converters whose input is there but an output is not: look there first.
  const suspects = tree.converters
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.input !== undefined && status(c.input) === "ok" && c.outputs.some((o) => status(o) === "bad"));

  if (tree.converters.length === 0 && !update) return null;

  const railName = (supply: number) => model.nets[tree.supplies[supply].nets[0]].name;
  const supplyRow = (supply: number) => {
    const s = tree.supplies[supply];
    const main = s.nets[0];
    const st = status(supply);
    const v = measured(supply);
    return (
      <span className={`pt-supply${st ? ` pt-${st}` : ""}`}>
        <button className="link" onClick={() => onSelect({ kind: "net", net: main }, true)} title={s.nets.map((n) => model.nets[n].name).join(" = ")}>
          {model.nets[main].name}
        </button>
        {s.nets.length > 1 && <span className="muted"> +{s.nets.length - 1}</span>}
        {s.volts !== undefined && <span className="pt-volts">{s.volts.toLocaleString(lang)} V</span>}
        {v !== undefined && <span className="pt-measured">{formatValue(v, "voltage", lang)}</span>}
      </span>
    );
  };

  const provText = (p: Provenance) =>
    p.from === "user" ? t("power.prov.user", { source: p.source }) : p.from === "copper" ? t("power.prov.copper", { why: t(`power.why.${p.why}` as MessageKey) }) : t("power.prov.none");
  const sourced = (c: ResolvedConverter) => (["kind", "input", "outputs", "enable", "powerGood"] as const).some((k) => c.prov[k].from === "user");

  const converterRow = (index: number) => {
    const c = tree.converters[index];
    const p = model.parts[c.part];
    return (
      <span className="pt-converter">
        <span className={`pt-kind pt-kind-${c.kind}`} title={provText(c.prov.kind)}>
          {t(`power.kind.${c.kind}` as MessageKey)}
        </span>
        <button className="link part-name" onClick={() => onSelect({ kind: "part", part: c.part }, true)}>
          {p.name}
        </button>
        {p.device && <span className="muted pt-device">{p.device}</span>}
        {c.confirmed ? (
          <span className="src-tag pt-checked" title={t("power.confirmedBy", { source: c.confirmed })}>
            ✓ {t("power.checked")}
          </span>
        ) : sourced(c) ? (
          <span className="src-tag pt-checked">{t("power.sourced")}</span>
        ) : c.added ? null : (
          <span className="src-tag" title={t("power.guessHint")}>
            {t("power.guess")}
          </span>
        )}
        {c.enable !== undefined && (
          <span className="muted pt-control" title={`${t("power.enable")} · ${provText(c.prov.enable)}`}>
            EN {model.nets[c.enable].name}
          </span>
        )}
        {c.powerGood !== undefined && (
          <span className="muted pt-control" title={`${t("power.powerGood")} · ${provText(c.prov.powerGood)}`}>
            PG {model.nets[c.powerGood].name}
          </span>
        )}
        {update && (
          <button className="tool icon-only pt-edit" aria-label={t("power.edit")} title={t("power.edit")} onClick={() => setEditing(editing === c.name ? null : c.name)}>
            ✎
          </button>
        )}
      </span>
    );
  };

  const editorFor = (index: number) => {
    const c = tree.converters[index];
    if (editing !== c.name || !update || !notes) return null;
    return (
      <ConverterEditor
        model={model}
        tree={tree}
        conv={c}
        edit={power?.converters.find((e) => e.part.toUpperCase() === c.name.toUpperCase())}
        provText={provText}
        onSave={(edit) => {
          update((n) => ({ ...n, power: setConverterEdit(n.power, c.name, edit) }));
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    );
  };

  const node = (n: TreeNode, depth: number) => (
    <li key={n.supply}>
      {supplyRow(n.supply)}
      {n.children.length > 0 && (
        <ul>
          {n.children.map((c) => (
            <li key={c.converter}>
              {converterRow(c.converter)}
              {editorFor(c.converter)}
              {c.outputs.length > 0 ? <ul>{c.outputs.map((o) => node(o, depth + 1))}</ul> : <OutputsShown tree={tree} index={c.converter} name={railName} label={t("power.shownAbove")} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  const startSequenceEdit = () => {
    setSequenceText(sequence.steps.map((s) => s.supplies.map(railName).join(", ")).join("\n"));
    setSequenceSource(power?.sequence?.source ?? "");
  };
  const saveSequence = () => {
    if (!update || sequenceText === null || !sequenceSource.trim()) return;
    const steps = sequenceText
      .split("\n")
      .map((l) => l.split(/[,;]/).map((x) => x.trim()).filter(Boolean))
      .filter((l) => l.length);
    update((n) => ({ ...n, power: { converters: n.power?.converters ?? [], sequence: { value: steps, source: sequenceSource.trim() } } }));
    setSequenceText(null);
  };
  const time = (at?: string) => (at ? new Date(at).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" }) : "–");

  return (
    <details className="power-tree" open={open ?? suspects.length > 0} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {t("power.title")} <span className="muted">{t("power.count", { n: tree.converters.length })}</span>
      </summary>
      <p className="muted pt-hint">{t("power.hint")}</p>
      <p className="muted pt-hint">{t("power.sourcesHint")}</p>
      {suspects.length > 0 && (
        <div className="pt-suspects">
          <strong>{t("power.suspects")}</strong>
          <ul>
            {suspects.map(({ c, i }) => (
              <li key={i}>
                {converterRow(i)}: {supplyRow(c.input!)} → {c.outputs.filter((o) => status(o) === "bad").map((o) => <span key={o}>{supplyRow(o)} </span>)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="pt-tree">{roots.map((r) => node(r, 0))}</ul>
      {unfed.length > 0 && (
        <>
          <p className="muted pt-hint">{t("power.unfed")}</p>
          <ul className="pt-tree">
            {unfed.map((i) => (
              <li key={i}>
                {converterRow(i)}
                {editorFor(i)}
                <ul>
                  {tree.converters[i].outputs.map((o) => (
                    <li key={o}>{supplyRow(o)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {update && notes && (
        <div className="wb-row pt-add">
          <input value={adding} list="pt-parts" placeholder={t("power.addPlaceholder")} onChange={(e) => setAdding(e.target.value)} aria-label={t("power.add")} />
          <datalist id="pt-parts">
            {[...new Set(model.parts.map((p) => p.name))].slice(0, 3000).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button
            className="small"
            disabled={model.findPart(adding.trim()) === undefined}
            onClick={() => {
              const part = model.findPart(adding.trim());
              if (part === undefined) return;
              const name = model.parts[part].name;
              const old = power?.converters.find((e) => e.part.toUpperCase() === name.toUpperCase());
              update((n) => ({ ...n, power: setConverterEdit(n.power, name, { ...old, removed: undefined }) }));
              setEditing(name);
              setAdding("");
            }}
          >
            {t("power.add")}
          </button>
        </div>
      )}

      <section className="pt-sequence">
        <h4>{t("power.expected")}</h4>
        <p className="muted pt-hint">
          {sequence.source.from === "user" ? t("power.sequence.user", { source: sequence.source.source }) : t("power.sequence.derived")}
        </p>
        {sequenceText === null ? (
          <>
            <ol className="pt-steps">
              {sequence.steps.map((s, i) => (
                <li key={i} className={finding?.step === i ? (finding.kind === "break" ? "pt-stop" : "pt-unchecked") : undefined}>
                  {s.supplies.map((x) => (
                    <span key={x}>{supplyRow(x)} </span>
                  ))}
                </li>
              ))}
            </ol>
            {update && notes && (
              <div className="wb-row">
                <button className="small" onClick={startSequenceEdit}>
                  {t("power.sequence.edit")}
                </button>
                {power?.sequence && (
                  <button className="small" onClick={() => update((n) => ({ ...n, power: { converters: n.power?.converters ?? [] } }))}>
                    {t("power.sequence.derive")}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="pt-editor">
            <p className="muted">{t("power.sequence.editHint")}</p>
            <textarea className="notes-field" rows={Math.min(12, sequence.steps.length + 2)} value={sequenceText} onChange={(e) => setSequenceText(e.target.value)} />
            <input value={sequenceSource} placeholder={t("power.sourcePlaceholder")} onChange={(e) => setSequenceSource(e.target.value)} aria-label={t("power.source")} />
            <div className="wb-row">
              <button className="small primary" disabled={!sequenceSource.trim()} onClick={saveSequence}>
                {t("power.save")}
              </button>
              <button className="small" onClick={() => setSequenceText(null)}>
                {t("power.cancel")}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="pt-course">
        <h4>{t("power.measured")}</h4>
        {!kase ? (
          <p className="muted pt-hint">{t("power.course.noCase")}</p>
        ) : course.length === 0 ? (
          <p className="muted pt-hint">{t("power.course.none")}</p>
        ) : (
          <>
            <p className="muted pt-hint">{t("power.course.hint", { title: kase.title })}</p>
            <table className="wb-table pt-course-table">
              <tbody>
                {course.map((p, i) => (
                  <tr key={i} className={fits(p) ? `pt-course-${p.status}` : "pt-course-other"}>
                    <td className="muted">{time(p.at)}</td>
                    <td>
                      <button className="link" onClick={() => onSelect(p.point ? (findPoint(model, p.point) ?? { kind: "net", net: p.net }) : { kind: "net", net: p.net }, true)}>
                        {p.point ?? model.nets[p.net].name}
                      </button>
                      {p.point && <span className="muted"> · {model.nets[p.net].name}</span>}
                    </td>
                    <td className="mono">{formatValue(p.value, "voltage", lang)}</td>
                    <td className="muted">{t(`power.state.${p.power ?? "none"}` as MessageKey)}</td>
                    <td>{fits(p) ? t(`power.course.${p.status}` as MessageKey) : t("power.course.notJudged")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="wb-row pt-judged">
              <span className="muted">{t("power.judgedBy")}</span>
              <select value={chosenState} onChange={(e) => setChosenState(e.target.value as PowerState | "auto")} aria-label={t("power.judgedBy")}>
                <option value="auto">{t("power.state.auto", { state: t(`power.state.${state ?? "none"}` as MessageKey) })}</option>
                {(["on", "standby", "off"] as const)
                  .filter((x) => measuredStates.includes(x))
                  .map((x) => (
                    <option key={x} value={x}>
                      {t(`power.state.${x}` as MessageKey)}
                    </option>
                  ))}
              </select>
            </div>
            {state === "off" && <p className="muted pt-hint">{t("power.course.offHint")}</p>}
            {[...states].filter(([, v]) => v.status === "conflict").map(([supply, v]) => (
              <p key={supply} className="pt-conflict">
                {t("power.course.conflict", {
                  rail: railName(supply),
                  places: v.places.map((p) => `${p.point ?? model.nets[p.net].name} ${formatValue(p.value, "voltage", lang)} (${t(`power.course.${p.status}` as MessageKey)})`).join(", "),
                })}
              </p>
            ))}
            {finding?.kind === "break" && state !== "off" && (
              <p className="pt-break">{t("power.course.break", { step: finding.step + 1, rails: finding.supplies.map(railName).join(", ") })}</p>
            )}
            {finding?.kind === "unchecked" && state !== "off" && (
              <p className="pt-unchecked-text">
                {t("power.course.firstMissing", { step: finding.step + 1, rail: railName(finding.supply) })}{" "}
                {finding.unchecked.length > 0 && t("power.course.unchecked", { rail: railName(finding.supply), rails: finding.unchecked.map(railName).join(", ") })}{" "}
                {finding.missing.length > 0 && t("power.course.missingBefore", { rails: finding.missing.map(railName).join(", ") })}
              </p>
            )}
          </>
        )}
      </section>
    </details>
  );
}

/** Corrects one converter: what it is, its input and outputs, enable and power-good – each with the source. */
function ConverterEditor({
  model,
  tree,
  conv,
  edit,
  provText,
  onSave,
  onClose,
}: {
  model: BoardModel;
  tree: ResolvedTree;
  conv: ResolvedConverter;
  edit: ConverterEdit | undefined;
  provText(p: Provenance): string;
  onSave(edit: Omit<ConverterEdit, "part"> | undefined): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const rail = (s: number | undefined) => (s === undefined ? "" : model.nets[tree.supplies[s].nets[0]].name);
  const netName = (n: number | undefined) => (n === undefined ? "" : model.nets[n].name);
  const start = {
    kind: conv.kind as ConverterKind,
    input: rail(conv.input),
    outputs: conv.outputs.map(rail).join(", "),
    enable: netName(conv.enable),
    powerGood: netName(conv.powerGood),
  };
  const [v, setV] = useState(start);
  const [preset, setPreset] = useState<(typeof SOURCES)[number]>("schematic");
  const [detail, setDetail] = useState("");
  const source = `${t(`power.src.${preset}` as MessageKey)}${detail.trim() ? ` ${detail.trim()}` : ""}`;
  // Nets on the part's pins first: what an input, output, enable or power-good can be.
  const options = useMemo(() => {
    const p = model.parts[conv.part];
    const own = new Set<string>();
    for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
      const n = model.nets[model.pins[i].net];
      if (n.kind !== "ground" && n.kind !== "unconnected") own.add(n.name);
    }
    const rails = tree.supplies.map((s) => model.nets[s.nets[0]].name);
    return [...own, ...rails.filter((r) => !own.has(r))];
  }, [model, tree, conv.part]);

  const save = (extra: Partial<ConverterEdit> = {}) => {
    const next: Omit<ConverterEdit, "part"> = { ...edit, ...extra };
    delete (next as Partial<ConverterEdit>).part;
    const changed = <K extends keyof typeof start>(k: K) => v[k] !== start[k];
    if (changed("kind") || edit?.kind) next.kind = { value: v.kind, source: changed("kind") ? source : edit!.kind!.source };
    if (changed("input") || edit?.input) next.input = { value: v.input.trim(), source: changed("input") ? source : edit!.input!.source };
    if (changed("outputs") || edit?.outputs)
      next.outputs = { value: v.outputs.split(/[,;]/).map((x) => x.trim()).filter(Boolean), source: changed("outputs") ? source : edit!.outputs!.source };
    if (changed("enable") || edit?.enable) next.enable = { value: v.enable.trim(), source: changed("enable") ? source : edit!.enable!.source };
    if (changed("powerGood") || edit?.powerGood) next.powerGood = { value: v.powerGood.trim(), source: changed("powerGood") ? source : edit!.powerGood!.source };
    onSave(next);
  };
  const field = (k: "input" | "outputs" | "enable" | "powerGood", label: string) => (
    <label className="pt-field">
      <span>{label}</span>
      <input value={v[k]} list="pt-nets" onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <span className="muted pt-prov">{v[k] !== start[k] ? t("power.prov.new") : provText(conv.prov[k])}</span>
    </label>
  );

  return (
    <div className="pt-editor" role="group" aria-label={t("power.edit")}>
      <datalist id="pt-nets">
        {options.slice(0, 2000).map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <label className="pt-field">
        <span>{t("power.kind")}</span>
        <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as ConverterKind })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`power.kind.${k}` as MessageKey)}
            </option>
          ))}
        </select>
        <span className="muted pt-prov">{v.kind !== start.kind ? t("power.prov.new") : provText(conv.prov.kind)}</span>
      </label>
      {field("input", t("power.input"))}
      {field("outputs", t("power.outputs"))}
      {field("enable", t("power.enable"))}
      {field("powerGood", t("power.powerGood"))}
      {conv.prov.input.from === "copper" && conv.prov.input.why === "highest" && <p className="muted pt-hint">{t("power.boostHint")}</p>}
      <div className="pt-field">
        <span>{t("power.source")}</span>
        <select value={preset} onChange={(e) => setPreset(e.target.value as (typeof SOURCES)[number])}>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`power.src.${s}` as MessageKey)}
            </option>
          ))}
        </select>
        <input value={detail} placeholder={t("power.sourcePlaceholder")} onChange={(e) => setDetail(e.target.value)} aria-label={t("power.sourceDetail")} />
      </div>
      <div className="wb-row">
        <button className="small primary" onClick={() => save()}>
          {t("power.save")}
        </button>
        <button className="small" title={t("power.confirmHint")} onClick={() => save({ confirmed: source })}>
          {t("power.confirm")}
        </button>
        <button className="small danger" onClick={() => onSave({ removed: true })}>
          {t("power.notAConverter")}
        </button>
        {edit && (
          <button className="small" onClick={() => onSave(undefined)}>
            {t("power.reset")}
          </button>
        )}
        <button className="small" onClick={onClose}>
          {t("power.cancel")}
        </button>
      </div>
    </div>
  );
}

/** A rail made by two converters is drawn once; the second one names it. */
function OutputsShown({ tree, index, name, label }: { tree: ResolvedTree; index: number; name(s: number): string; label: string }) {
  const names = tree.converters[index].outputs.map(name);
  return names.length ? <span className="muted pt-again"> → {names.join(", ")} ({label})</span> : null;
}
