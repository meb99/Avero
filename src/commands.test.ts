import { describe, expect, it } from "vitest";
import { COMMANDS, commandForKey, paletteCommands, shortcutOf, type CommandActions, type CommandState } from "./commands";
import { translator } from "./i18n";
import { rebind } from "./shortcuts";

const state = (s: Partial<CommandState> = {}): CommandState => ({
  lang: "de",
  board: true,
  notes: true,
  boardNotes: true,
  schematic: true,
  detached: false,
  selected: true,
  hidden: false,
  photo: false,
  origin: false,
  secondView: false,
  comparing: false,
  isolated: false,
  bench: false,
  grid: false,
  uiLevel: "workshop",
  ...s,
});
const press = (key: string, mods: { meta?: boolean; alt?: boolean; code?: string } = {}) => ({
  key,
  code: mods.code ?? `Key${key.toUpperCase()}`,
  metaKey: !!mods.meta,
  ctrlKey: false,
  altKey: !!mods.alt,
});

describe("command register", () => {
  it("has each command once, with a text in German and English", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const menuIds = COMMANDS.map((c) => c.menuId ?? c.id);
    expect(new Set(menuIds).size).toBe(menuIds.length);
    for (const lang of ["de", "en"] as const) {
      const t = translator(lang);
      for (const c of COMMANDS) {
        const label = c.label(t, state({ lang }));
        // A missing text comes back as its key ("menu.flip").
        expect(label, `${c.id} (${lang})`).not.toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
        expect(label.trim().length, `${c.id} (${lang})`).toBeGreaterThan(1);
      }
    }
  });

  it("shows in the palette the key set in the settings", () => {
    const flip = COMMANDS.find((c) => c.id === "flip")!;
    expect(shortcutOf(flip, undefined, "de")).toBe("Leertaste");
    expect(shortcutOf(flip, undefined, "en")).toBe("Space");
    expect(shortcutOf(flip, rebind(undefined, "flip", "x"), "de")).toBe("X");
    expect(shortcutOf(flip, { flip: [] }, "de")).toBeUndefined();
    // Fixed keys stay as they are.
    expect(shortcutOf(COMMANDS.find((c) => c.id === "open")!, rebind(undefined, "flip", "o"), "de")).toBe("⌘O");
    const t = translator("de");
    const list = paletteCommands(t, state(), () => ({}) as CommandActions, rebind(undefined, "fit", "Home"));
    expect(list.find((c) => c.id === "fit")?.shortcut).toBe("Pos1");
    expect(list.find((c) => c.id === "nav-back")?.shortcut).toBe("⌘[");
  });

  it("keeps the palette's order, with the entries made from data in their places", () => {
    const t = translator("de");
    const extra = (id: string) => [{ id, label: id, run: () => {} }];
    const ids = paletteCommands(t, state(), () => ({}) as CommandActions, undefined, {
      "origin-clear": extra("layout-x"),
      "bookmark-add": extra("bookmark-x"),
      end: extra("recent-0"),
    }).map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(["open", "library", "board-edit"]);
    expect(ids[ids.indexOf("origin-clear") + 1]).toBe("layout-x");
    expect(ids[ids.indexOf("bookmark-add") + 1]).toBe("bookmark-x");
    expect(ids.slice(-3)).toEqual(["website", "compare-stop", "recent-0"]);
    // Menu-only commands stay out of the palette.
    expect(ids).not.toContain("quit");
  });

  it("says what is possible and runs through the app's handlers", () => {
    const t = translator("de");
    const ran: string[] = [];
    const actions = new Proxy({}, { get: (_t, name) => () => ran.push(String(name)) }) as CommandActions;
    const list = paletteCommands(t, state({ board: false, schematic: false }), () => actions, undefined);
    expect(list.find((c) => c.id === "flip")?.enabled).toBe(false);
    expect(list.find((c) => c.id === "open")?.enabled).toBeUndefined();
    // Ruler and marker switch on and off from the palette as from the menu and their keys.
    list.find((c) => c.id === "ruler")!.run();
    list.find((c) => c.id === "marker")!.run();
    list.find((c) => c.id === "draw-jumper")!.run();
    expect(ran).toEqual(["ruler", "marker", "draw"]);
  });

  it("finds the command a key runs", () => {
    expect(commandForKey(press("ƒ", { meta: true, alt: true, code: "KeyF" }), true, "mod")?.id).toBe("schematic-search");
    expect(commandForKey(press("f", { meta: true }), true, "mod")?.id).toBe("search");
    expect(commandForKey(press("K", { meta: true }), false, "mod")?.id).toBe("palette");
    expect(commandForKey(press("?"), false, "plain")?.id).toBe("shortcuts");
    expect(commandForKey(press("R"), false, "plain")?.id).toBe("rotate-back");
    expect(commandForKey(press("r"), true, "plain")).toBeUndefined();
    // Keys that need a board do nothing without one.
    expect(commandForKey(press("g"), false, "plain")).toBeUndefined();
    expect(commandForKey(press("g"), true, "plain")?.id).toBe("grid");
    // A plain key is no ⌘ key and the other way round.
    expect(commandForKey(press("g", { meta: true }), true, "mod")).toBeUndefined();
    expect(commandForKey(press("o"), true, "plain")).toBeUndefined();
  });

  it("names a key for every command a key runs in the palette", () => {
    for (const c of COMMANDS) if (c.keys && !c.menuOnly) expect(c.key ?? c.bench, c.id).toBeDefined();
  });
});
