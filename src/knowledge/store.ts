import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFileBytes } from "../core/loader";
import { guessCategory, type Category } from "../workbench/catalog";
import { OBD_LICENSE, OBD_SITE, isObdata, parseObdata } from "./obdata";
import { pageText, parseExport, parseSavedHtml, withLocalPictures, type Block, type WikiPage } from "./wikitext";

/** A wiki page in Avero's knowledge base, with the device it is about. */
export interface KnowledgePage extends WikiPage {
  device: Category;
  /** When it was imported into Avero. */
  imported: string;
  /** Site name and license, shown with the page. */
  source: string;
  license: string;
  /** Ships with Avero (reference values); cannot be removed. */
  builtin?: boolean;
}

export interface KnowledgeBase {
  version: 1;
  pages: KnowledgePage[];
}

export const EMPTY_KNOWLEDGE: KnowledgeBase = { version: 1, pages: [] };

/** License of a site's pages when the file does not say (XML exports). */
const LICENSES: Record<string, string> = { "repair.wiki": "CC BY-SA 3.0", "openboarddata.org": OBD_LICENSE };

function sourceOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The device a page is about: from the guide's device field, its title and categories, else its text. */
export function deviceOf(page: WikiPage): Category {
  if (page.about) {
    const about = guessCategory([page.about]);
    if (about.brand) return about;
  }
  const named = guessCategory([page.title, ...page.categories]);
  return named.brand ? named : guessCategory([pageText(page).slice(0, 4000)], { strict: true });
}

export function toKnowledge(page: WikiPage, now = new Date().toISOString()): KnowledgePage {
  const source = sourceOf(page.url) || "wiki";
  return { ...page, device: deviceOf(page), imported: now, source, license: page.license ?? LICENSES[source] ?? "" };
}

/** Adds pages; a page with the same title and source replaces the old one. */
export function mergeKnowledge(base: KnowledgeBase, pages: KnowledgePage[]): KnowledgeBase {
  const key = (p: KnowledgePage) => `${p.source}\u0000${p.title.toLowerCase()}`;
  const byKey = new Map(base.pages.map((p) => [key(p), p]));
  for (const p of pages) byKey.set(key(p), p);
  return { version: 1, pages: [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title)) };
}

/** Marker of an export without pages; the UI shows its own text for it. */
export const EMPTY_EXPORT = "the export contains no pages";

/** The imported pages together with Avero's own reference pages. */
export function withBuiltin(base: KnowledgeBase, builtin: KnowledgePage[]): KnowledgeBase {
  return mergeKnowledge({ version: 1, pages: builtin }, base.pages);
}

/** An OpenBoardData file as a page: what it holds, its diagnosis notes, and the values for the board. */
export function obdataPage(text: string): WikiPage {
  const { data, blocks } = parseObdata(text);
  const count = (kind: string) => data.nets.filter((n) => n.kind === kind).length;
  const nets = new Set(data.nets.filter((n) => n.kind === "d" || n.kind === "v" || n.kind === "r").map((n) => n.net)).size;
  const intro: Block[] = [
    {
      type: "paragraph",
      text: `OpenBoardData für ${data.id} – Netze: ${nets} · Diodenwerte: ${count("d")} · Spannungen: ${count("v")} · Widerstände: ${count("r")} · Bauteile mit Werten: ${new Set(data.parts.map((p) => p.part)).size}. Die Messwerte erscheinen beim Anklicken eines Netzes, sobald diese Daten dem Board zugeordnet sind – automatisch, wenn die Boardnummer im Dateinamen steht, sonst mit „Diesem Board zuordnen“.`,
    },
    {
      type: "note",
      kind: "note",
      text: "Von der Community gesammelte Werte bekannt guter Boards (ODbL). Einzelne Einträge können Tippfehler enthalten – weicht ein Wert stark ab, mit einem zweiten Messwert (z. B. Diode und Spannung) gegenprüfen.",
    },
  ];
  return {
    title: `OpenBoardData ${data.id}`,
    url: `${OBD_SITE}/?a=showboardsolutions&bpath=${data.path}`,
    categories: [data.category, data.brand].filter(Boolean),
    blocks: [...intro, ...blocks],
    license: OBD_LICENSE,
    obdata: data,
  };
}

