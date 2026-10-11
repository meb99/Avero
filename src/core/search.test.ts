import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { findNames } from "./search";
import { testBoard } from "./testBoard";

const model = new BoardModel(testBoard());
const names = (query: string, options: Parameters<typeof findNames>[2]) => findNames(model, query, options).map((r) => r.label);
const both = { parts: true, nets: true } as const;

describe("search for component / network", () => {
  it("finds parts of the name anywhere, at its start, or the whole name", () => {
    expect(names("3V3", { ...both, mode: "substring" })).toEqual(["PP3V3", "PP3V3_L", "PP3V3_R"]);
    expect(names("3V3", { ...both, mode: "prefix" })).toEqual([]);
    expect(names("pp3v3", { ...both, mode: "prefix" })).toEqual(["PP3V3", "PP3V3_L", "PP3V3_R"]);
    expect(names("PP3V3", { ...both, mode: "strict" })).toEqual(["PP3V3"]);
  });

  it("looks for parts, nets or both", () => {
    expect(names("R", { parts: true, nets: false, mode: "prefix" })).toEqual(["R1", "R9"]);
    expect(names("R", { parts: false, nets: true, mode: "substring" })).not.toContain("R1");
    expect(names("R", { parts: false, nets: false, mode: "substring" })).toEqual([]);
  });

  it("lists names in order, a part before a net of the same name", () => {
    const list = findNames(model, "", { ...both, mode: "substring" });
    expect(list).toEqual([]);
    const all = findNames(model, "1", { ...both, mode: "substring" });
    expect(all.map((r) => r.label)).toEqual(["R1", "U10"]);
  });

  it("finds a pin written as part and number", () => {
    const [hit] = findNames(model, "U10.A3", { ...both, mode: "strict" });
    expect(hit?.kind).toBe("pin");
    expect(hit?.detail).toBe("I2C_SDA");
  });

  it("leaves out unconnected nets", () => {
    expect(names("UNCONNECTED", { ...both, mode: "strict" })).toEqual([]);
  });
});
