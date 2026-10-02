/** Full local backup: library, data folder and settings in one ZIP (see backup.rs). */
import { invoke } from "@tauri-apps/api/core";

/** Avero's own entries in the web view's storage (settings, library folders, recent files …). */
export function storedSettings(): string {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("avero.")) out[key] = localStorage.getItem(key) ?? "";
    }
  } catch {
    // Storage unavailable: the backup simply has no settings.
  }
  return JSON.stringify(out);
}

export function restoreSettings(json: string | null): void {
  if (!json) return;
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) if (key.startsWith("avero.") && typeof value === "string") localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export interface BackupSummary {
  files: number;
  bytes: number;
}

export async function createBackup(title: string): Promise<BackupSummary | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const date = new Date().toISOString().slice(0, 10);
  const path = await save({ title, defaultPath: `Avero-Sicherung-${date}.zip`, filters: [{ name: "ZIP", extensions: ["zip"] }] });
  if (!path) return null;
  return invoke<BackupSummary>("backup_create", { path, settings: storedSettings(), created: new Date().toISOString() });
}

export interface RestoreResult extends BackupSummary {
  settings: string | null;
  created: string;
  app: string;
}

export async function pickAndRestoreBackup(title: string, confirm: (created: string) => Promise<boolean>): Promise<RestoreResult | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ title, multiple: false, directory: false, filters: [{ name: "ZIP", extensions: ["zip"] }] });
  if (typeof path !== "string") return null;
  if (!(await confirm(path))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = await invoke<RestoreResult>("backup_restore", { path, stamp });
  restoreSettings(result.settings);
  return result;
}

export function formatBytes(bytes: number, lang: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: i ? 1 : 0 }).format(v)} ${units[i]}`;
}
