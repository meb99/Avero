import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: async () => ({ setAsAppMenu: async () => null }) } }));

const { installMenu, menuOwnsKey } = await import("./menu");
const { translator } = await import("./i18n");

const key = (k: string, code: string, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) => ({
  key: k,
  code,
  metaKey: true,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  ctrlKey: !!mods.ctrl,
});

describe("native menu keys", () => {
  it("leaves every ⌘ key to the web view without the native menu", () => {
    expect(menuOwnsKey(key("o", "KeyO"))).toBe(false);
  });

  it("knows which ⌘ keys the menu handles and which only the web view sees", async () => {
    await installMenu(translator("de"), () => ({}) as never, [], "0.0.0");
    expect(menuOwnsKey(key("o", "KeyO"))).toBe(true);
    expect(menuOwnsKey(key("c", "KeyC"))).toBe(true);
    expect(menuOwnsKey(key("I", "KeyI", { shift: true }))).toBe(true);
    // German keyboard: the key labelled Z sits where US has Y.
    expect(menuOwnsKey(key("z", "KeyY"))).toBe(true);
    // Back, forward and bookmark are the web view's, also as ⌘⌥5 on German keyboards.
    expect(menuOwnsKey(key("[", "BracketLeft"))).toBe(false);
    expect(menuOwnsKey(key("[", "Digit5", { alt: true }))).toBe(false);
    expect(menuOwnsKey(key("d", "KeyD"))).toBe(false);
    expect(menuOwnsKey({ ...key("d", "KeyD"), metaKey: false })).toBe(false);
  });
});
