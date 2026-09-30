import { describe, expect, it } from "vitest";
import { matchCommands, type Command } from "./commands";

const cmd = (id: string, label: string, enabled?: boolean): Command => ({ id, label, enabled, run() {} });
const all = [cmd("open", "Open file"), cmd("flip", "Flip board"), cmd("fit", "Fit board to window"), cmd("x", "Export image", false)];

describe("matchCommands", () => {
  it("hides disabled commands", () => {
    expect(matchCommands(all, "").map((c) => c.id)).toEqual(["open", "flip", "fit"]);
    expect(matchCommands(all, "export")).toEqual([]);
  });

  it("matches all words in any order, prefix matches first", () => {
    expect(matchCommands(all, "board fit").map((c) => c.id)).toEqual(["fit"]);
    expect(matchCommands(all, "fi").map((c) => c.id)).toEqual(["fit", "open"]);
  });
});
