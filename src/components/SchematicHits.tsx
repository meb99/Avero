import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { SchematicDocument } from "../schematic/document";
import {
  blockHit,
  confirmHit,
  docKey,
  forgetRef,
  fromOtherRevision,
  mappedHits,
  mappedWords,
  missingHere,
  pinAt,
  refOf,
  setAliases,
  type DocLinks,
  type PartLinks,
} from "../schematic/mapping";
import { askText } from "./Ask";

interface Props {
  /** The board's documents; the one shown first. */
  docs: SchematicDocument[];
  /** Names to look for, e.g. a net's own name and its name in the file. */
  names: string[];
  onJump(text: string, hit: number, doc: SchematicDocument): void;
  /** A part: its corrections, so they apply and can be made (the mapping table). */
  part?: PartMapping;
}

export interface PartMapping {
  name: string;
  links?: PartLinks;
  /** A pin of the part: which of its places shows it (U3A or U3B). */
  pin?: { number: string; nets: string[] };
  onChange(change: (all: DocLinks | undefined) => DocLinks | undefined): void;
}

interface Group {
  text: string;
  page: number;
  first: number;
  count: number;
}

/** Occurrences in one document, one entry per page (in the order the schematic view uses). */
function groupsIn(doc: SchematicDocument, names: string[], links?: PartLinks): Group[] {
  const out: Group[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Same order as the schematic view uses, so `first` is its hit index.
    mappedWords(doc.index, doc, name, links).forEach((w, i) => {
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
export function SchematicHits({ docs, names, onJump, part }: Props) {
  const { t } = useI18n();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const offs = docs.map((d) => d.subscribe(() => setRevision((r) => r + 1)));
    return () => offs.forEach((off) => off());
  }, [docs]);

  // Callers pass a new array each render; the joined names keep the memo stable.
  const namesKey = names.join("\u0000");
  const links = part?.links;
  const perDoc = useMemo(
    () => docs.map((doc) => ({ doc, groups: groupsIn(doc, namesKey.split("\u0000"), links) })),
    // `revision` changes as more pages become searchable.
    [docs, namesKey, links, revision],
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
      {part && <MappingTable docs={docs} part={part} onJump={onJump} revision={revision} />}
    </section>
  );
}

/**
 * The part's places in every document with where each comes from, which
 * one shows the selected pin, and buttons to confirm a match or block a
 * wrong one; other names of the part; corrections from another revision
 * to check again.
 */
function MappingTable({ docs, part, onJump, revision }: { docs: SchematicDocument[]; part: PartMapping; onJump: Props["onJump"]; revision: number }) {
  const { t } = useI18n();
  const { name, links, pin, onChange } = part;
  const rows = useMemo(
    () =>
      docs.map((doc) => {
        const hits = mappedHits(doc.index, doc, name, links);
        const words = hits.map((h) => h.word);
        const pinHit = pin ? pinAt(doc.index, words, pin.number, pin.nets) : undefined;
        return { doc, hits, pinHit, recheck: [...missingHere(doc.index, doc, links), ...fromOtherRevision(doc.index, doc, links)] };
      }),
    // `revision`: more pages searchable.
    [docs, name, links, pin?.number, pin?.nets.join(), revision],
  );
  const count = rows.reduce((n, r) => n + r.hits.length, 0);
  const blocked = links?.blocked ?? [];
  const docName = (key: string) => docs.find((d) => docKey(d) === key)?.name;
  const addAlias = async () => {
    const alias = await askText(t("mapping.aliasAsk", { part: name }), "", { title: t("mapping.alias") });
    if (alias?.trim()) onChange((all) => setAliases(all, name, [...(links?.aliases ?? []), alias]));
  };

  return (
    <details className="mapping">
      <summary>
        {t("mapping.title")} <span className="muted">{t("mapping.count", { n: count })}</span>
        {rows.some((r) => r.recheck.length > 0) && <span className="mapping-attention"> {t("mapping.recheckBadge")}</span>}
      </summary>
      <p className="muted mapping-hint">{t("mapping.hint")}</p>
      <table className="mapping-table">
        <tbody>
          {rows.flatMap(({ doc, hits, pinHit }) =>
            hits.map((h, i) => (
              <tr key={`${doc.id}:${i}`} className={h.confirmed ? "confirmed" : undefined}>
                {docs.length > 1 && <td className="mapping-doc" title={doc.name}>{doc.name.replace(/\.pdf$/i, "")}</td>}
                <td>{t("details.page", { n: h.word.page + 1 })}</td>
                <td className="mapping-word">{h.word.text}</td>
                <td>
                  <span className={`mapping-source src-${h.source}`} title={t(`mapping.sourceHint.${h.source}`)}>
                    {h.source === "alias" ? t("mapping.source.alias", { name: h.alias ?? "" }) : t(`mapping.source.${h.source}`)}
                  </span>
                  {pinHit === i && pin && <span className="mapping-pin">{t("mapping.pinHere", { pin: pin.number })}</span>}
                </td>
                <td className="mapping-actions">
                  <button className="small" onClick={() => onJump(name, i, doc)} title={t("mapping.show")}>
                    {t("mapping.show")}
                  </button>
                  <button
                    className={`small${h.confirmed ? " on" : ""}`}
                    aria-pressed={h.confirmed}
                    title={t(h.confirmed ? "mapping.unconfirm" : "mapping.confirm")}
                    onClick={() => onChange((all) => confirmHit(all, name, refOf(doc, h.word), !h.confirmed))}
                  >
                    ✓
                  </button>
                  <button className="small" title={t("mapping.block")} onClick={() => onChange((all) => blockHit(all, name, refOf(doc, h.word)))}>
                    ✗
                  </button>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      {rows.map(({ doc, recheck }) =>
        recheck.length === 0 ? null : (
          <div key={doc.id} className="mapping-recheck">
            <strong>{t("mapping.recheck", { name: doc.name })}</strong>
            {recheck.map((r, i) => (
              <div key={i} className="mapping-recheck-row">
                <span>
                  {t(r.kind === "confirmed" ? "mapping.wasConfirmed" : "mapping.wasBlocked", { text: r.ref.text, page: r.ref.page + 1 })}
                  {" — "}
                  {r.found ? t("mapping.foundAgain") : <span className="muted">{t("mapping.notFound")}</span>}
                </span>
                {r.found && (
                  <button
                    className="small"
                    onClick={() =>
                      onChange((all) => (r.kind === "confirmed" ? confirmHit : blockHit)(all, name, refOf(doc, r.found!)))
                    }
                  >
                    {t("mapping.takeOver")}
                  </button>
                )}
                <button className="small" onClick={() => onChange((all) => forgetRef(all, name, r.ref))}>
                  {t("mapping.forget")}
                </button>
              </div>
            ))}
          </div>
        ),
      )}
      {blocked.length > 0 && (
        <div className="mapping-blocked">
          <span className="muted">{t("mapping.blocked")}</span>
          {blocked.map((r, i) => (
            <span key={i} className="pin-chip">
              {r.text} · {t("details.page", { n: r.page + 1 })}
              {(docs.length > 1 || !docName(r.doc)) && (
                <span className="muted"> · {docName(r.doc) ?? t("mapping.otherVersion", { name: r.docName })}</span>
              )}
              <button className="link" onClick={() => onChange((all) => blockHit(all, name, r, false))} title={t("mapping.unblock")}>
                {t("mapping.unblock")}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mapping-aliases">
        <span className="muted">{t("mapping.aliases")}</span>
        {(links?.aliases ?? []).map((a) => (
          <span key={a} className="pin-chip">
            {a}
            <button
              className="link"
              aria-label={t("mapping.aliasRemove", { name: a })}
              onClick={() => onChange((all) => setAliases(all, name, (links?.aliases ?? []).filter((x) => x !== a)))}
            >
              ×
            </button>
          </span>
        ))}
        <button className="small" onClick={() => void addAlias()}>
          {t("mapping.alias")}
        </button>
      </div>
    </details>
  );
}
