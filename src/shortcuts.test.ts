import { describe, expect, it } from "vitest";
import { actionFor, bindings, keyLabel, keyName, rebind, worksWhileTyping } from "./shortcuts";

const key = (k: string, mods: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("names keys the way they are stored", () => {
    expect(keyName(key("N", { shiftKey: true }))).toBe("n");
    expect(keyName(key(" "))).toBe("Space");
    expect(keyName(key("F13"))).toBe("F13");
    expect(keyName(key("F5", { altKey: true, shiftKey: true }))).toBe("Alt+Shift+F5");
    expect(keyLabel("Alt+F5", "de")).toBe("⌥F5");
    expect(keyLabel("PageDown", "de")).toBe("Bild ↓");
  });

  it("finds actions and moves a key from one action to another", () => {
    expect(actionFor(bindings(undefined), "Space")).toBe("flip");
    const custom = rebind(undefined, "commitNext", "Space");
    const all = bindings(custom);
    expect(actionFor(all, "Space")).toBe("commitNext");
    expect(all.flip).toEqual([]);
  });

  it("lets pedal keys through while typing, letters not", () => {
    expect(worksWhileTyping("F13")).toBe(true);
    expect(worksWhileTyping("PageDown")).toBe(true);
    expect(worksWhileTyping("n")).toBe(false);
    expect(worksWhileTyping("Space")).toBe(false);
  });
});
