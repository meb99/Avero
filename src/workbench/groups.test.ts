import { describe, expect, it } from "vitest";
import type { BoardModel } from "../core/board";
import type { InterfaceView } from "../core/interfaces";
import { addOwnGroup, confirmAll, groupOf, parseGroups, removeGroup, renameGroup, setMemberState, shownMembers } from "./groups";

const names = ["J1", "D1", "C1", "U1", "R9"];
const model = { parts: names.map((name) => ({ name })), findPart: (n: string) => (names.indexOf(n.toUpperCase()) < 0 ? undefined : names.indexOf(n.toUpperCase())) } as unknown as BoardModel;
const view: InterfaceView = {
  kind: "usbc",
  connector: 0,
  signals: [],
  members: [
    { part: 1, role: "protection", fns: ["TX1+"] },
    { part: 2, role: "series", fns: ["TX1+"] },
    { part: 3, role: "ic", fns: ["TX1+"] },
  ],
};

describe("function groups", () => {
  it("shows the copper's parts as suggestions until confirmed or rejected, and parts added by hand", () => {
    expect(shownMembers(model, view, undefined).map((m) => m.state)).toEqual(["suggested", "suggested", "suggested"]);
    let g = setMemberState(undefined, "usbc", "J1", { part: "D1", role: "protection" }, "confirmed");
    g = setMemberState(g, "usbc", "J1", { part: "C1", role: "series" }, "rejected");
    g = setMemberState(g, "usbc", "J1", { part: "R9", role: "pull" }, "confirmed");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: "usbc", connector: "J1", name: "USB-C J1" });
    const shown = shownMembers(model, view, groupOf(g, "usbc", "j1"));
    expect(shown.map((m) => [names[m.part], m.state, m.role])).toEqual([
      ["D1", "confirmed", "protection"],
      ["C1", "rejected", "series"],
      ["U1", "suggested", "ic"],
      ["R9", "added", "pull"],
    ]);
    // Taking a mark back.
    const back = setMemberState(g, "usbc", "J1", { part: "C1", role: "series" }, undefined);
    expect(shownMembers(model, view, back[0]).find((m) => names[m.part] === "C1")?.state).toBe("suggested");
  });

  it("confirms all that is only suggested, leaving rejections as they are, with the source", () => {
    let g = setMemberState(undefined, "usbc", "J1", { part: "C1", role: "series" }, "rejected");
    g = confirmAll(g, "usbc", "J1", [{ part: "D1", role: "protection" }, { part: "C1", role: "series" }, { part: "U1", role: "ic" }], "Schaltplan S. 52");
    expect(g[0].source).toBe("Schaltplan S. 52");
    expect(shownMembers(model, view, g[0]).map((m) => m.state)).toEqual(["confirmed", "rejected", "confirmed"]);
  });

  it("keeps own groups under a name, renamed, removed, and read back", () => {
    let g = addOwnGroup(undefined, "Audio", [{ part: "U1", role: "ic" }, { part: "C1", role: "other" }]);
    g = renameGroup(g, g[0].id, "Audio-Codec");
    expect(g[0]).toMatchObject({ kind: "own", name: "Audio-Codec", members: [{ part: "U1", role: "ic", state: "confirmed" }, { part: "C1", role: "other", state: "confirmed" }] });
    expect(parseGroups(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(parseGroups([{ id: "x", name: "y", kind: "rocket" }, { id: "a", name: "b", kind: "own", members: [{ part: "U1", role: "bad", state: "confirmed" }] }])).toEqual([
      { id: "a", name: "b", kind: "own", members: [], updated: expect.any(String) },
    ]);
    expect(removeGroup(g, g[0].id)).toEqual([]);
  });
});
