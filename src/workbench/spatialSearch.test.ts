import { describe, expect, it } from "vitest";
import { searchNearby } from "./spatialSearch";
import type { Word } from "../schematic/textIndex";
const w = (key: string, x: number, page = 0): Word => ({ key, text: key, page, box: { x0:x, x1:x+4, y0:0, y1:4 } });
const idx = (positions: Word[]) => new Map([["a.pdf", { v:1 as const, pages:2, words:{}, positions }]]);
describe("nearby library search", () => {
  it("requires all terms near each other and opens their actual page/box", () => {
    expect(searchNearby(idx([w("1UF",0), w("16V",10), w("0201",20)]), "1uF 16V 0201")[0]).toMatchObject({path:"a.pdf", page:0, box:{x0:0,x1:24}});
    expect(searchNearby(idx([w("1UF",0), w("16V",10), w("0201",100)]), "1uF 16V 0201")).toEqual([]);
  });
  it("does not join pages or a chain of far-away labels", () => {
    expect(searchNearby(idx([w("A",0), w("B",40), w("C",80)]), "A B C",50)).toEqual([]);
    expect(searchNearby(idx([w("1UF",0), w("16V",10,1)]), "1UF 16V")).toEqual([]);
  });
  it("normalizes micro units, rejects substring matches and needs two occurrences for repeated terms", () => {
    expect(searchNearby(idx([w("1µF",0),w("16V",10)]),"1uF 16V")).toHaveLength(1);
    expect(searchNearby(idx([w("116V",0)]),"16V")).toHaveLength(0);
    expect(searchNearby(idx([w("16V",0)]),"16V 16V")).toHaveLength(0);
  });
});
