import { describe, expect, it } from "vitest";
import { planFor, unsortedEntries } from "./autosort";
import { buildTree } from "./catalog";
import type { LibraryEntry } from "./library";

const file = (path: string) => ({ path, name: path.split("/").pop()!, size: 1, modified: 0 });
const entry = (folder: string, names: string[], root = "/lib"): LibraryEntry => ({
  key: folder,
  title: folder.split("/").pop()!,
  folder,
  root,
  boards: names.filter((n) => !n.endsWith(".pdf")).map((n) => file(`${root}/${folder}/${n}`)),
  schematics: names.filter((n) => n.endsWith(".pdf")).map((n) => file(`${root}/${folder}/${n}`)),
  unsupported: [],
});

describe("planFor", () => {
  it("files a board under its category and keeps its own folder", () => {
    expect(planFor(entry("EDM-020", ["PS5 EDM-020.pcb"]), [])?.target).toBe("Sony/PlayStation/5/EDM-020");
  });

  it("does not repeat the model as a folder", () => {
    expect(planFor(entry("SM-A515F", ["SM-A515F.pdf"]), [])?.target).toBe("Samsung/Galaxy A/A515F");
  });

  it("uses schematic words when the names say nothing", () => {
    const e = entry("download (3)", ["download (3).bvr", "schematic.pdf"]);
    expect(planFor(e, [])).toBeNull();
    const plan = planFor(e, [], ["HAC-CPU-01", "NINTENDO", "SAMSUNG", "LPDDR4"]);
    expect(plan?.target).toBe("Nintendo/Switch/Original/download (3)");
    expect(plan?.from).toBe("schematic");
  });

  it("joins existing folders, also when spelled differently", () => {
    const tree = buildTree(["Sony/PlayStation/PS5/EDM-010"]);
    expect(planFor(entry("EDM-020", ["EDM-020.bvr"]), tree)?.target).toBe("Sony/PlayStation/PS5/EDM-020");
  });

  it("only looks at unsorted entries of the own library", () => {
    const list = [entry("EDM-020", ["a.bvr"]), entry("Sony/PlayStation/5/x", ["b.bvr"]), entry("EDM-021", ["c.bvr"], "/other")];
    expect(unsortedEntries(list, "/lib").map((e) => e.folder)).toEqual(["EDM-020"]);
  });
});
