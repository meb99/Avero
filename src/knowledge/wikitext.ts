/**
 * Repair knowledge from wiki pages: MediaWiki XML exports (Special:Export)
 * and pages saved from the browser as HTML, turned into simple blocks
 * (headings, paragraphs, lists, tables) that Avero can show and search.
 */

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "note"; kind: "warning" | "note" | "tip"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; rows: string[][]; header: boolean };

export interface WikiPage {
  title: string;
  /** Link to the page on its wiki. */
  url: string;
  categories: string[];
  blocks: Block[];
  /** Last edit on the wiki, ISO date, when known. */
  edited?: string;
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", deg: "°", ohm: "Ω", micro: "µ" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Template parameters: split at `|`, except inside `[[link|label]]`. */
function splitParams(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith("[[", i)) depth++;
    else if (body.startsWith("]]", i) && depth > 0) depth--;
    if (body[i] === "|" && depth === 0) {
      out.push(current);
      current = "";
    } else current += body[i];
  }
  out.push(current);
  return out;
}

/** Removes `{{…}}` templates, innermost first, handing each to `keep`. */
function stripTemplates(text: string, keep: (name: string, params: string[]) => string): string {
  let out = text;
  for (let guard = 0; guard < 50 && out.includes("{{"); guard++) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const [name, ...params] = splitParams(body);
      return keep(name.trim(), params);
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

const NOTE_TEMPLATES: Record<string, "warning" | "note" | "tip"> = {
  warning: "warning",
  caution: "warning",
  danger: "warning",
  note: "note",
  info: "note",
  tip: "tip",
  hint: "tip",
};

/** Plain text of wiki inline markup. */
export function inlineText(s: string): string {
  return decodeEntities(
    s
      .replace(/\[\[(?:file|image|datei|bild):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, "")
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, "$1")
      .replace(/\[(?:https?:)?\/\/(\S+)\]/g, "$1")
      .replace(/'{2,5}/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Cells of one wiki table row line (`| a || b` or `! a !! b`), without attributes. */
function cells(line: string): string[] {
  const sep = line.startsWith("!") ? /!!|\|\|/ : /\|\|/;
  return line
    .slice(1)
    .split(sep)
    .map((cell) => {
      // `style="…" | content`: the part after a single `|` is the content.
      const bar = cell.indexOf("|");
      const content = bar >= 0 && !cell.slice(0, bar).includes("[[") ? cell.slice(bar + 1) : cell;
      return inlineText(content);
    });
}

/** Blocks and categories of a page's wikitext. */
export function parseWikitext(source: string): { blocks: Block[]; categories: string[] } {
  const categories: string[] = [];
  const notes: Block[] = [];
  let text = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/__[A-Z]+__/g, "")
    .replace(/\[\[(?:category|kategorie):([^\]|]+)(?:\|[^\]]*)?\]\]/gi, (_, cat: string) => {
      categories.push(cat.trim());
      return "";
    });
  text = stripTemplates(text, (name, params) => {
    const kind = NOTE_TEMPLATES[name.toLowerCase()];
    const positional = params.filter((p) => !/^\s*\w+\s*=/.test(p));
    if (kind && positional.length) {
      notes.push({ type: "note", kind, text: inlineText(positional.join(" ")) });
      return `\n\u0001${notes.length - 1}\n`;
    }
    // Infoboxes: key = value pairs become a small table.
    const pairs = params.map((p) => /^\s*([^=]+?)\s*=\s*([\s\S]*)$/.exec(p)).filter((m): m is RegExpExecArray => !!m && !!m[2].trim());
    if (/infobox|device|specs/i.test(name) && pairs.length) {
      notes.push({ type: "table", header: false, rows: pairs.map((m) => [inlineText(m[1]), inlineText(m[2])]) });
      return `\n\u0001${notes.length - 1}\n`;
    }
    return "";
  });

  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: { rows: string[][]; header: boolean } | null = null;
  const flushParagraph = () => {
    const t = inlineText(paragraph.join(" "));
    if (t) blocks.push({ type: "paragraph", text: t });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push({ type: "list", ...list });
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (table) {
      const t = line.trim();
      if (t.startsWith("|}")) {
        if (table.rows.length) blocks.push({ type: "table", rows: table.rows.filter((r) => r.length), header: table.header });
        table = null;
      } else if (t.startsWith("|-")) {
        table.rows.push([]);
      } else if (t.startsWith("|+")) {
        // Caption: ignore.
      } else if (t.startsWith("|") || t.startsWith("!")) {
        if (t.startsWith("!") && table.rows.length <= 1) table.header = true;
        if (table.rows.length === 0) table.rows.push([]);
        table.rows[table.rows.length - 1].push(...cells(t));
      } else if (t && table.rows.length) {
        // Continuation of the last cell.
        const row = table.rows[table.rows.length - 1];
        if (row.length) row[row.length - 1] = `${row[row.length - 1]} ${inlineText(t)}`.trim();
      }
      continue;
    }
    const heading = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
    const marker = /^\u0001(\d+)$/.exec(line.trim());
    if (heading || marker || line.trim().startsWith("{|") || !line.trim()) {
      flushParagraph();
      flushList();
    }
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: inlineText(heading[2]) });
    } else if (marker) {
      blocks.push(notes[Number(marker[1])]);
    } else if (line.trim().startsWith("{|")) {
      table = { rows: [], header: false };
    } else if (/^[*#]+/.test(line)) {
      flushParagraph();
      const ordered = line.startsWith("#");
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      const item = inlineText(line.replace(/^[*#:;]+/, ""));
      if (item) list.items.push(item);
    } else if (/^[;:]/.test(line)) {
      flushList();
      const t = inlineText(line.replace(/^[;:]+/, ""));
      if (t) blocks.push({ type: "paragraph", text: t });
    } else if (line.trim()) {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return { blocks, categories };
}

const BASE = "https://repair.wiki/w/";

export function pageUrl(title: string, base = BASE): string {
  return base + encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/");
}

/** Pages of a MediaWiki XML export (Special:Export). */
export function parseExport(xml: string): WikiPage[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("not a wiki export (XML)");
  // The export names the wiki's own address; fall back to repair.wiki.
  const base = doc.querySelector("siteinfo > base")?.textContent?.replace(/[^/]*$/, "") || BASE;
  const pages: WikiPage[] = [];
  for (const page of Array.from(doc.getElementsByTagName("page"))) {
    const title = page.getElementsByTagName("title")[0]?.textContent?.trim();
    const ns = page.getElementsByTagName("ns")[0]?.textContent?.trim();
    const revisions = Array.from(page.getElementsByTagName("revision"));
    const last = revisions[revisions.length - 1];
    const source = last?.getElementsByTagName("text")[0]?.textContent ?? "";
    // Main articles only; redirects carry no content.
    if (!title || (ns && ns !== "0") || /^#redirect/i.test(source.trim())) continue;
    const { blocks, categories } = parseWikitext(source);
    if (blocks.length === 0) continue;
    pages.push({
      title,
      url: pageUrl(title, base),
      categories,
      blocks,
      edited: last?.getElementsByTagName("timestamp")[0]?.textContent ?? undefined,
    });
  }
  return pages;
}

function elementBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const cls = child.getAttribute("class") ?? "";
      if (/(^|\s)(toc|mw-editsection|reference|navbox|catlinks|printfooter|noprint)(\s|$)/.test(cls) || ["script", "style", "sup", "figure"].includes(tag)) continue;
      if (/^h[2-6]$/.test(tag)) {
        const t = text(child).replace(/\[\s*(edit|bearbeiten)[^\]]*\]/gi, "").trim();
        if (t) blocks.push({ type: "heading", level: Number(tag[1]), text: t });
      } else if (tag === "p") {
        const t = text(child);
        if (t) blocks.push({ type: "paragraph", text: t });
      } else if (tag === "ul" || tag === "ol") {
        const items = Array.from(child.children)
          .filter((li) => li.tagName.toLowerCase() === "li")
          .map(text)
          .filter(Boolean);
        if (items.length) blocks.push({ type: "list", ordered: tag === "ol", items });
      } else if (tag === "table") {
        const rows = Array.from(child.querySelectorAll("tr"))
          .map((tr) => Array.from(tr.children).map(text))
          .filter((r) => r.some(Boolean));
        if (rows.length) blocks.push({ type: "table", rows, header: !!child.querySelector("th") });
      } else if (tag === "div" || tag === "section" || tag === "blockquote" || tag === "dl") {
        walk(child);
      }
    }
  };
  walk(root);
  return blocks;
}

/** A wiki page saved from the browser ("Web page, HTML only"). */
export function parseSavedHtml(html: string, fileName = ""): WikiPage | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("#mw-content-text .mw-parser-output") ?? doc.querySelector("#mw-content-text") ?? doc.body;
  if (!root) return null;
  const heading = doc.querySelector("#firstHeading")?.textContent?.trim();
  const title = heading || doc.title.replace(/\s+[-–|]\s+[^-–|]*$/, "").trim() || fileName.replace(/\.[^.]+$/, "");
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const categories = Array.from(doc.querySelectorAll("#catlinks a"))
    .map((a) => a.textContent?.trim() ?? "")
    .filter((c) => c && !/^(categories|kategorien)$/i.test(c));
  const blocks = elementBlocks(root);
  if (!title || blocks.length === 0) return null;
  return { title, url: canonical || pageUrl(title), categories, blocks };
}

/** All text of a page, for search. */
export function pageText(page: WikiPage): string {
  return [
    page.title,
    ...page.categories,
    ...page.blocks.map((b) =>
      b.type === "list" ? b.items.join(" ") : b.type === "table" ? b.rows.map((r) => r.join(" ")).join(" ") : b.text,
    ),
  ].join(" ");
}
