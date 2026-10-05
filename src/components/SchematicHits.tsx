import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { SchematicDocument } from "../schematic/document";

interface Props {
  /** The board's documents; the one shown first. */
  docs: SchematicDocument[];
  /** Names to look for, e.g. a net's own name and its name in the file. */
  names: string[];
  onJump(text: string, hit: number, doc: SchematicDocument): void;
}

interface Group {
  text: string;
  page: number;
  first: number;
  count: number;
}

/** Occurrences in one document, one entry per page (in the order the schematic view uses). */
function groupsIn(doc: SchematicDocument, names: string[]): Group[] {
  const out: Group[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Same order as the schematic view uses, so `first` is its hit index.
    doc.index.findPart(name).forEach((w, i) => {
      const last = out[out.length - 1];
      if (last && last.text === name && last.page === w.page) last.count++;
      else out.push({ text: name, page: w.page, first: i, count: 1 });
    });
  }
  return out;
}

/**
 * Where a part or net appears in the board's documents: one button per
 * page, each jumping to the first occurrence there (in another document:
 * showing that one). Updates while pages are indexed.
 */
export function SchematicHits({ docs, names, onJump }: Props) {
  const { t } = useI18n();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const offs = docs.map((d) => d.subscribe(() => setRevision((r) => r + 1)));
    return () => offs.forEach((off) => off());
  }, [docs]);

  // Callers pass a new array each render; the joined names keep the memo stable.
  const namesKey = names.join("\u0000");
  const perDoc = useMemo(
    () => docs.map((doc) => ({ doc, groups: groupsIn(doc, namesKey.split("\u0000")) })),
    // `revision` changes as more pages become searchable.
    [docs, namesKey, revision],
  );

  const indexed = docs.reduce((n, d) => n + d.indexedPages, 0);
  const total = docs.reduce((n, d) => n + d.pageCount, 0);
  const complete = indexed >= total;
  const several = docs.length > 1;
  const chips = (doc: SchematicDocument, groups: Group[]) => (
    <div className="pin-chips">
      {groups.map((g) => (
        <button key={`${g.text}:${g.page}`} className="pin-chip" title={g.text} onClick={() => onJump(g.text, g.first, doc)}>
          {t("details.page", { n: g.page + 1 })}
          {g.count > 1 && <span className="muted"> ×{g.count}</span>}
          {names.length > 1 && g.text !== names[0] && <span className="muted"> · {g.text}</span>}
        </button>
      ))}
    </div>
  );
  const found = perDoc.filter((d) => d.groups.length > 0);
  return (
    <section className="details-section schematic-hits">
      <h3>
        {t("details.inSchematic")} {!complete && <span className="muted">{t("details.indexing", { done: indexed, total })}</span>}
      </h3>
      {found.length === 0
        ? complete && <p className="muted">{t("details.notInSchematic")}</p>
        : several
          ? found.map(({ doc, groups }) => (
              <div key={doc.id} className="hits-doc">
                <div className="hits-doc-name muted" title={doc.path ?? doc.name}>
                  {doc.name}
                </div>
                {chips(doc, groups)}
              </div>
            ))
          : chips(found[0].doc, found[0].groups)}
    </section>
  );
}
