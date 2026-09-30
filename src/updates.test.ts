import { describe, expect, it } from "vitest";
import { isNewer } from "./updates";

describe("isNewer", () => {
  it("compares versions numerically", () => {
    expect(isNewer("v0.10.0", "0.9.2")).toBe(true);
    expect(isNewer("0.4.0", "0.4.0")).toBe(false);
    expect(isNewer("v1.0", "0.9.9")).toBe(true);
    expect(isNewer("0.3.9", "0.4.0")).toBe(false);
    expect(isNewer("0.4.1", "0.4")).toBe(true);
  });
});
