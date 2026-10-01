/**
 * Repair knowledge from wiki pages: MediaWiki XML exports (Special:Export)
 * and pages saved from the browser as HTML, turned into simple blocks
 * (headings, paragraphs, lists, tables) that Avero can show and search.
 */

import type { ObdData } from "./obdata";

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "note"; kind: "warning" | "note" | "tip"; text: string }
  | { type: "list"; ordered: boolean; items: string[]; /** Nesting depth per item (1 = top), when nested. */ levels?: number[] }
  | { type: "table"; rows: string[][]; header: boolean; caption?: string }
  | { type: "gallery"; items: GalleryItem[] };

/** A picture on the wiki, e.g. reference measurements on a board photo. */
export interface GalleryItem {
  /** File name on the wiki, without "File:". */
  file: string;
  caption: string;
}

/*
 * Links in block text are kept as LINK_OPEN label LINK_MID target LINK_CLOSE.
 * The target is a URL, or "wiki:Title" for a page of the same wiki.
 */
export const LINK_OPEN = "\u0002";
export const LINK_MID = "\u0003";
export const LINK_CLOSE = "\u0004";
const LINKS = /\u0002([^\u0003]*)\u0003([^\u0004]*)\u0004/g;

const link = (label: string, target: string) => `${LINK_OPEN}${label}${LINK_MID}${target}${LINK_CLOSE}`;

/** Text without link markers: only the labels stay. */
export function plainText(s: string): string {
  return s.replace(LINKS, "$1");
}

