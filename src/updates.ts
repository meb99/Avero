/** Checks GitHub for a newer Avero release, at most once an hour. */

const LATEST = "https://api.github.com/repos/meb99/Avero/releases/latest";
const KEY = "avero.updateCheck.v1";
const DAY_MS = 60 * 60 * 1000;

export interface Update {
  version: string;
  url: string;
}

/** Compares dotted versions: 0.10.0 > 0.9.2. Leading "v" is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, "").split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * Latest release if it is newer than `current`; null when up to date. In
 * the app the request goes through macOS' curl (see updater.rs), so it
 * never hangs in or gets blocked by the web view.
 */
export async function fetchUpdate(current: string): Promise<Update | null> {
  // Local mode is binding: no request leaves the Mac, whoever asks.
  if (localModeOn()) throw new Error("local mode");
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<Update | null>("check_update", { current })) ?? null;
  }
  const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 404) return null; // no release yet
  if (!res.ok) throw new Error(`GitHub: ${res.status}`);
  const release = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean };
  if (!release.tag_name || release.draft || release.prerelease) return null;
  return isNewer(release.tag_name, current)
    ? { version: release.tag_name.replace(/^v/i, ""), url: release.html_url ?? "https://github.com/meb99/Avero/releases" }
    : null;
}

/** Local mode, read from the stored settings (so no caller can forget it). */
export function localModeOn(): boolean {
  try {
    return (JSON.parse(localStorage.getItem("avero.settings.v1") ?? "{}") as { localMode?: boolean }).localMode === true;
  } catch {
    return false;
  }
}

/** Background check, skipped when the last one was less than a day ago, and always in local mode. */
export async function dailyCheck(current: string): Promise<Update | null> {
  if (localModeOn()) return null;
  try {
    const last = Number(localStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < DAY_MS) return null;
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Without storage, check every start.
  }
  try {
    return await fetchUpdate(current);
  } catch {
    return null;
  }
}
