import { describe, expect, it } from "vitest";
import { continuations, mapPin, parsePairs, parseProjects, projectOf, type DeviceProject } from "./project";

const ps5: DeviceProject = {
  id: "p1",
  name: "PS5 CFI-1216A",
  boards: [
    { id: "main", name: "Mainboard", path: "/b/EDM-010.brd", revision: "EDM-010" },
    { id: "hdmi", name: "HDMI board", path: "/b/hdmi.brd" },
  ],
  links: [
    { id: "l1", a: { board: "main", part: "J3" }, b: { board: "hdmi", part: "J1" }, mapping: { kind: "reversed", count: 40 }, cable: "FFC 40" },
    { id: "l2", a: { board: "main", part: "J7" }, b: { board: "hdmi", part: "J2" }, mapping: { kind: "pins", pairs: [["1", "A1"], ["2", "B1"]] } },
  ],
};

describe("device projects", () => {
  it("follows a pin through a cable both ways", () => {
    expect(continuations(ps5, "main", "J3", "2")).toMatchObject([{ board: "hdmi", part: "J1", pin: "39" }]);
    expect(continuations(ps5, "hdmi", "J1", "39")).toMatchObject([{ board: "main", part: "J3", pin: "2" }]);
    // Stated pairs, either direction, case aside.
    expect(continuations(ps5, "main", "j7", "2")).toMatchObject([{ board: "hdmi", part: "J2", pin: "B1" }]);
    expect(continuations(ps5, "hdmi", "J2", "a1")).toMatchObject([{ board: "main", part: "J7", pin: "1" }]);
  });

  it("joins nothing that is not stated", () => {
    // Another connector, or a pin the mapping does not have.
    expect(continuations(ps5, "main", "J4", "2")).toEqual([]);
    expect(continuations(ps5, "main", "J7", "3")).toEqual([]);
    expect(mapPin({ kind: "reversed", count: 40 }, "41", true)).toBeUndefined();
    expect(mapPin({ kind: "straight" }, "A7", false)).toBe("A7");
  });

  it("reads pin pairs as typed", () => {
    expect(parsePairs("1=40, 2=39\n3 -> 38")).toEqual([["1", "40"], ["2", "39"], ["3", "38"]]);
    expect(parsePairs("1 = 40, so")).toBeUndefined();
  });

  it("checks stored projects and finds a board's project", () => {
    const stored = JSON.parse(JSON.stringify([ps5, { id: "x" }, { ...ps5, id: "p2", links: [{ id: "bad", a: { board: "nope", part: "J1" }, b: ps5.links[0].b, mapping: { kind: "straight" } }] }]));
    const projects = parseProjects(stored);
    expect(projects).toHaveLength(2);
    expect(projects[1].links).toEqual([]);
    expect(projectOf(projects, "/b/hdmi.brd")?.board.name).toBe("HDMI board");
    expect(projectOf(projects, "/b/other.brd")).toBeUndefined();
  });
});
