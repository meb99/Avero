import { describe, expect, it } from "vitest";
import { findPinSpot } from "./pinFind";
import { WordIndex, type Word } from "./textIndex";

const word = (text: string, page: number, x: number, y: number): Word => ({
  key: text.toUpperCase(),
  text,
  page,
  box: { x0: x, y0: y, x1: x + text.length * 3, y1: y + 4 },
});

describe("findPinSpot", () => {
  // U7100 on two pages: page 1 has its power pins, page 2 the GPIOs.
  const words = [
    word("U7100", 1, 100, 100),
    word("12", 1, 140, 110),
    word("PP3V3_S5", 1, 160, 110),
    word("3", 1, 140, 130),
    word("PP1V8", 1, 160, 130),
    word("U7100", 2, 300, 300),
    word("12", 2, 340, 320),
    word("I2C_SDA", 2, 360, 320),
    // Another part's pin 12 with the same net far away.
    word("PP3V3_S5", 2, 900, 900),
  ];
  const index = new WordIndex();
  index.add(words);
  const hits = index.find("U7100");

  it("picks the occurrence where the pin's net is, with the pin number", () => {
    const spot = findPinSpot(index, hits, "12", ["PP3V3_S5"])!;
    expect(hits[spot.hit].page).toBe(1);
    expect(spot.net?.text).toBe("PP3V3_S5");
    expect(spot.pin?.box.x0).toBe(140);
    expect(spot.pin?.page).toBe(1);
  });

  it("finds the same pin number on another page by its net", () => {
    const spot = findPinSpot(index, hits, "12", ["I2C_SDA"])!;
    expect(hits[spot.hit].page).toBe(2);
    expect(spot.pin?.page).toBe(2);
  });

  it("trusts a bare pin number only when it is distinctive", () => {
    expect(findPinSpot(index, hits, "3", ["NOT_THERE"])).toBeNull();
    const bga = new WordIndex();
    bga.add([word("U1", 0, 0, 0), word("AB12", 0, 30, 10)]);
    expect(findPinSpot(bga, bga.find("U1"), "AB12", [])?.pin?.text).toBe("AB12");
  });
});

describe("pins sharing a net", () => {
  it("takes the label on the pin's own row", () => {
    const index = new WordIndex();
    index.add([
      word("U3100", 0, 100, 50),
      word("PP_VBUS", 0, 40, 100),
      word("1", 0, 75, 100),
      word("PP_VBUS", 0, 40, 110),
      word("2", 0, 75, 110),
      word("CHG_SW", 0, 40, 120),
      word("3", 0, 75, 120),
    ]);
    const hits = index.find("U3100");
    expect(findPinSpot(index, hits, "2", ["PP_VBUS"])?.pin?.box.y0).toBe(110);
    expect(findPinSpot(index, hits, "2", ["PP_VBUS"])?.net?.box.y0).toBe(110);
    expect(findPinSpot(index, hits, "1", ["PP_VBUS"])?.net?.box.y0).toBe(100);
  });
});
