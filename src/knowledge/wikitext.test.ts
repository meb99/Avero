// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  inlineText,
  measurementPictures,
  pageText,
  parseExport,
  parseSavedHtml,
  parseWikitext,
  plainText,
  textPieces,
  type WikiPage,
} from "./wikitext";

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
    expect(blocks[1].type === "paragraph" && plainText(blocks[1].text)).toBe("Intro with a HDMI guide and bold text.");
    expect(blocks[1].type === "paragraph" && textPieces(blocks[1].text)[1]).toEqual({ text: "HDMI guide", target: "wiki:PS5 HDMI Port Replacement" });
    expect(blocks[2]).toEqual({ type: "heading", level: 2, text: "Diagnosis" });
    expect(blocks[3]).toEqual({ type: "note", kind: "warning", text: "Unplug the console first." });
    expect(blocks[4]).toEqual({ type: "list", ordered: true, items: ["Measure PP_VDD_SOC in diode mode", "Check fuse F4001"] });
    expect(blocks[5]).toEqual({ type: "list", ordered: false, items: ["bullet"] });
    expect(blocks[6]).toEqual({ type: "table", header: true, rows: [["Rail", "Diode"], ["PP3V3", "0.420"], ["PP1V8", "OL"]] });
  });

  it("keeps piped links inside note templates", () => {
    const { blocks } = parseWikitext("{{Warning|Check [[PP3V3_G3H|the G3H rail]] first}}");
    expect(blocks.map((b) => b.type === "note" && plainText(b.text))).toEqual(["Check the G3H rail first"]);
  });

  it("decodes entities and external links", () => {
    expect(inlineText("[https://x.org/a the site] 5&nbsp;V &amp; more")).toBe("the site 5 V & more");
  });
});

describe("repair.wiki device pages", () => {
  const src = `{{stub}}
{{Device page
|Manufacturer=Nintendo|Device type=Game Console}}

== Guides ==
{{List Guides}}

== PCB pictures ==
<gallery showthumbnails="1">
File:Example pcb pictures.jpg
</gallery>

== Reference measurements (also schematics if available) ==
<gallery showthumbnails="1">
File:Switch OLED Mechanic Readings.jpg|Readings for the USB C port
File:Switch oled PCB.jpg|alt=
</gallery>

== More Information/External Sources ==
<!--
You can manually link to external sources …
-->You can manually link to external sources for additional information that might not fit here but are useful such as BIOS image dumps, firmware, etc!

Boardview: https://www.sendspace.com/file/f4i6d0 and [https://repair.wiki/w/Caps known caps]
{| class="wikitable"
|+Guides
!Problem!!Solution
!
|-
|No Power||
*Check the fuse
**F1 near the jack
|}`;
  const { blocks } = parseWikitext(src);

  it("keeps galleries, drops placeholders, boilerplate and empty sections", () => {
    expect(blocks.filter((b) => b.type === "heading").map((b) => b.type === "heading" && b.text)).toEqual([
      "Reference measurements (also schematics if available)",
      "More Information/External Sources",
    ]);
    expect(blocks.find((b) => b.type === "gallery")).toEqual({
      type: "gallery",
      items: [
        { file: "Switch OLED Mechanic Readings.jpg", caption: "Readings for the USB C port" },
        { file: "Switch oled PCB.jpg", caption: "" },
      ],
    });
    const text = blocks.map((b) => (b.type === "paragraph" ? b.text : "")).join(" ");
    expect(text).not.toContain("You can manually link");
    expect(textPieces(text)).toContainEqual({ text: "known caps", target: "https://repair.wiki/w/Caps" });
  });

  it("reads tables with captions, step lists in cells and no empty columns", () => {
    expect(blocks.find((b) => b.type === "table" && b.header)).toEqual({
      type: "table",
      header: true,
      caption: "Guides",
      rows: [
        ["Problem", "Solution"],
        ["No Power", "• Check the fuse\n  • F1 near the jack"],
      ],
    });
  });

  it("counts reference measurement pictures", () => {
    const page: WikiPage = { title: "Nintendo Switch OLED", url: "", categories: [], blocks };
    expect(measurementPictures(page)).toHaveLength(2);
  });

  it("takes a guide's device from its fields", () => {
    expect(parseWikitext("{{Repair Guide|Device=Nintendo Switch Lite|Affects part=M92T36}}\nText").about).toBe("Nintendo Switch Lite");
    expect(parseWikitext("Board of the [[Device::PlayStation 5]].").about).toBe("PlayStation 5");
    expect(inlineText("Board of the [[Device::PlayStation 5]].")).toBe("Board of the PlayStation 5.");
  });

  it("keeps nesting of lists", () => {
    expect(parseWikitext("* a\n** b").blocks).toEqual([{ type: "list", ordered: false, items: ["a", "b"], levels: [1, 2] }]);
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
<div id="catlinks"><a>Categories</a><a>Nintendo Switch</a></div>
<footer><section id="footer-info-copyright">Content is available under <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC</a></section></footer></body></html>`;
    const page = parseSavedHtml(html)!;
    expect(page.title).toBe("Switch No Charge");
    expect(page.url).toBe("https://repair.wiki/w/Switch_No_Charge");
    expect(page.categories).toEqual(["Nintendo Switch"]);
    expect(page.license).toBe("CC BY-SA 3.0");
    expect(page.blocks).toEqual([
      { type: "paragraph", text: "Check the M92T36." },
      { type: "heading", level: 2, text: "Steps" },
      { type: "list", ordered: true, items: ["Measure VBUS"] },
      { type: "table", header: true, rows: [["Net", "Value"], ["VSYS", "0.35"]] },
    ]);
  });

  it("reads galleries and pictures of saved pages", () => {
    const html = `<html><head><title>X - Repair Wiki</title></head><body><h1 id="firstHeading">Nintendo Switch OLED</h1>
<div id="mw-content-text"><div class="mw-parser-output"><h2>Reference measurements</h2>
<ul class="gallery mw-gallery-traditional"><li class="gallerybox"><div class="thumb"><a href="/w/File:Switch_OLED_Mechanic_Readings.jpg" class="mw-file-description"><img src="x"></a></div>
<div class="gallerytext">USB C port readings</div></li>
<li class="gallerybox"><a href="/w/File:Example_pcb_pictures.jpg"><img src="y"></a></li></ul>
<figure><a href="/w/File:Board.png"><img src="z"></a><figcaption>Side A</figcaption></figure></div></div></body></html>`;
    expect(parseSavedHtml(html)!.blocks).toEqual([
      { type: "heading", level: 2, text: "Reference measurements" },
      // Pictures in a row become one gallery.
      {
        type: "gallery",
        items: [
          { file: "Switch OLED Mechanic Readings.jpg", caption: "USB C port readings" },
          { file: "Board.png", caption: "Side A" },
        ],
      },
    ]);
  });
});
