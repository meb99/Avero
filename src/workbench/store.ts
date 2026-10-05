import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { readFileBytes, type BoardSource } from "../core/loader";
import { boardKey, emptyNotes, legacyBoardKey, mergeNotes, parseNotes, type BoardNotes } from "./notes";

const SAVE_DELAY_MS = 400;
/** First retry after a failed save; doubles up to a minute. */
const RETRY_MS = 2000;

/**
 * Notes not yet confirmed on disk, per board key. A board opened again (or
 * the same board through another file) gets these instead of the older file,
 * and they stay here until a save succeeds.
 */
const unsaved = new Map<string, BoardNotes>();
/** Saves of one board run one after another, so an older one never lands last. */
const queues = new Map<string, Promise<void>>();
/** Undo and redo steps per board for this session; switching tabs keeps them. */
const histories = new Map<string, { past: BoardNotes[]; future: BoardNotes[] }>();

/** Keeps a change in memory until it is on disk. */
export function markUnsaved(notes: BoardNotes): void {
  unsaved.set(notes.key, notes);
}

/** Notes in memory that are not on disk yet (for a last save on quit). */
export function hasUnsavedNotes(): boolean {
  return unsaved.size > 0;
}

/** Writes everything unsaved and waits for it (closing, quitting); false when something could not be saved. */
export async function saveAllNotes(): Promise<boolean> {
  const results = await Promise.allSettled([...unsaved.values()].map((n) => saveQueued(n)));
  await Promise.allSettled([...queues.values()]);
  return results.every((r) => r.status === "fulfilled") && unsaved.size === 0;
}

/** Saves `notes` after the saves before it; resolves when it is on disk, rejects on failure. */
function saveQueued(notes: BoardNotes): Promise<void> {
  const before = queues.get(notes.key) ?? Promise.resolve();
  const run = before
    .catch(() => {})
    .then(() => invoke<void>("save_notes", { key: notes.key, data: JSON.stringify(notes, null, 2) }))
    .then(() => {
      // Only forget the change when nothing newer came in meanwhile.
      if (unsaved.get(notes.key) === notes) unsaved.delete(notes.key);
    });
  queues.set(notes.key, run);
  return run;
}

export type LoadedNotes = { notes: BoardNotes; notice?: { kind: "recovered" | "damaged" | "migrated"; detail: string } };

/**
 * A board's notes: what is still unsaved, else the file. A damaged file is
 * moved aside (kept, never overwritten) and the newest readable snapshot
 * taken instead; notes stored under the key of Avero 0.9.23 and older are
 * taken over.
 */
export async function loadNotes(key: string, legacyKey: string, name: string): Promise<LoadedNotes> {
  const waiting = unsaved.get(key);
  if (waiting) return { notes: waiting };
  // A save still running for this board ends before the file is read.
  await queues.get(key)?.catch(() => {});
  const json = await invoke<string | null>("load_notes", { key });
  if (json !== null && json !== undefined) {
    const parsed = parseNotes(json);
    if (parsed) return { notes: { ...parsed, key } };
    const aside = await invoke<string | null>("set_notes_aside", { key });
    const stamps = await invoke<number[]>("note_versions", { key }).catch(() => [] as number[]);
    for (const stamp of stamps) {
      const old = parseNotes(await invoke<string>("load_note_version", { key, stamp }).catch(() => ""));
      if (old) {
        const notes = { ...old, key };
        unsaved.set(key, notes);
        void saveQueued(notes).catch(() => {});
        return { notes, notice: { kind: "recovered", detail: `${new Date(stamp * 1000).toLocaleString()} · ${aside ?? ""}` } };
      }
    }
    return { notes: emptyNotes(key, name), notice: { kind: "damaged", detail: aside ?? "" } };
  }
  if (legacyKey !== key) {
    const old = await invoke<string | null>("load_notes", { key: legacyKey }).catch(() => null);
    const parsed = old ? parseNotes(old) : null;
    if (parsed) return { notes: { ...parsed, key }, notice: { kind: "migrated", detail: legacyKey } };
  }
  return { notes: emptyNotes(key, name) };
}

/**
 * Notes of the open board. Changes are saved shortly after they happen and
 * flushed when the board changes; a failed save is retried until it works,
 * and the change stays in memory meanwhile, so nothing typed is lost.
 */
