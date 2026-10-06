import { describe, expect, it } from "vitest";
import { blockHit, confirmHit, fromOtherRevision, mappedHits, mappedWords, parseDocLinks, pinAt, refOf, setAliases } from "./mapping";
import { WordIndex, type Word } from "./textIndex";

const w = (key: string, page: number, x: number, y: number): Word => ({ key, text: key, page, box: { x0: x, y0: y, x1: x + 20, y1: y + 6 } });

/** U3 drawn as two units on two pages, plus a note that mentions "U3" elsewhere. */
function schematic() {
  const index = new WordIndex();
  index.add([
    // Unit A: pin 5 on VCC_MAIN.
    w("U3A", 0, 100, 100),
    w("5", 0, 130, 120),
    w("VCC_MAIN", 0, 160, 120),
    // Unit B: pin 12 on GND.
    w("U3B", 1, 100, 100),
    w("12", 1, 130, 140),
    w("GND", 1, 160, 140),
    // Page 3 says "SEE U3" in a revision note: not the symbol.
    w("SEE", 2, 50, 500),
    w("U3", 2, 80, 500),
    // The same chip under another name in this schematic.
    w("IC3", 3, 300, 300),
  ]);
  return index;
}
const doc = { contentId: "rev-a", name: "board.pdf" };

describe("mapping of board parts to the documents", () => {
  it("drops a blocked match and then finds the symbol's units", () => {
    const index = schematic();
    // Found under the name itself: only the note.
    expect(mappedWords(index, doc, "U3").map((x) => x.key)).toEqual(["U3"]);
    const note = index.find("U3")[0];
    const links = parseDocLinks(blockHit(undefined, "U3", refOf(doc, note)));
    const hits = mappedHits(index, doc, "U3", links?.U3);
    expect(hits.map((h) => h.word.key)).toEqual(["U3A", "U3B"]);
    expect(hits.every((h) => h.source === "unit")).toBe(true);
  });

  it("keeps the pins of U3A and U3B apart", () => {
    const index = schematic();
    const units = index.findUnits("U3");
    expect(units[pinAt(index, units, "5", ["VCC_MAIN"])!].key).toBe("U3A");
    expect(units[pinAt(index, units, "12", ["GND"])!].key).toBe("U3B");
  });

  it("puts confirmed places first and searches other names", () => {
    const index = schematic();
    let links = setAliases(undefined, "U3", ["ic3", "U3"]);
    expect(links?.U3.aliases).toEqual(["IC3"]);
    const ic3 = index.find("IC3")[0];
    links = confirmHit(links, "U3", refOf(doc, ic3));
    const hits = mappedHits(index, doc, "U3", links?.U3);
    expect(hits[0]).toMatchObject({ source: "alias", alias: "IC3", confirmed: true });
    // A confirmed place blocked later is no longer confirmed, and not shown.
    links = blockHit(links, "U3", refOf(doc, ic3));
    expect(links?.U3.confirmed).toBeUndefined();
    expect(mappedHits(index, doc, "U3", links?.U3).some((h) => h.word.key === "IC3")).toBe(false);
  });

  it("offers corrections from another revision for checking, never applies them", () => {
    const index = schematic();
    const note = index.find("U3")[0];
    const links = blockHit(undefined, "U3", refOf(doc, note))!;
    const revB = { contentId: "rev-b", name: "board.pdf" };
    // Not blocked in the new revision by itself.
    expect(mappedWords(index, revB, "U3", links.U3).map((x) => x.key)).toEqual(["U3"]);
    const recheck = fromOtherRevision(index, revB, links.U3);
    expect(recheck).toHaveLength(1);
    expect(recheck[0]).toMatchObject({ kind: "blocked", found: note });
    // Another document altogether: nothing to check.
    expect(fromOtherRevision(index, { contentId: "x", name: "datasheet.pdf" }, links.U3)).toEqual([]);
  });

  it("reads stored corrections and drops broken ones", () => {
    expect(parseDocLinks([1])).toBeUndefined();
    const parsed = parseDocLinks({ u3: { aliases: ["IC3", 4], blocked: [{ doc: "a", docName: "b", page: 1, text: "U3", x: 1, y: 2 }, { doc: 1 }] }, r1: {} });
    expect(parsed).toEqual({ U3: { aliases: ["IC3"], blocked: [{ doc: "a", docName: "b", page: 1, text: "U3", x: 1, y: 2 }] } });
  });
});
