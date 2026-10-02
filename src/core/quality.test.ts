import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { importQuality } from "./quality";
import { testBoard } from "./testBoard";

describe("importQuality", () => {
  it("reports what the board file brought", () => {
    const checks = importQuality(new BoardModel(testBoard()));
    const ids = checks.map((c) => c.id);
    expect(ids).toContain("outline");
    expect(ids).toContain("ground");
    expect(ids).toContain("bothSides");
    expect(checks.find((c) => c.id === "partsWithPins")).toMatchObject({ level: "ok" });
  });

  it("warns about duplicates, missing ground and position-only parts", () => {
    const board = structuredClone(testBoard());
    board.parts.push({ ...board.parts[0], name: board.parts[0].name, pinCount: 0, firstPin: 0, marker: true });
    for (const n of board.nets) if (n.kind === "ground") n.kind = "signal";
    const checks = importQuality(new BoardModel(board));
    expect(checks.find((c) => c.id === "duplicates")).toMatchObject({ level: "warn", n: 1 });
    expect(checks.find((c) => c.id === "noGround")).toBeDefined();
    expect(checks.find((c) => c.id === "markerParts")).toMatchObject({ n: 1 });
  });
});
