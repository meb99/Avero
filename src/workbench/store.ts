import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { readFileBytes, type BoardSource } from "../core/loader";
import { boardKey, emptyNotes, mergeNotes, parseNotes, type BoardNotes } from "./notes";

const SAVE_DELAY_MS = 400;

async function loadNotes(key: string, name: string): Promise<BoardNotes> {
  const json = await invoke<string | null>("load_notes", { key });
  return (json && parseNotes(json)) || emptyNotes(key, name);
}

function saveNotes(notes: BoardNotes): Promise<void> {
  return invoke("save_notes", { key: notes.key, data: JSON.stringify(notes, null, 2) });
}

/**
 * Notes of the open board. Changes are saved shortly after they happen and
 * flushed when the board changes, so nothing typed is lost.
 */
export function useBoardNotes(source: BoardSource | null): {
  notes: BoardNotes | null;
  update(change: (n: BoardNotes) => BoardNotes): void;
  error: string | null;
} {
  const [notes, setNotes] = useState<BoardNotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<BoardNotes | null>(null);
  const timer = useRef(0);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const n = pending.current;
    pending.current = null;
    if (n) saveNotes(n).then(() => setError(null), (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!source) {
      setNotes(null);
      return;
    }
    let cancelled = false;
    const key = boardKey(source);
    loadNotes(key, source.name)
      .then((n) => !cancelled && setNotes(n))
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setNotes(emptyNotes(key, source.name));
      });
    return () => {
      cancelled = true;
      flush();
    };
  }, [source, flush]);

  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [flush]);

  const update = useCallback(
    (change: (n: BoardNotes) => BoardNotes) => {
      setNotes((old) => {
        if (!old) return old;
        const next = change(old);
        pending.current = next;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
        return next;
      });
    },
    [flush],
  );

  return { notes, update, error };
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
