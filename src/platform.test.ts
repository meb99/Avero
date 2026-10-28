import { describe, expect, it } from "vitest";
import { acceleratorMatches, commandForKey } from "./commands";
import { translator } from "./i18n";
import { acceleratorText } from "./menu";
import { commandKey, forPlatform, forWindows, windowsKeys } from "./platform";
import { keyLabel, keyName } from "./shortcuts";

const press = (key: string, o: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; code?: string } = {}) => ({
  key,
  code: o.code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : ""),
  ctrlKey: !!o.ctrl,
  metaKey: !!o.meta,
  shiftKey: !!o.shift,
  altKey: !!o.alt,
});

describe("Windows names the keys its own way", () => {
  it("writes Mac glyphs as Strg, Alt and Umschalt", () => {
    expect(windowsKeys("⌘F oder /", "de")).toBe("Strg+F oder /");
    expect(windowsKeys("⇧⌘E", "de")).toBe("Strg+Umschalt+E");
    expect(windowsKeys("⌥⌘F", "en")).toBe("Ctrl+Alt+F");
    expect(windowsKeys("⌘T, ⌘W, ⌘1 … 9, ⌃⇥", "de")).toBe("Strg+T, Strg+W, Strg+1 … 9, Strg+Tab");
    expect(windowsKeys("⌃⇧⇥", "en")).toBe("Ctrl+Shift+Tab");
    expect(windowsKeys("⌘[ / ⌘]", "de")).toBe("Strg+[ / Strg+]");
    expect(windowsKeys("(auch ⌥← / ⌥→)", "de")).toBe("(auch Alt+← / Alt+→)");
    expect(windowsKeys("Links drehen (⇧R)", "de")).toBe("Links drehen (Umschalt+R)");
    expect(windowsKeys("⌘/", "en")).toBe("Ctrl+/");
  });

  it("keeps clicks and prose readable", () => {
    expect(windowsKeys("⌘-Klick / ⇧-Klick", "de")).toBe("Strg-Klick / Umschalt-Klick");
    expect(windowsKeys("Bauteile mit ⌘/Shift-Klick wählen", "de")).toBe("Bauteile mit Strg/Shift-Klick wählen");
    expect(windowsKeys("⌘- oder Shift-Klick", "de")).toBe("Strg- oder Shift-Klick");
    expect(windowsKeys("Mit ⌘/Strg oder Umschalt", "de")).toBe("Mit Strg oder Umschalt");
  });

  it("names Windows places", () => {
    expect(forWindows("Im Finder zeigen", "de")).toBe("Im Explorer zeigen");
    expect(forWindows("You can put it back from the Trash in Finder.", "en")).toBe("You can put it back from the Recycle Bin in Explorer.");
    expect(forWindows("läuft ohnehin auf diesem Mac.", "de")).toBe("läuft ohnehin auf diesem PC.");
    expect(forWindows("MacBook Pro", "en")).toBe("MacBook Pro");
    expect(forPlatform("⌘F", "de", "mac")).toBe("⌘F");
  });

  it("translates every text for Windows", () => {
    const t = translator("de", "windows");
    expect(t("help.search")).toBe("Strg+F oder /");
    expect(t("library.reveal")).toBe("Im Explorer zeigen");
    expect(translator("de", "mac")("help.search")).toBe("⌘F oder /");
    expect(translator("en", "windows")("library.delete")).toBe("Move to Recycle Bin");
    expect(t("menu.file")).toBe("Datei");
  });

  it("writes menu keys for the Windows menu bar", () => {
    expect(acceleratorText("CmdOrCtrl+Shift+E", "de")).toBe("Strg+Umschalt+E");
    expect(acceleratorText("CmdOrCtrl+Alt+F", "en")).toBe("Ctrl+Alt+F");
    expect(acceleratorText("CmdOrCtrl+-", "de")).toBe("Strg+-");
    expect(acceleratorText("CmdOrCtrl+,", "de")).toBe("Strg+,");
  });
});

describe("Strg is the command key on Windows", () => {
  it("takes Strg there and ⌘ on the Mac", () => {
    expect(commandKey(press("1", { ctrl: true }), "windows")).toBe(true);
    expect(commandKey(press("1", { ctrl: true }), "mac")).toBe(false);
    expect(commandKey(press("1", { meta: true }), "mac")).toBe(true);
  });

  it("stores Strg as the command key, so bench keys work on both systems", () => {
    expect(keyName(press("d", { ctrl: true }), "windows")).toBe("Cmd+d");
    expect(keyName(press("d", { meta: true }), "mac")).toBe("Cmd+d");
    // AltGr+8 types [ on a German keyboard and arrives as Strg+Alt.
    expect(keyName(press("[", { ctrl: true, alt: true }), "windows")).toBe("Cmd+Alt+[");
    expect(keyLabel("Cmd+d", "de", "windows")).toBe("Strg+D");
    expect(keyLabel("Alt+F5", "en", "windows")).toBe("Alt+F5");
    expect(keyLabel("Cmd+d", "de", "mac")).toBe("⌘D");
  });

  it("runs the menu's keys in the web view, exact on Shift and Alt", () => {
    expect(acceleratorMatches("CmdOrCtrl+Shift+E", press("E", { ctrl: true, shift: true }))).toBe(true);
    expect(acceleratorMatches("CmdOrCtrl+E", press("E", { ctrl: true, shift: true }))).toBe(false);
    expect(acceleratorMatches("CmdOrCtrl+Alt+E", press("€", { ctrl: true, alt: true, code: "KeyE" }))).toBe(true);
    // The character for other keys: / is Umschalt+7 on a German keyboard.
    expect(acceleratorMatches("CmdOrCtrl+/", press("/", { ctrl: true, shift: true, code: "Digit7" }))).toBe(true);

    const run = (e: ReturnType<typeof press>) => commandForKey(e, true, "mod", true)?.id;
    expect(run(press("E", { ctrl: true, shift: true }))).toBe("export");
    expect(run(press("e", { ctrl: true }))).toBe("schematic");
    expect(run(press("I", { ctrl: true, shift: true }))).toBe("import");
    expect(run(press("i", { ctrl: true }))).toBe("sidebar");
    expect(run(press("t", { ctrl: true }))).toBe("new-tab");
    expect(run(press(",", { ctrl: true }))).toBe("settings");
    // Undo stays with the web view's own handling (text fields keep theirs).
    expect(run(press("z", { ctrl: true }))).toBeUndefined();
    // Where the Mac menu takes the keys, the web view leaves them to it.
    expect(commandForKey(press("t", { meta: true }), true, "mod")).toBeUndefined();
  });
});
