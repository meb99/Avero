// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { inlineText, pageText, parseExport, parseSavedHtml, parseWikitext } from "./wikitext";

describe("parseWikitext", () => {
  it("turns headings, lists, tables, notes and links into blocks", () => {
    const src = `{{Infobox device|name=PlayStation 5|board=EDM-020}}
Intro with a [[PS5 HDMI Port Replacement|HDMI guide]] and '''bold''' text.<ref>source</ref>
== Diagnosis ==
{{Warning|Unplug the console first.}}
# Measure PP_VDD_SOC in diode mode
# Check fuse F4001
* bullet
{| class="wikitable"
! Rail !! Diode
|-
| PP3V3 || 0.420
|-
| style="color:red" | PP1V8 || OL
|}
[[Category:PlayStation 5]]
[[File:board.jpg|thumb|caption]]`;
    const { blocks, categories } = parseWikitext(src);
    expect(categories).toEqual(["PlayStation 5"]);
    expect(blocks[0]).toEqual({ type: "table", header: false, rows: [["name", "PlayStation 5"], ["board", "EDM-020"]] });
    expect(blocks[1]).toEqual({ type: "paragraph", text: "Intro with a HDMI guide and bold text." });
    expect(blocks[2]).toEqual({ type: "heading", level: 2, text: "Diagnosis" });
    expect(blocks[3]).toEqual({ type: "note", kind: "warning", text: "Unplug the console first." });
    expect(blocks[4]).toEqual({ type: "list", ordered: true, items: ["Measure PP_VDD_SOC in diode mode", "Check fuse F4001"] });
    expect(blocks[5]).toEqual({ type: "list", ordered: false, items: ["bullet"] });
    expect(blocks[6]).toEqual({ type: "table", header: true, rows: [["Rail", "Diode"], ["PP3V3", "0.420"], ["PP1V8", "OL"]] });
  });

  it("keeps piped links inside note templates", () => {
    const { blocks } = parseWikitext("{{Warning|Check [[PP3V3_G3H|the G3H rail]] first}}");
    expect(blocks).toEqual([{ type: "note", kind: "warning", text: "Check the G3H rail first" }]);
  });

  it("decodes entities and external links", () => {
    expect(inlineText("[https://x.org/a the site] 5&nbsp;V &amp; more")).toBe("the site 5 V & more");
  });
});

describe("parseExport", () => {
  it("reads main pages of a Special:Export file and skips redirects", () => {
    const xml = `<mediawiki><siteinfo><base>https://repair.wiki/w/Main_Page</base></siteinfo>
<page><title>PS5 No Power</title><ns>0</ns><revision><timestamp>2025-01-02T00:00:00Z</timestamp><text>== Steps ==
* Check fuse</text></revision></page>
<page><title>Old</title><ns>0</ns><revision><text>#REDIRECT [[PS5 No Power]]</text></revision></page>
<page><title>Talk:X</title><ns>1</ns><revision><text>hi</text></revision></page></mediawiki>`;
    const pages = parseExport(xml);
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe("PS5 No Power");
    expect(pages[0].url).toBe("https://repair.wiki/w/PS5_No_Power");
    expect(pages[0].edited).toBe("2025-01-02T00:00:00Z");
    expect(pageText(pages[0])).toContain("Check fuse");
  });
});

describe("parseSavedHtml", () => {
  it("reads a wiki page saved from the browser", () => {
    const html = `<html><head><title>Switch No Charge - Repair Wiki</title><link rel="canonical" href="https://repair.wiki/w/Switch_No_Charge"></head>
<body><h1 id="firstHeading">Switch No Charge</h1><div id="mw-content-text"><div class="mw-parser-output">
<p>Check the M92T36.</p><h2>Steps<span class="mw-editsection">[edit]</span></h2><ol><li>Measure VBUS</li></ol>
<table><tr><th>Net</th><th>Value</th></tr><tr><td>VSYS</td><td>0.35</td></tr></table></div></div>
<div id="catlinks"><a>Categories</a><a>Nintendo Switch</a></div></body></html>`;
    const page = parseSavedHtml(html)!;
    expect(page.title).toBe("Switch No Charge");
    expect(page.url).toBe("https://repair.wiki/w/Switch_No_Charge");
    expect(page.categories).toEqual(["Nintendo Switch"]);
    expect(page.blocks).toEqual([
      { type: "paragraph", text: "Check the M92T36." },
      { type: "heading", level: 2, text: "Steps" },
      { type: "list", ordered: true, items: ["Measure VBUS"] },
      { type: "table", header: true, rows: [["Net", "Value"], ["VSYS", "0.35"]] },
    ]);
  });
});
