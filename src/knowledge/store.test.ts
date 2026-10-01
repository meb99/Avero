// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EMPTY_KNOWLEDGE, deviceOf, mergeKnowledge, pagesForBoard, parseKnowledgeFile, searchKnowledge, toKnowledge } from "./store";
import type { WikiPage } from "./wikitext";

const page = (title: string, categories: string[], text: string): WikiPage => ({
  title,
  url: `https://repair.wiki/w/${title.replace(/ /g, "_")}`,
  categories,
  blocks: [{ type: "paragraph", text }],
});

describe("knowledge", () => {
  const ps5 = toKnowledge(page("PS5 No Power", ["PlayStation 5"], "Check fuse F4001 near the HDMI port on EDM-020."));
  const ps5slim = toKnowledge(page("PS5 Slim HDMI", [], "Replace the retimer."));
  const lite = toKnowledge(page("Switch Lite no charge", ["Nintendo Switch Lite"], "Check M92T36."));
  const base = mergeKnowledge(EMPTY_KNOWLEDGE, [ps5, ps5slim, lite]);

  it("knows the device of a page and its license", () => {
    expect(deviceOf(page("x", ["Nintendo Switch OLED"], ""))).toEqual({ brand: "Nintendo", family: "Switch", model: "OLED" });
    expect(ps5.source).toBe("repair.wiki");
    expect(ps5.license).toBe("CC BY-SA 3.0");
    expect(toKnowledge({ ...page("x", [], ""), license: "CC BY-SA 4.0" }).license).toBe("CC BY-SA 4.0");
  });

  it("ranks pages for the board in view", () => {
    const shown = pagesForBoard(base, { brand: "Sony", family: "PlayStation", model: "5" }, ["EDM-020"]);
    expect(shown.map((p) => p.title)).toEqual(["PS5 No Power", "PS5 Slim HDMI"]);
    expect(pagesForBoard(base, { brand: "Apple", family: "iPhone", model: "13" }, [])).toEqual([]);
  });

  it("replaces a page imported again and searches all pages", () => {
    const again = mergeKnowledge(base, [toKnowledge(page("PS5 No Power", [], "new text"))]);
    expect(again.pages).toHaveLength(3);
    expect(searchKnowledge(again, "new text").map((p) => p.title)).toEqual(["PS5 No Power"]);
    expect(searchKnowledge(base, "m92t36").map((p) => p.title)).toEqual(["Switch Lite no charge"]);
  });

  it("tells exports, saved pages and other files apart", () => {
    expect(parseKnowledgeFile("<mediawiki><page><title>A</title><ns>0</ns><revision><text>hello</text></revision></page></mediawiki>", "a.xml")).toHaveLength(1);
    expect(() => parseKnowledgeFile("just text", "a.txt")).toThrow();
    // An export made without clicking "Add" has only <siteinfo>.
    expect(() => parseKnowledgeFile("<mediawiki><siteinfo><sitename>Repair Wiki</sitename></siteinfo></mediawiki>", "e.xml")).toThrow(
      /no pages/,
    );
  });
});
