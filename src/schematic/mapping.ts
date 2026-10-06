/**
 * Which places in the documents belong to a board part, as found and as
 * corrected by hand. A hit can be confirmed or blocked (a wrong match, e.g.
 * a note mentioning "U3" in another sense), and a part can have other names
 * in the documents (IC3 for U3, the name in another revision). Corrections
 * are stored per document content, so a new revision of a schematic is
 * never taken as checked unnoticed: its matches are checked again.
 */
import { findPinSpot } from "./pinFind";
import type { Word, WordIndex } from "./textIndex";

/** A place in a document, recognisable in the next session. */
export interface OccurrenceRef {
  /** Content hash of the PDF (its name when there is none). */
  doc: string;
  /** File name, to tell a revision of the same document. */
  docName: string;
  page: number;
  /** Upper-case word as found ("U3A"). */
  text: string;
  /** Centre of the word on the page. */
  x: number;
  y: number;
}

export interface PartLinks {
  /** Other names of the part in the documents. */
  aliases?: string[];
  /** Places confirmed as this part. */
  confirmed?: OccurrenceRef[];
  /** Places that are not this part: never shown for it. */
  blocked?: OccurrenceRef[];
}

/** Corrections per board part (upper-case name). */
export type DocLinks = Record<string, PartLinks>;

/** What a document is known by. */
export interface DocIdentity {
  contentId?: string;
  name: string;
}

export const docKey = (doc: DocIdentity) => doc.contentId ?? `name:${doc.name}`;

const centre = (w: Word) => ({ x: (w.box.x0 + w.box.x1) / 2, y: (w.box.y0 + w.box.y1) / 2 });

export function refOf(doc: DocIdentity, w: Word): OccurrenceRef {
  const c = centre(w);
  return { doc: docKey(doc), docName: doc.name, page: w.page, text: w.key, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 };
}

/** The same word at the same place (a couple of points of slack for rounding). */
export function isAt(ref: OccurrenceRef, key: string, w: Word): boolean {
  if (ref.doc !== key || ref.page !== w.page || ref.text !== w.key) return false;
  const c = centre(w);
  return Math.abs(c.x - ref.x) <= 2 && Math.abs(c.y - ref.y) <= 2;
}

export type HitSource = "name" | "unit" | "alias" | "ocr";

export interface MappedHit {
  word: Word;
  source: HitSource;
  /** The other name it was found under. */
  alias?: string;
  confirmed: boolean;
}

/** Words added from text recognition rather than the PDF's own text. */
export interface OcrAware {
  isRecognised?(w: Word): boolean;
}

/**
 * A part's places in one document after the corrections: blocked ones
 * left out, the part's other names searched too, confirmed ones first.
 */
export function mappedHits(index: WordIndex, doc: DocIdentity & OcrAware, name: string, links?: PartLinks): MappedHit[] {
  const key = docKey(doc);
  const own = name.trim().toUpperCase();
  const seen = new Set<Word>();
  const out: MappedHit[] = [];
  const blocked = (links?.blocked ?? []).filter((r) => r.doc === key);
  const confirmed = (links?.confirmed ?? []).filter((r) => r.doc === key);
  const take = (words: Word[], source: HitSource, alias?: string) => {
    for (const w of words) {
      if (seen.has(w) || blocked.some((r) => isAt(r, key, w))) continue;
      seen.add(w);
      out.push({
        word: w,
        source: doc.isRecognised?.(w) ? "ocr" : source,
        ...(alias && { alias }),
        confirmed: confirmed.some((r) => isAt(r, key, w)),
      });
    }
  };
  // The name itself; its symbol units when every place under the name is blocked (or there is none).
  take(index.find(own), "name");
  if (out.length === 0) take(index.findUnits(own), "unit");
  for (const alias of links?.aliases ?? []) {
    const a = alias.trim().toUpperCase();
    if (a && a !== own) take(index.findPart(a), "alias", a);
  }
  // Confirmed first, the rest in reading order as found.
  return [...out.filter((h) => h.confirmed), ...out.filter((h) => !h.confirmed)];
}

/** Just the words, as the schematic view lists and steps through them. */
export function mappedWords(index: WordIndex, doc: DocIdentity & OcrAware, name: string, links?: PartLinks): Word[] {
  return mappedHits(index, doc, name, links).map((h) => h.word);
}

/** Of a part's places, the ones where a pin is (U3A or U3B: the unit that has pin 5). */
export function pinAt(index: WordIndex, hits: readonly Word[], pin: string, nets: readonly string[]): number | undefined {
  return findPinSpot(index, hits, pin, nets)?.hit;
}

export interface Recheck {
  ref: OccurrenceRef;
  kind: "confirmed" | "blocked";
  /** In the open document now: the same word on the same page, maybe moved. */
  found?: Word;
}

/**
 * Corrections made in another revision of an open document (same file
 * name, other content): each with the word as found now, when it is still
 * there. They are offered for checking, never applied silently.
 */
