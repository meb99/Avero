// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { dailyCheck, fetchUpdate, isNewer } from "./updates";

describe("isNewer", () => {
  it("compares versions numerically", () => {
    expect(isNewer("v0.10.0", "0.9.2")).toBe(true);
    expect(isNewer("0.4.0", "0.4.0")).toBe(false);
    expect(isNewer("v1.0", "0.9.9")).toBe(true);
    expect(isNewer("0.3.9", "0.4.0")).toBe(false);
    expect(isNewer("0.4.1", "0.4")).toBe(true);
  });
});

describe("local mode", () => {
  it("makes no update request, whoever asks", async () => {
    localStorage.setItem("avero.settings.v1", JSON.stringify({ localMode: true }));
    localStorage.removeItem("avero.updateCheck.v1");
    let requests = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests++;
      return new Response("{}");
    }) as typeof fetch;
    try {
      expect(await dailyCheck("0.9.0")).toBeNull();
      await expect(fetchUpdate("0.9.0")).rejects.toThrow();
      expect(requests).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      localStorage.removeItem("avero.settings.v1");
    }
  });
});