/** The OpenBoardData for the board in view: the one chosen by hand, else the one whose ID is a board number of the file. */
export function obdataFor(base: KnowledgeBase, boardNumbers: string[], chosen?: string): KnowledgePage | undefined {
  const withData = base.pages.filter((p) => p.obdata);
  if (chosen) return withData.find((p) => p.obdata!.id.toLowerCase() === chosen.toLowerCase());
  const numbers = new Set(boardNumbers.map((n) => n.toLowerCase()));
  return withData.find((p) => numbers.has(p.obdata!.id.toLowerCase()));
}

/** Pages of an export or saved page, whichever the text is. */
export function parseKnowledgeFile(text: string, fileName: string): WikiPage[] {
  if (isObdata(text)) return [obdataPage(text)];
  const head = text.slice(0, 2000).toLowerCase();
  if (head.includes("<mediawiki")) {
    const pages = parseExport(text);
    // Special:Export without "Add" clicked gives a file with only <siteinfo>.
    if (pages.length === 0) throw new Error(`${fileName}: ${EMPTY_EXPORT}`);
    return pages;
  }
  if (head.includes("<html") || head.includes("<!doctype html")) {
    const page = parseSavedHtml(text, fileName);
    return page ? [page] : [];
  }
  throw new Error(`${fileName}: neither a wiki export (XML), a saved page (HTML) nor OpenBoardData (.obdata)`);
}

export async function loadKnowledge(): Promise<KnowledgeBase> {
  const json = await invoke<string | null>("load_knowledge");
  if (!json) return EMPTY_KNOWLEDGE;
  try {
    const d = JSON.parse(json) as KnowledgeBase;
    return d.version === 1 && Array.isArray(d.pages) ? d : EMPTY_KNOWLEDGE;
  } catch {
    return EMPTY_KNOWLEDGE;
  }
}

export function saveKnowledge(base: KnowledgeBase): Promise<void> {
  return invoke("save_knowledge", { data: JSON.stringify(base) });
}

/** Asks for export or HTML files and reads their pages. */
export async function pickKnowledgeFiles(title: string): Promise<{ pages: KnowledgePage[]; errors: string[] }> {
  const picked = await open({
    title,
    multiple: true,
    directory: false,
    filters: [{ name: "Wiki, OpenBoardData", extensions: ["xml", "html", "htm", "obdata"] }],
  });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  const pages: KnowledgePage[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const name = path.split("/").pop() ?? path;
    try {
      const text = new TextDecoder().decode(await readFileBytes(path));
      for (const page of parseKnowledgeFile(text, name)) {
        // Pages saved "complete" bring their pictures: keep a copy for offline use.
        const offline = await withLocalPictures(page, path, (files) =>
          invoke<(string | null)[]>("import_knowledge_images", { paths: files }).catch(() => files.map(() => null)),
        );
        pages.push(toKnowledge(offline));
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { pages, errors };
}

const same = (a: string, b: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const sameFamily = (a: Category, b: Category) => same(a.brand, b.brand) && same(a.family, b.family);
/** Pages of another model of the family (Switch Lite for a Switch OLED). */
const otherModel = (page: Category, device: Category) => sameFamily(page, device) && !!page.model && !!device.model && !same(page.model, device.model);

/**
 * Pages for the board in view, best first: same model, or the family as a
 * whole; pages naming the board number (EDM-020, 820-02100) rank highest.
 */
export function pagesForBoard(base: KnowledgeBase, device: Category, boardNumbers: string[]): KnowledgePage[] {
  const numbers = boardNumbers.map((n) => n.toUpperCase()).filter((n) => n.length >= 5);
  const scored = base.pages.map((p) => {
    let score = 0;
    if (sameFamily(p.device, device) && !otherModel(p.device, device)) {
      score += 2;
      if (same(p.device.model, device.model)) score += 2;
    }
    if (numbers.length) {
      const text = pageText(p).toUpperCase();
      if (numbers.some((n) => text.includes(n))) score += 3;
    }
    return { p, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.p.title.localeCompare(b.p.title))
    .map((s) => s.p);
}

/** Pages of the other models of the board's device family, not already shown for it. */
export function relatedPages(base: KnowledgeBase, device: Category, shown: KnowledgePage[]): KnowledgePage[] {
  const skip = new Set(shown);
  return base.pages.filter((p) => !skip.has(p) && otherModel(p.device, device));
}

/** Pages containing every word of the query. */
export function searchKnowledge(base: KnowledgeBase, query: string, limit = 100): KnowledgePage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return base.pages
    .filter((p) => {
      const text = pageText(p).toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .slice(0, limit);
}