/** Text split into plain pieces and links, in order. */
export function textPieces(s: string): ({ text: string } | { text: string; target: string })[] {
  const out: ({ text: string } | { text: string; target: string })[] = [];
  let last = 0;
  for (const m of s.matchAll(LINKS)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[1] || m[2], target: m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export interface WikiPage {
  title: string;
  /** Link to the page on its wiki. */
  url: string;
  categories: string[];
  blocks: Block[];
  /** Last edit on the wiki, ISO date, when known. */
  edited?: string;
  /** License named by the page itself, e.g. "CC BY-SA 3.0". */
  license?: string;
  /** Device the page is about, as the wiki names it (a guide's "Device" field). */
  about?: string;
  /** Known-good values of an OpenBoardData file. */
  obdata?: ObdData;
}

/** "CC BY-SA 3.0" from a link to creativecommons.org/licenses/by-sa/3.0/. */
export function licenseFromUrl(url: string): string | undefined {
  const m = /creativecommons\.org\/licenses\/([a-z-]+)\/(\d\.\d)/i.exec(url);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : undefined;
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

/**
 * Plain text of wiki inline markup; with `links`, links stay as markers
 * (see LINK_OPEN) so they can be opened.
 */
export function inlineText(s: string, links = false): string {
  const wiki = (title: string, label: string) => (links ? link(label, `wiki:${title.trim()}`) : label);
  const web = (url: string, label: string) => (links ? link(label, url.startsWith("//") ? `https:${url}` : url) : label);
  return decodeEntities(
    s
      .replace(/\[\[(?:file|image|datei|bild):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, "")
      // Semantic MediaWiki properties: [[Device::Nintendo Switch]] shows the value.
      .replace(/\[\[[^\]|:]+::([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, value: string, label?: string) => label ?? value)
      .replace(/\[\[:?([^\]|]*)\|([^\]]*)\]\]/g, (_, title: string, label: string) => wiki(title, label))
      .replace(/\[\[:?([^\]]*)\]\]/g, (_, title: string) => wiki(title, title))
      .replace(/\[((?:https?:)?\/\/\S+)\s+([^\]]+)\]/g, (_, url: string, label: string) => web(url, label))
      .replace(/\[((?:https?:)?\/\/\S+)\]/g, (_, url: string) => (links ? url.replace(/^\/\//, "https://") : url.replace(/^(?:https?:)?\/\//, "")))
      .replace(/'{2,5}/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Cells of one wiki table row line (`| a || b` or `! a !! b`), without attributes. */
function cells(line: string, links: boolean): string[] {
  const sep = line.startsWith("!") ? /!!|\|\|/ : /\|\|/;
  return line
    .slice(1)
    .split(sep)
    .map((cell) => {
      // `style="…" | content`: the part after a single `|` is the content.
      const bar = cell.indexOf("|");
      const content = bar >= 0 && !cell.slice(0, bar).includes("[[") ? cell.slice(bar + 1) : cell;
      return inlineText(content, links);
    });
}

/** Removes columns that are empty in every row. */
function dropEmptyColumns(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const keep = Array.from({ length: width }, (_, c) => rows.some((r) => (r[c] ?? "").trim() !== ""));
  return rows.map((r) => r.filter((_, c) => keep[c]));
}

/** Placeholder pictures of the page template ("Example pcb pictures.jpg"). */
const PLACEHOLDER = /^example[\s_]+(pcb|measurement|device)[\s_]+pictures?\.\w+$/i;
/** Image options that are not a caption. */
const IMAGE_OPTION = /^\s*(thumb|thumbnail|frame|frameless|border|left|right|center|centre|none|upright(=.*)?|\d+(x\d+)?px|(alt|link|page|class|lang)=.*)\s*$/i;

function galleryItem(line: string): GalleryItem | null {
  const [first, ...params] = splitParams(line.trim());
  const file = first.replace(/^(?:file|image|datei|bild):/i, "").trim();
  if (!file || !/\.\w{2,5}$/.test(file) || PLACEHOLDER.test(file)) return null;
  const caption = [...params].reverse().find((p) => !IMAGE_OPTION.test(p)) ?? "";
  return { file, caption: inlineText(caption) };
}

/**
 * Drops the template's boilerplate and headings with nothing under them
 * (repair.wiki device pages start with empty "Guides" and picture sections).
 */
function tidy(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const next = out[out.length - 1];
    if (b.type === "heading" && (!next || (next.type === "heading" && next.level <= b.level))) continue;
    // Pictures in a row become one gallery.
    if (b.type === "gallery" && next?.type === "gallery") {
      out[out.length - 1] = { type: "gallery", items: [...b.items, ...next.items] };
      continue;
    }
    out.push(b);
  }
  return out.reverse();
}

/** Blocks and categories of a page's wikitext. */
export function parseWikitext(source: string): { blocks: Block[]; categories: string[]; about?: string } {
  const categories: string[] = [];
  let about: string | undefined;
  const property = /\[\[Device::([^\]|]+)/i.exec(source);
  if (property) about = property[1].trim();
  const notes: Block[] = [];
  const rich = (s: string) => inlineText(s, true);
  const block = (b: Block) => {
    notes.push(b);
    return `\n\u0001${notes.length - 1}\n`;
  };
  let text = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/You can manually link to external sources[^\n]*?etc!?/gi, "")
    .replace(/<gallery[^>]*>([\s\S]*?)<\/gallery>/gi, (_, body: string) => {
      const items = body
        .split("\n")
        .map(galleryItem)
        .filter((i): i is GalleryItem => !!i);
      return items.length ? block({ type: "gallery", items }) : "\n";
    })
    // Pictures on a line of their own; inline ones are dropped with the markup.
    .replace(/^[ \t]*\[\[(?:file|image|datei|bild):((?:[^\][\n]|\[\[[^\]\n]*\]\])*)\]\][ \t]*$/gim, (_, body: string) => {
      const item = galleryItem(body);
      return item ? block({ type: "gallery", items: [item] }) : "";
    })
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
    if (kind && positional.length) return block({ type: "note", kind, text: rich(positional.join(" ")) });
    // Infoboxes: key = value pairs become a small table.
    const pairs = params.map((p) => /^\s*([^=]+?)\s*=\s*([\s\S]*)$/.exec(p)).filter((m): m is RegExpExecArray => !!m && !!m[2].trim());
    // Guides name their device in a field: {{Repair Guide|Device=Nintendo Switch|…}}.
    const device = pairs.find((m) => /^device$/i.test(m[1].trim()));
    if (device && !about) about = inlineText(device[2]);
    if (/infobox|device|specs|guide/i.test(name) && pairs.length)
      return block({ type: "table", header: false, rows: pairs.map((m) => [inlineText(m[1]), rich(m[2])]) });
    return "";
  });

  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[]; levels: number[] } | null = null;
  let table: { rows: string[][]; header: boolean; caption?: string } | null = null;
  const flushParagraph = () => {
    const t = rich(paragraph.join(" "));
    if (t) blocks.push({ type: "paragraph", text: t });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) {
      const { levels, ...rest } = list;
      blocks.push(levels.some((l) => l > 1) ? { type: "list", ...rest, levels } : { type: "list", ...rest });
    }
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (table) {
      const t = line.trim();
      if (t.startsWith("|}")) {
        const rows = dropEmptyColumns(table.rows.filter((r) => r.length));
        if (rows.length) blocks.push({ type: "table", rows, header: table.header, ...(table.caption && { caption: table.caption }) });
        table = null;
      } else if (t.startsWith("|-")) {
        table.rows.push([]);
      } else if (t.startsWith("|+")) {
        const caption = inlineText(t.slice(2));
        if (caption) table.caption = caption;
      } else if (t.startsWith("|") || t.startsWith("!")) {
        if (t.startsWith("!") && table.rows.length <= 1) table.header = true;
        if (table.rows.length === 0) table.rows.push([]);
        table.rows[table.rows.length - 1].push(...cells(t, true));
      } else if (t && table.rows.length) {
        // Continuation of the last cell, often a list of steps.
        const row = table.rows[table.rows.length - 1];
        const bullet = /^[*#]+/.exec(t);
        const piece = bullet ? `${"  ".repeat(bullet[0].length - 1)}• ${rich(t.slice(bullet[0].length))}` : rich(t);
        if (row.length) row[row.length - 1] = row[row.length - 1] ? `${row[row.length - 1]}\n${piece}` : piece;
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
        list = { ordered, items: [], levels: [] };
      }
      const item = rich(line.replace(/^[*#:;]+/, ""));
      if (item) {
        list.items.push(item);
        list.levels.push(/^[*#:;]+/.exec(line)![0].length);
      }
    } else if (/^[;:]/.test(line)) {
      flushList();
      const t = rich(line.replace(/^[;:]+/, ""));
      if (t) blocks.push({ type: "paragraph", text: t });
    } else if (line.trim()) {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return { blocks: tidy(blocks), categories, ...(about && { about }) };
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
    const { blocks, categories, about } = parseWikitext(source);
    if (blocks.length === 0) continue;
    pages.push({
      ...(about && { about }),
      title,
      url: pageUrl(title, base),
      categories,
      blocks,
      edited: last?.getElementsByTagName("timestamp")[0]?.textContent ?? undefined,
    });
  }
  return pages;
}

/** A picture of a saved page: the file it links to and its caption. */
function pictureOf(el: Element, captionSelector: string): GalleryItem | null {
  const href = el.querySelector('a[href*="File:"], a[href*="Datei:"]')?.getAttribute("href") ?? "";
  const m = /(?:File|Datei):([^?#]+)/.exec(href);
  if (!m) return null;
  const file = decodeURIComponent(m[1]).replace(/_/g, " ");
  if (PLACEHOLDER.test(file)) return null;
  const caption = (el.querySelector(captionSelector)?.textContent ?? "").replace(/\s+/g, " ").trim();
  return { file, caption };
}

function elementBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const cls = child.getAttribute("class") ?? "";
      if (/(^|\s)(toc|mw-editsection|reference|navbox|catlinks|printfooter|noprint)(\s|$)/.test(cls) || ["script", "style", "sup"].includes(tag)) continue;
      if (/(^|\s)gallery(\s|$)/.test(cls) || tag === "figure") {
        const boxes = tag === "figure" ? [child] : Array.from(child.querySelectorAll("li.gallerybox"));
        const items = boxes
          .map((box) => pictureOf(box, tag === "figure" ? "figcaption" : ".gallerytext"))
          .filter((i): i is GalleryItem => !!i);
        if (items.length) blocks.push({ type: "gallery", items });
      } else if (/^h[2-6]$/.test(tag)) {
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
  const blocks = tidy(elementBlocks(root));
  if (!title || blocks.length === 0) return null;
  const licenseLink = doc.querySelector('#footer-info-copyright a[href*="creativecommons.org"], a[rel="license"]');
  const license = licenseFromUrl(licenseLink?.getAttribute("href") ?? "");
  return { title, url: canonical || pageUrl(title), categories, blocks, ...(license && { license }) };
}

/** All text of a page, for search. */
export function pageText(page: WikiPage): string {
  return plainText(
    [
      page.title,
      ...page.categories,
      ...page.blocks.map((b) =>
        b.type === "list"
          ? b.items.join(" ")
          : b.type === "table"
            ? b.rows.map((r) => r.join(" ")).join(" ")
            : b.type === "gallery"
              ? b.items.map((i) => `${i.caption} ${i.file}`).join(" ")
              : b.text,
      ),
      // Net names of OpenBoardData, so a search for a net finds the board.
      ...(page.obdata ? [page.obdata.id, ...new Set(page.obdata.nets.map((n) => n.net))] : []),
    ].join(" "),
  );
}

const MEASUREMENT = /measure|reading|diode|voltage|resistance|schematic|messwert|messung/i;

/** Pictures of reference measurements on a page: under such a heading, or captioned so. */
export function measurementPictures(page: WikiPage): GalleryItem[] {
  const out: GalleryItem[] = [];
  let under: number | null = null;
  for (const b of page.blocks) {
    if (b.type === "heading") {
      if (under !== null && b.level <= under) under = null;
      if (under === null && MEASUREMENT.test(b.text)) under = b.level;
    } else if (b.type === "gallery") {
      out.push(...b.items.filter((i) => under !== null || MEASUREMENT.test(i.caption) || MEASUREMENT.test(i.file)));
    }
  }
  return out;
}
