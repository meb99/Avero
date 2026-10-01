import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrate } from "./settings";

describe("settings migration", () => {
  it("turns ghosting of the other side off once for older settings", () => {
    const old = { ...DEFAULT_SETTINGS, revision: undefined, ghostOtherSide: true };
    expect(migrate(old).ghostOtherSide).toBe(false);
    expect(migrate(old).revision).toBe(2);
  });

  it("keeps a choice made after the change", () => {
    expect(migrate({ ...DEFAULT_SETTINGS, ghostOtherSide: true }).ghostOtherSide).toBe(true);
  });
});
