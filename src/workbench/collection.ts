import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface CollectionProgress { completed: number; total: number; name: string }
export interface CollectionResult {
  imported: string[];
  duplicates: number;
  boards: number;
  schematics: number;
  converted: number;
  skipped: number;
  errors: string[];
}

export async function pickCollection(title: string): Promise<string | null> {
  const selected = await open({ title, multiple: false, directory: false, filters: [{ name: "Konsolen-Sammlung", extensions: ["zip"] }] });
  return typeof selected === "string" ? selected : null;
}

export function importCollection(path: string, xzzKey: string, progress: (value: CollectionProgress) => void): Promise<CollectionResult> {
  const onProgress = new Channel<CollectionProgress>();
  onProgress.onmessage = progress;
  return invoke<CollectionResult>("import_console_collection", { path, xzzKey: xzzKey.trim() || null, onProgress });
}
