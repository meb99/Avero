import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { planFor, schematicWords, type SortPlan } from "../workbench/autosort";
import type { TreeNode } from "../workbench/catalog";
import { moveLibraryFiles, type LibraryEntry } from "../workbench/library";
import { Dialog } from "./Dialogs";

interface Props {
  /** Unsorted entries of the own library. */
  entries: LibraryEntry[];
  tree: TreeNode[];
  onDone(changed: boolean): void;
}

/** Moves the files of each plan into its category folder. Returns the number moved. */
export async function applyPlans(plans: SortPlan[]): Promise<{ moved: number; errors: string[] }> {
  let moved = 0;
  const errors: string[] = [];
  for (const plan of plans) {
    const e = plan.entry;
    try {
      await moveLibraryFiles(
        [...e.boards, ...e.schematics, ...e.unsupported].map((f) => f.path),
        plan.target,
      );
      moved++;
    } catch (err) {
      errors.push(`${e.title}: ${String(err)}`);
    }
  }
  return { moved, errors };
}

/**
 * Sorts everything not yet in a category: a preview of where each board
 * goes (from its names, or its schematic text), then one click to apply.
 */
export function AutoSortDialog({ entries, tree, onDone }: Props) {
  const { t } = useI18n();
  const [plans, setPlans] = useState<Map<string, SortPlan>>(() => {
    const m = new Map<string, SortPlan>();
    for (const e of entries) {
      const p = planFor(e, tree);
      if (p) m.set(e.key, p);
    }
    return m;
  });
  const [checked, setChecked] = useState<Set<string>>(() => new Set(plans.keys()));
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const stopped = useRef(false);

  // Boards whose names say nothing: read their schematics, one after another.
  useEffect(() => {
    const todo = entries.filter((e) => !plans.has(e.key) && e.schematics.length > 0);
    if (todo.length === 0) return;
    stopped.current = false;
    void (async () => {
      for (let i = 0; i < todo.length && !stopped.current; i++) {
        setReading({ done: i, total: todo.length });
        const words = await schematicWords(todo[i], () => stopped.current);
        const plan = planFor(todo[i], tree, words);
        if (plan && !stopped.current) {
          setPlans((m) => new Map(m).set(todo[i].key, plan));
          setChecked((s) => new Set(s).add(todo[i].key));
        }
      }
      setReading(null);
    })();
    return () => {
      stopped.current = true;
    };
    // Once per opening; the entries do not change while the dialog is open.
  }, []);

  const unknown = useMemo(() => entries.filter((e) => !plans.has(e.key)), [entries, plans]);

  const apply = async () => {
    setBusy(true);
    stopped.current = true;
    const chosen = [...plans.values()].filter((p) => checked.has(p.entry.key));
    const result = await applyPlans(chosen);
    if (result.errors.length) {
      setErrors(result.errors);
      setBusy(false);
      return;
    }
    onDone(result.moved > 0);
  };

  return (
    <Dialog title={t("autosort.title")} onClose={() => onDone(false)} className="autosort-dialog">
      <p className="muted">{t("autosort.hint")}</p>
      {reading && <p className="muted">{t("autosort.reading", { done: reading.done + 1, total: reading.total })}</p>}
      {errors.map((e) => (
        <p key={e} className="library-warn">
          {e}
        </p>
      ))}
      {plans.size === 0 && !reading ? (
        <p className="library-empty">{t("autosort.nothing")}</p>
      ) : (
        <ul className="autosort-list">
          {[...plans.values()].map((p) => (
            <li key={p.entry.key}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={checked.has(p.entry.key)}
                  onChange={() =>
                    setChecked((s) => {
                      const n = new Set(s);
                      if (n.has(p.entry.key)) n.delete(p.entry.key);
                      else n.add(p.entry.key);
                      return n;
                    })
                  }
                />
                <span className="autosort-name">{p.entry.title}</span>
              </label>
              <span className="autosort-target">→ {p.target.split("/").join(" › ")}</span>
              {p.from === "schematic" && <span className="muted">{t("autosort.fromSchematic")}</span>}
            </li>
          ))}
        </ul>
      )}
      {unknown.length > 0 && !reading && (
        <details className="autosort-unknown">
          <summary className="muted">{t("autosort.unknown", { n: unknown.length })}</summary>
          <ul>
            {unknown.map((e) => (
              <li key={e.key}>{e.title}</li>
            ))}
          </ul>
        </details>
      )}
      <footer className="dialog-footer">
        <button onClick={() => onDone(false)}>{t("photo.cancel")}</button>
        <button className="primary" disabled={busy || checked.size === 0} onClick={() => void apply()}>
          {t("autosort.apply", { n: [...checked].filter((k) => plans.has(k)).length })}
        </button>
      </footer>
    </Dialog>
  );
}
