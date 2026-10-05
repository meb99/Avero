import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const aside: string[] = [];
let failSaves = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { key: string; data?: string; stamp?: number }) => {
    switch (cmd) {
      case "load_notes":
        return files.get(args.key) ?? null;
      case "save_notes":
        if (failSaves) throw new Error("disk full");
        files.set(args.key, args.data!);
        return null;
      case "set_notes_aside":
        aside.push(args.key);
        files.delete(args.key);
        return `/notes/${args.key}.damaged.json`;
      case "note_versions":
        return files.has(`v:${args.key}`) ? [1700000000] : [];
      case "load_note_version":
        return files.get(`v:${args.key}`);
      default:
        return null;
    }
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const { loadNotes, markUnsaved, saveAllNotes, hasUnsavedNotes } = await import("./store");
const { emptyNotes, setValue } = await import("./notes");

beforeEach(() => {
  files.clear();
  aside.length = 0;
  failSaves = false;
});

describe("notes storage", () => {
  it("tells a missing file from a damaged one and never overwrites the damaged one", async () => {
    expect((await loadNotes("a", "a", "A")).notice).toBeUndefined();
    files.set("b", "{ not json");
    const damaged = await loadNotes("b", "b", "B");
    expect(damaged.notice?.kind).toBe("damaged");
    expect(aside).toEqual(["b"]);
  });

  it("restores the newest readable snapshot of a damaged file", async () => {
    const good = setValue(emptyNotes("c", "C"), "reference", "PP3V3", "voltage", 3.3);
    files.set("c", "garbage");
    files.set("v:c", JSON.stringify(good));
    const loaded = await loadNotes("c", "c", "C");
    expect(loaded.notice?.kind).toBe("recovered");
    expect(loaded.notes.reference.PP3V3.voltage).toBe(3.3);
  });

  it("takes notes over from the key of older versions", async () => {
    files.set("playstation5", JSON.stringify(setValue(emptyNotes("playstation5", "PS5"), "reference", "X", "diode", 0.4)));
    const loaded = await loadNotes("edm-010", "playstation5", "PS5");
    expect(loaded.notice?.kind).toBe("migrated");
    expect(loaded.notes.key).toBe("edm-010");
    expect(loaded.notes.reference.X.diode).toBe(0.4);
  });

  it("keeps a change whose save failed and writes it on the next try", async () => {
    const n = setValue(emptyNotes("d", "D"), "reference", "PP5V", "voltage", 5);
    markUnsaved(n);
    failSaves = true;
    expect(await saveAllNotes()).toBe(false);
    expect(hasUnsavedNotes()).toBe(true);
    // Opening the board again shows the change, not the old file.
    expect((await loadNotes("d", "d", "D")).notes.reference.PP5V.voltage).toBe(5);
    failSaves = false;
    expect(await saveAllNotes()).toBe(true);
    expect(hasUnsavedNotes()).toBe(false);
    expect(JSON.parse(files.get("d")!).reference.PP5V.voltage).toBe(5);
  });
});
