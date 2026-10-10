import { describe, expect, it } from "vitest";
import type { Selection } from "./core/types";
import { EMPTY_HISTORY, recordSelection, stepSelection, type SelectionHistory } from "./selectionHistory";

const part = (n: number): Selection => ({ kind: "part", part: n });
const record = (...sels: Selection[]) => sels.reduce(recordSelection, EMPTY_HISTORY);
const shown = (h: SelectionHistory | null) => h && h.items[h.at];

describe("selection history", () => {
  it("steps back and forward through what was selected", () => {
    const h = record(part(1), part(2), part(3));
    const back = stepSelection(h, -1);
    expect(shown(back)).toEqual(part(2));
    expect(shown(stepSelection(back!, -1))).toEqual(part(1));
    expect(shown(stepSelection(back!, 1))).toEqual(part(3));
  });

  it("has nothing before the first or after the newest selection", () => {
    expect(stepSelection(EMPTY_HISTORY, -1)).toBeNull();
    const h = record(part(1), part(2));
    expect(stepSelection(h, 1)).toBeNull();
    expect(stepSelection(stepSelection(h, -1)!, -1)).toBeNull();
  });

  it("keeps the place when the selection stepped to is recorded", () => {
    const back = stepSelection(record(part(1), part(2), part(3)), -1)!;
    // The app records every selection, the one a step made as well.
    const after = recordSelection(back, part(2));
    expect(after).toBe(back);
    expect(shown(stepSelection(after, 1))).toEqual(part(3));
  });

  it("drops what lay ahead when something new is selected", () => {
    const back = stepSelection(record(part(1), part(2), part(3)), -1)!;
    const h = recordSelection(back, part(4));
    expect(h.items).toEqual([part(1), part(2), part(4)]);
    expect(stepSelection(h, 1)).toBeNull();
  });

  it("ignores no selection and the same one twice", () => {
    const h = record(part(1), { kind: "none" }, part(1), { kind: "net", net: 5 });
    expect(h.items).toEqual([part(1), { kind: "net", net: 5 }]);
  });

  it("keeps the newest 200", () => {
    const h = record(...Array.from({ length: 250 }, (_, i) => part(i)));
    expect(h.items).toHaveLength(200);
    expect(h.items[0]).toEqual(part(50));
    expect(shown(h)).toEqual(part(249));
  });
});
