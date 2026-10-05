import { useMemo } from "react";
import type { BoardModel } from "../core/board";
import { buildPowerTree, powerTreeRoots, type PowerTree as Tree, type TreeNode } from "../core/powerTree";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import type { SchematicFacts } from "../schematic/partInfo";
import { judge } from "../workbench/diagnosis";
import { formatValue, type Value } from "../workbench/measure";
import { activeCase, type BoardNotes } from "../workbench/notes";

type Status = "ok" | "bad" | "measured" | undefined;

interface Props {
  model: BoardModel;
  notes: BoardNotes | null;
  schematicFacts: SchematicFacts | null;
  onSelect(selection: Selection, zoom: boolean): void;
}

/**
 * Which regulator makes which rail from which, as a tree from the adapter
 * down, with the voltages of the repair case next to each rail. Where a
 * converter's input is there and its output is not, it is named first.
 */
export function PowerTree({ model, notes, schematicFacts, onSelect }: Props) {
  const { t, lang } = useI18n();

  const tree = useMemo(() => {
    const volts = new Map<number, number>();
    if (schematicFacts)
      model.nets.forEach((n, i) => {
        const v = schematicFacts.netVoltages.get(n.name.toUpperCase());
        const parsed = v ? Number.parseFloat(v) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) volts.set(i, parsed);
      });
    return buildPowerTree(model, volts);
  }, [model, schematicFacts]);
  const { roots, unfed } = useMemo(() => powerTreeRoots(tree), [tree]);

  const readings = notes ? activeCase(notes)?.readings : undefined;
  const measured = (supply: number): Value | undefined => {
    for (const net of tree.supplies[supply].nets) {
      const v = readings?.[model.nets[net].name]?.voltage;
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const status = (supply: number): Status => {
    const v = measured(supply);
    if (v === undefined) return undefined;
    const expected = tree.supplies[supply].volts;
    return expected === undefined ? "measured" : judge({ kind: "volts", volts: expected }, v);
  };

  // Converters whose input is there but an output is not: look there first.
  const suspects = tree.converters
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.input !== undefined && status(c.input) === "ok" && c.outputs.some((o) => status(o) === "bad"));

  if (tree.converters.length === 0) return null;

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

  const converterRow = (index: number) => {
    const c = tree.converters[index];
    const p = model.parts[c.part];
    return (
      <span className="pt-converter">
        <span className={`pt-kind pt-kind-${c.kind}`}>{t(`power.kind.${c.kind}`)}</span>
        <button className="link part-name" onClick={() => onSelect({ kind: "part", part: c.part }, true)}>
          {p.name}
        </button>
        {p.device && <span className="muted pt-device">{p.device}</span>}
      </span>
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
              {c.outputs.length > 0 ? <ul>{c.outputs.map((o) => node(o, depth + 1))}</ul> : <OutputsShown model={model} tree={tree} index={c.converter} label={t("power.shownAbove")} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <details className="power-tree" open={suspects.length > 0 || undefined}>
      <summary>
        {t("power.title")} <span className="muted">{t("power.count", { n: tree.converters.length })}</span>
      </summary>
      <p className="muted pt-hint">{t("power.hint")}</p>
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
    </details>
  );
}

/** A rail made by two converters is drawn once; the second one names it. */
function OutputsShown({ model, tree, index, label }: { model: BoardModel; tree: Tree; index: number; label: string }) {
  const names = tree.converters[index].outputs.map((o) => model.nets[tree.supplies[o].nets[0]].name);
  return names.length ? <span className="muted pt-again"> → {names.join(", ")} ({label})</span> : null;
}
