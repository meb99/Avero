import { useEffect, useMemo, useState } from "react";
import { CloseIcon } from "../components/Icons";
import { useI18n } from "../i18n";
import type { SchematicDocument } from "./document";
import { mappedWords, type PartLinks } from "./mapping";

interface Props {
  docs: SchematicDocument[];
  active: number;
  /** What the board selection looks for, to count it in every document. */
  text?: string;
  /** Its corrections (blocked places do not count). */
  links?: PartLinks;
  onSwitch(index: number): void;
  onAdd(): void;
  onClose(index: number): void;
}

/** Re-renders while any of the documents is still being indexed. */
function useIndexing(docs: SchematicDocument[]): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const offs = docs.map((d) => d.subscribe(() => setRevision((r) => r + 1)));
    return () => offs.forEach((off) => off());
  }, [docs]);
  return revision;
}

/**
 * The documents open for a board (schematics, datasheets, layouts,
 * revisions) as tabs over the page, each with how often the board
 * selection occurs in it. Nothing switches by itself: a name found only in
 * another document is offered with one click, never shown silently from a
 * different revision.
 */
export function DocTabs({ docs, active, text, links, onSwitch, onAdd, onClose }: Props) {
  const { t } = useI18n();
  const revision = useIndexing(docs);
  const counts = useMemo(
    () => docs.map((d) => (text ? mappedWords(d.index, d, text, links).length : 0)),
    // `revision`: more pages searchable.
    [docs, text, links, revision],
  );
  const here = docs[active];
  const hereDone = !!here && here.indexedPages >= here.pageCount;
  const elsewhere = text && hereDone && counts[active] === 0 ? counts.findIndex((n, i) => i !== active && n > 0) : -1;

  return (
    <div className="doc-tabs" role="tablist" aria-label={t("docs.title")}>
      {docs.map((d, i) => (
        <span key={i} className={`doc-tab${i === active ? " active" : ""}`}>
          <button
            role="tab"
            aria-selected={i === active}
            className="doc-tab-name"
            title={d.path ?? d.name}
            onClick={() => onSwitch(i)}
          >
            {d.name.replace(/\.pdf$/i, "")}
            {text && docs.length > 1 && counts[i] > 0 && <span className="doc-count">{counts[i]}</span>}
          </button>
          {docs.length > 1 && (
            <button className="doc-tab-close" onClick={() => onClose(i)} aria-label={t("docs.close", { name: d.name })} title={t("docs.close", { name: d.name })}>
              <CloseIcon />
            </button>
          )}
        </span>
      ))}
      <button className="doc-add" onClick={onAdd} title={t("docs.addHint")} aria-label={t("docs.add")}>
        +
      </button>
      {elsewhere >= 0 && (
        <button className="doc-elsewhere" onClick={() => onSwitch(elsewhere)} title={t("docs.elsewhereHint")}>
          {t("docs.elsewhere", { text: text!, name: docs[elsewhere].name, n: counts[elsewhere] })}
        </button>
      )}
    </div>
  );
}