export function fromOtherRevision(index: WordIndex, doc: DocIdentity, links: PartLinks | undefined): Recheck[] {
  const key = docKey(doc);
  const out: Recheck[] = [];
  for (const kind of ["confirmed", "blocked"] as const) {
    for (const ref of links?.[kind] ?? []) {
      if (ref.doc === key || ref.docName !== doc.name) continue;
      // Already corrected for this revision.
      if ((links?.[kind] ?? []).some((r) => r.doc === key && r.text === ref.text && r.page === ref.page)) continue;
      const near = index
        .find(ref.text)
        .filter((w) => w.page === ref.page)
        .sort((a, b) => Math.hypot(centre(a).x - ref.x, centre(a).y - ref.y) - Math.hypot(centre(b).x - ref.x, centre(b).y - ref.y))[0];
      out.push({ ref, kind, ...(near && { found: near }) });
    }
  }
  return out;
}

// --- changes (pure, for the board notes) --------------------------------------

const without = (list: OccurrenceRef[] | undefined, ref: OccurrenceRef) =>
  (list ?? []).filter((r) => !(r.doc === ref.doc && r.page === ref.page && r.text === ref.text && Math.abs(r.x - ref.x) <= 2 && Math.abs(r.y - ref.y) <= 2));

function tidy(links: PartLinks): PartLinks | undefined {
  const out: PartLinks = {};
  if (links.aliases?.length) out.aliases = links.aliases;
  if (links.confirmed?.length) out.confirmed = links.confirmed;
  if (links.blocked?.length) out.blocked = links.blocked;
  return Object.keys(out).length ? out : undefined;
}

function withPart(all: DocLinks | undefined, part: string, change: (l: PartLinks) => PartLinks): DocLinks | undefined {
  const name = part.trim().toUpperCase();
  const next = { ...all };
  const updated = tidy(change(next[name] ?? {}));
  if (updated) next[name] = updated;
  else delete next[name];
  return Object.keys(next).length ? next : undefined;
}

/** Marks a place as this part (and no longer blocked), or takes the mark back. */
export function confirmHit(all: DocLinks | undefined, part: string, ref: OccurrenceRef, on = true): DocLinks | undefined {
  return withPart(all, part, (l) => ({ ...l, blocked: without(l.blocked, ref), confirmed: on ? [...without(l.confirmed, ref), ref] : without(l.confirmed, ref) }));
}

/** Marks a place as not this part (and no longer confirmed), or takes the mark back. */
export function blockHit(all: DocLinks | undefined, part: string, ref: OccurrenceRef, on = true): DocLinks | undefined {
  return withPart(all, part, (l) => ({ ...l, confirmed: without(l.confirmed, ref), blocked: on ? [...without(l.blocked, ref), ref] : without(l.blocked, ref) }));
}

/** Drops a correction (e.g. one from another revision that no longer applies). */
export function forgetRef(all: DocLinks | undefined, part: string, ref: OccurrenceRef): DocLinks | undefined {
  return withPart(all, part, (l) => ({ ...l, confirmed: without(l.confirmed, ref), blocked: without(l.blocked, ref) }));
}

export function setAliases(all: DocLinks | undefined, part: string, aliases: string[]): DocLinks | undefined {
  const own = part.trim().toUpperCase();
  const clean = [...new Set(aliases.map((a) => a.trim().toUpperCase()).filter((a) => a && a !== own))];
  return withPart(all, part, (l) => ({ ...l, aliases: clean }));
}

const isRef = (v: unknown): v is OccurrenceRef => {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.doc === "string" &&
    typeof r.docName === "string" &&
    typeof r.text === "string" &&
    [r.page, r.x, r.y].every((n) => typeof n === "number" && Number.isFinite(n))
  );
};

/** Stored corrections, checked. */
export function parseDocLinks(value: unknown): DocLinks | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: DocLinks = {};
  for (const [part, v] of Object.entries(value as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const d = v as Record<string, unknown>;
    const links = tidy({
      aliases: Array.isArray(d.aliases) ? d.aliases.filter((a): a is string => typeof a === "string" && a.length > 0) : undefined,
      confirmed: Array.isArray(d.confirmed) ? d.confirmed.filter(isRef) : undefined,
      blocked: Array.isArray(d.blocked) ? d.blocked.filter(isRef) : undefined,
    });
    if (links) out[part.toUpperCase()] = links;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Corrections for this very document whose word is not there (yet: recognised text may still come). */
export function missingHere(index: WordIndex, doc: DocIdentity, links: PartLinks | undefined): Recheck[] {
  const key = docKey(doc);
  const out: Recheck[] = [];
  for (const kind of ["confirmed", "blocked"] as const) {
    for (const ref of links?.[kind] ?? []) {
      if (ref.doc !== key) continue;
      if (!index.find(ref.text).some((w) => isAt(ref, key, w))) out.push({ ref, kind });
    }
  }
  return out;
}
