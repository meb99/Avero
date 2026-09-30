import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { translator } from "./index";

describe("i18n", () => {
  it("has a German text for every English key", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the same placeholders in every language", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("formats numbers for the language", () => {
    expect(translator("de")("status.pins", { n: 12345 })).toBe("12.345 Pins");
    expect(translator("en")("status.pins", { n: 12345 })).toBe("12,345 pins");
  });
});
