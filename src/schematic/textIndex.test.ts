import { describe, expect, it } from "vitest";
import { WordIndex, wordsFromRuns, type TextRun } from "./textIndex";

// Viewport transform for an unrotated 800×600 page: flip Y.
function run(str: string, x: number, y: number, size: number, width: number, angleDeg = 0): TextRun {
  const r = (angleDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  // Text matrix in PDF space, then combined with [1, 0, 0, -1, 0, 600].
  const m = [size * cos, size * sin, -size * sin, size * cos, x, y];
  return { str, width, transform: [m[0], -m[1], m[2], -m[3], m[4], 600 - m[5]] };
}

describe("wordsFromRuns", () => {
  it("splits runs into words with boxes", () => {
    const words = wordsFromRuns([run("U3000 PP3V3_S5", 100, 500, 10, 140)], 0);
    expect(words.map((w) => w.key)).toEqual(["U3000", "PP3V3_S5"]);
    const [u, pp] = words;
    expect(u.box.x0).toBeCloseTo(100);
    expect(u.box.x1).toBeCloseTo(150);
    expect(pp.box.x0).toBeCloseTo(160);
    // Baseline at y=100 in viewport space; text rises above it.
    expect(u.box.y1).toBeCloseTo(102);
    expect(u.box.y0).toBeCloseTo(91);
  });

  it("strips punctuation around names", () => {
    const words = wordsFromRuns([run("(R1100), GND:", 0, 0, 10, 130)], 2);
    expect(words.map((w) => w.text)).toEqual(["R1100", "GND"]);
    expect(words[0].page).toBe(2);
  });

  it("handles vertical text", () => {
    const [w] = wordsFromRuns([run("I2C0_SDA", 300, 200, 10, 80, 90)], 0);
    // Rotated 90° counter-clockwise in PDF space: the word runs upwards,
    // which is towards smaller Y on screen.
    expect(w.box.x1 - w.box.x0).toBeLessThan(15);
    expect(w.box.y1 - w.box.y0).toBeGreaterThan(75);
    expect(w.box.y1).toBeCloseTo(400);
  });
});

describe("WordIndex", () => {
  const index = new WordIndex();
  index.add(wordsFromRuns([run("U3000 GND", 100, 500, 10, 90), run("GND", 100, 100, 10, 30)], 1));
  index.add(wordsFromRuns([run("gnd", 50, 550, 10, 30)], 0));

  it("finds occurrences in reading order, case-insensitively", () => {
    const found = index.find("gnd");
    expect(found.map((w) => [w.page, Math.round(w.box.y0)])).toEqual([
      [0, 41],
      [1, 91],
      [1, 491],
    ]);
  });

  it("searches for any part of a word", () => {
    expect(index.search("nd").map((w) => w.page)).toEqual([0, 1, 1]);
    expect(index.search("300").map((w) => w.key)).toEqual(["U3000"]);
    expect(index.search("  ")).toEqual([]);
    expect(index.search("n", 2)).toHaveLength(2);
  });

  it("finds the word under a point", () => {
    expect(index.wordAt(1, 120, 96)?.key).toBe("U3000");
    expect(index.wordAt(1, 120, 300)).toBeUndefined();
  });
});
