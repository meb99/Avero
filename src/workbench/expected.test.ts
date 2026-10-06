import { describe, expect, it } from "vitest";
import { expectedFor, judgeExpected, parseLimit, parseLimits, setLimit } from "./expected";
import { addCase, parseNotes, setCaseGood, type BoardNotes } from "./notes";

function board(): BoardNotes {
  const n = parseNotes(JSON.stringify({ version: 1, key: "B", reference: {}, cases: [] }))!;
  return n;
}

/** Notes with the reference and three more good boards measured on PP3V3. */
function withGoodBoards(values: (number | "OL")[], conds: object[] = []): BoardNotes {
  let n = board();
  n = { ...n, reference: { PP3V3: { diode: values[0], conds: { diode: { polarity: "red-gnd", ...conds[0] } } } } };
  values.slice(1).forEach((v, i) => {
    n = addCase(n, `Good ${i + 2}`);
    const id = n.cases[n.cases.length - 1].id;
    n = setCaseGood(n, id, true);
    n = { ...n, cases: n.cases.map((c) => (c.id === id ? { ...c, readings: { PP3V3: { diode: v, conds: { diode: { polarity: "red-gnd", ...conds[i + 1] } } } } } : c)) };
  });
  return n;
}

describe("expected readings from several good boards", () => {
  it("gives range, median and how many boards", () => {
    const e = expectedFor(withGoodBoards([0.43, 0.41, 0.45, 0.44]), "Ref", "PP3V3", "diode", { polarity: "red-gnd" });
    expect(e.fitting).toHaveLength(1);
    expect(e.fitting[0]).toMatchObject({ min: 0.41, max: 0.45, ol: 0 });
    expect(e.fitting[0].median).toBeCloseTo(0.435);
    expect(e.fitting[0].values).toHaveLength(4);
  });

  it("never counts OL or a missing reading as zero", () => {
    const e = expectedFor(withGoodBoards([0.43, "OL", 0.45]), "Ref", "PP3V3", "diode", undefined);
    const g = e.fitting[0];
    expect(g.numbers).toEqual([0.43, 0.45]);
    expect(g.ol).toBe(1);
    expect(g.min).toBe(0.43);
  });

  it("keeps revisions and probe directions apart", () => {
    const n = withGoodBoards([0.43, 0.6, 0.44], [{ revision: "A" }, { revision: "B" }, { revision: "A" }]);
    const e = expectedFor(n, "Ref", "PP3V3", "diode", { revision: "A", polarity: "red-gnd" });
    expect(e.groups).toHaveLength(2);
    expect(e.fitting).toHaveLength(1);
    expect(e.fitting[0].numbers).toEqual([0.43, 0.44]);
    // Asked without a revision: both fit, and they are not pooled; a value judged by both alike counts.
    const loose = expectedFor(n, "Ref", "PP3V3", "diode", undefined);
    expect(loose.fitting).toHaveLength(2);
    expect(judgeExpected(loose, 0.2, "diode", 0.1)).toBe("deviation");
    expect(judgeExpected(loose, 0.44, "diode", 0.1)).toBe("mismatch");
    // Black probe on ground is another group again.
    const other = expectedFor(n, "Ref", "PP3V3", "diode", { polarity: "black-gnd" });
    expect(other.fitting).toHaveLength(0);
    expect(judgeExpected(other, 0.44, "diode", 0.1)).toBe("mismatch");
  });

  it("judges inside the range widened by the tolerance", () => {
    const e = expectedFor(withGoodBoards([0.41, 0.45]), "Ref", "PP3V3", "diode", undefined);
    expect(judgeExpected(e, 0.43, "diode", 0.05)).toBe("ok");
    expect(judgeExpected(e, 0.47, "diode", 0.05)).toBe("ok");
    expect(judgeExpected(e, 0.3, "diode", 0.05)).toBe("deviation");
    expect(judgeExpected(e, "OL", "diode", 0.05)).toBe("deviation");
  });

  it("uses a limit set by hand first, with its source", () => {
    let n = withGoodBoards([0.43]);
    n = setLimit(n, "PP3V3", "diode", parseLimit("0,30 – 0,50 Datenblatt TPS51")!);
    const e = expectedFor(n, "Ref", "PP3V3", "diode", undefined);
    expect(e.limit).toEqual({ min: 0.3, max: 0.5, source: "Datenblatt TPS51" });
    expect(judgeExpected(e, 0.49, "diode", 0)).toBe("ok");
    expect(judgeExpected(e, 0.55, "diode", 0)).toBe("deviation");
    expect(parseNotes(JSON.stringify(n))!.limits).toEqual(n.limits);
    expect(setLimit(n, "PP3V3", "diode", undefined).limits).toBeUndefined();
  });

  it("reads limits typed in several ways", () => {
    expect(parseLimit("0.4-0.5")).toEqual({ min: 0.4, max: 0.5, source: "?" });
    expect(parseLimit(">= 3.2 Schaltplan")).toEqual({ min: 3.2, source: "Schaltplan" });
    expect(parseLimit("< 5 Ohm Datenblatt")).toEqual({ max: 5, source: "Ohm Datenblatt" });
    expect(parseLimit("so etwa")).toBeUndefined();
    expect(parseLimits({ X: { diode: { source: "a" } } })).toBeUndefined();
  });
});
