/** App-wide JSON files in Avero's data folder (see `STORES` in lib.rs). */
import { invoke } from "@tauri-apps/api/core";

export type StoreName = "flows" | "datasheets" | "workspace" | "shortcuts";

export async function loadStore(name: StoreName): Promise<string | null> {
  return (await invoke<string | null>("load_store", { name })) ?? null;
}

export async function saveStore(name: StoreName, data: unknown): Promise<void> {
  await invoke("save_store", { name, data: JSON.stringify(data) });
}
