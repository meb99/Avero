import { describe, expect, it } from "vitest";
import { colorHex, DARK, withColors } from "./palette";

describe("own colours", () => {
  it("replace colours and keep transparency", () => {
    const p = withColors(DARK, { pinPower: "#00ff00", label: "#123456", ratsnest: "nonsense" });
    expect(p.pinPower).toEqual([0, 255, 0, DARK.pinPower[3]]);
    expect(p.label).toBe("#123456");
    expect(p.ratsnest).toBe(DARK.ratsnest);
    expect(withColors(DARK, undefined)).toBe(DARK);
  });

  it("show any palette colour as #rrggbb", () => {
    expect(colorHex(DARK, "pinFirst")).toBe("#d64040");
    expect(colorHex(DARK, "label")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
