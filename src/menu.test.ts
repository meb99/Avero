import { describe, expect, it, vi } from "vitest";

let built: unknown = null;
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: async (options: unknown) => {
      built = options;
      return { setAsAppMenu: async () => null };
    },
  },
}));

/** A menu item by id, anywhere in the built menu. */
function findItem(node: unknown, id: string): { id: string; text: string; accelerator?: string } | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as { id?: string; items?: unknown[] };
  if (n.id === id) return n as { id: string; text: string };
  for (const child of n.items ?? []) {
    const hit = findItem(child, id);
    if (hit) return hit;
  }
  return undefined;
}

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

describe("menu from the command register", () => {
  it("takes texts, key equivalents and shown keys from the register", async () => {
    const { rebind } = await import("./shortcuts");
    await installMenu(translator("de"), () => ({}) as never, [], "0.0.0");
    expect(findItem(built, "open")).toMatchObject({ text: "Öffnen…", accelerator: "CmdOrCtrl+O" });
    expect(findItem(built, "search-schematic")?.accelerator).toBe("CmdOrCtrl+Alt+F");
    expect(findItem(built, "nav-back")?.text).toMatch(/ {2}⌘\[$/);
    expect(findItem(built, "grid")?.text).toMatch(/ {2}G$/);
    // A key set in the settings shows in the menu as well.
    await installMenu(translator("de"), () => ({}) as never, [], "0.0.0", undefined, rebind(undefined, "back", "Alt+b"), "de");
    expect(findItem(built, "nav-back")?.text).toMatch(/ {2}⌥B$/);
  });
});

