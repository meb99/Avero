import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { SchematicDocument } from "../schematic/document";

interface Props {
  doc: SchematicDocument;
  /** Names to look for, e.g. a net's own name and its name in the file. */
  names: string[];
  onJump(text: string, hit: number): void;
}

/**
 * Where a part or net appears in the open schematic: one button per page,
 * each jumping to the first occurrence there. Updates while pages are indexed.
 */
export function SchematicHits({ doc, names, onJump }: Props) {
  const { t } = useI18n();
  const [indexed, setIndexed] = useState(doc.indexedPages);
  useEffect(() => {
    setIndexed(doc.indexedPages);
    return doc.subscribe(() => setIndexed(doc.indexedPages));
  }, [doc]);

  // Callers pass a new array each render; the joined names keep the memo stable.
  const namesKey = names.join("\u0000");
  const groups = useMemo(() => {
    const names = namesKey.split("\u0000");
    const out: { text: string; page: number; first: number; count: number }[] = [];
    const seen = new Set<string>();
    for (const name of names) {
      const key = name.trim().toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Same order as the schematic view uses, so `first` is its hit index.
      doc.index.find(name).forEach((w, i) => {
        const last = out[out.length - 1];
        if (last && last.text === name && last.page === w.page) last.count++;
        else out.push({ text: name, page: w.page, first: i, count: 1 });
      });
    }
    return out;
    // `indexed` changes as more pages become searchable.
  }, [doc, namesKey, indexed]);

  const complete = indexed >= doc.pageCount;
  return (
    <section className="details-section schematic-hits">
      <h3>
        {t("details.inSchematic")}{" "}
        {!complete && <span className="muted">{t("details.indexing", { done: indexed, total: doc.pageCount })}</span>}
      </h3>
      {groups.length === 0 ? (
        complete && <p className="muted">{t("details.notInSchematic")}</p>
      ) : (
        <div className="pin-chips">
          {groups.map((g) => (
            <button
              key={`${g.text}:${g.page}`}
              className="pin-chip"
              title={g.text}
              onClick={() => onJump(g.text, g.first)}
            >
              {t("details.page", { n: g.page + 1 })}
              {g.count > 1 && <span className="muted"> ×{g.count}</span>}
              {names.length > 1 && g.text !== names[0] && <span className="muted"> · {g.text}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
