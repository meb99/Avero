import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, fromStored, migrate } from "./settings";

describe("settings migration", () => {
  it("turns ghosting of the other side off once for older settings", () => {
    const old = { ...DEFAULT_SETTINGS, revision: undefined, ghostOtherSide: true };
    expect(migrate(old).ghostOtherSide).toBe(false);
    expect(migrate(old).revision).toBe(2);
  });

  it("migrates settings stored by older versions, which have no revision", () => {
    const { revision: _, ...old } = { ...DEFAULT_SETTINGS, ghostOtherSide: true };
    expect(fromStored(old).ghostOtherSide).toBe(false);
    expect(fromStored({ ...old, revision: 2 }).ghostOtherSide).toBe(true);
  });

  it("keeps a choice made after the change", () => {
    expect(migrate({ ...DEFAULT_SETTINGS, ghostOtherSide: true }).ghostOtherSide).toBe(true);
  });
});