/** Most steps that can be undone per board. */
const UNDO_STEPS = 100;

export function useBoardNotes(source: BoardSource | null): {
  notes: BoardNotes | null;
  update(change: (n: BoardNotes) => BoardNotes): void;
  /** Takes back the last change (a reading, a note, a case …); false when there is none. */
  undo(): boolean;
  redo(): boolean;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  /** Something the user should know about the notes just opened (recovered, taken over). */
  notice: LoadedNotes["notice"] | null;
} {
  const [notes, setNotes] = useState<BoardNotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<LoadedNotes["notice"] | null>(null);
  const timer = useRef(0);
  const retry = useRef({ timer: 0, delay: RETRY_MS });
  const [, setHistoryRevision] = useState(0);

  /** Writes every unsaved board; on failure keeps them and tries again later. */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    for (const n of [...unsaved.values()]) {
      saveQueued(n).then(
        () => {
          retry.current.delay = RETRY_MS;
          if (unsaved.size === 0) setError(null);
        },
        (e) => {
          setError(String(e));
          window.clearTimeout(retry.current.timer);
          retry.current.timer = window.setTimeout(flush, retry.current.delay);
          retry.current.delay = Math.min(retry.current.delay * 2, 60_000);
        },
      );
    }
  }, []);

  useEffect(() => {
    if (!source) {
      setNotes(null);
      return;
    }
    let cancelled = false;
    // Never show one board's notes on another while loading.
    setNotes(null);
    setNotice(null);
    const key = boardKey(source);
    loadNotes(key, legacyBoardKey(source), source.name)
      .then((loaded) => {
        if (cancelled) return;
        setNotes(loaded.notes);
        setNotice(loaded.notice ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        // Not readable at all: show it, and keep editing off the file until it is.
        setError(String(e));
        setNotes(null);
      });
    return () => {
      cancelled = true;
      flush();
    };
  }, [source, flush]);

  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.clearTimeout(retry.current.timer);
    };
  }, [flush]);

  const schedule = useCallback(
    (next: BoardNotes) => {
      markUnsaved(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const update = useCallback(
    (change: (n: BoardNotes) => BoardNotes) => {
      setNotes((old) => {
        if (!old) return old;
        const next = change(old);
        if (next === old) return old;
        const h = histories.get(old.key) ?? { past: [], future: [] };
        histories.set(old.key, { past: [...h.past, old].slice(-UNDO_STEPS), future: [] });
        setHistoryRevision((r) => r + 1);
        schedule(next);
        return next;
      });
    },
    [schedule],
  );

  const step = useCallback(
    (direction: "undo" | "redo"): boolean => {
      if (!notes) return false;
      const h = histories.get(notes.key) ?? { past: [], future: [] };
      const from = direction === "undo" ? h.past : h.future;
      const target = from.at(-1);
      if (!target) return false;
      const rest = from.slice(0, -1);
      const other = [...(direction === "undo" ? h.future : h.past), notes].slice(-UNDO_STEPS);
      histories.set(notes.key, direction === "undo" ? { past: rest, future: other } : { past: other, future: rest });
      // Saved like any change, with a fresh time stamp so imports and syncs see it as newest.
      const next = { ...target, updated: new Date().toISOString() };
      setNotes(next);
      setHistoryRevision((r) => r + 1);
      schedule(next);
      return true;
    },
    [notes, schedule],
  );
  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);
  const h = notes ? histories.get(notes.key) : undefined;

  return { notes, update, undo, redo, canUndo: (h?.past.length ?? 0) > 0, canRedo: (h?.future.length ?? 0) > 0, error, notice };
}

/** Save panel, then writes the notes as JSON. Resolves false when cancelled. */
export async function exportNotes(notes: BoardNotes, title: string): Promise<boolean> {
  const path = await save({ title, defaultPath: `${notes.key}-avero.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path) return false;
  await invoke("export_json", { path, data: JSON.stringify(notes, null, 2) });
  return true;
}

/** Open panel for a notes export; returns the notes merged with it. */
export async function importNotes(into: BoardNotes, title: string): Promise<BoardNotes | null> {
  const path = await open({ title, multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (typeof path !== "string") return null;
  const theirs = parseNotes(new TextDecoder().decode(await readFileBytes(path)));
  if (!theirs) throw new Error("not an Avero export");
  return mergeNotes(into, theirs);
}
