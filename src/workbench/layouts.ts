/**
 * Workbench layouts: which panes are open beside the board, how much room
 * each gets and how the sidebar is set. Everything is kept as shares and
 * weights rather than pixels, so a layout fits another screen, resolution
 * or scaling.
 */
import type { DockPane, SavedLayout } from "../settings";

/** Order of the panes stacked beside the board, top to bottom. */
export const DOCK_ORDER: DockPane[] = ["camera", "photo", "sheet", "schematic"];

export type PresetId = "repair" | "schematic" | "bga" | "compare" | "microscope";

/** Built-in layouts; their names come from the translations (`layout.<id>`). */
export const PRESETS: Record<PresetId, SavedLayout & { compare?: boolean }> = {
  repair: { name: "repair", share: 0.42, panes: ["schematic"], weights: {}, sidebar: true, sidebarTab: "measure", boardHidden: false, bothSides: null },
  schematic: { name: "schematic", share: 0.66, panes: ["schematic"], weights: {}, sidebar: true, sidebarTab: "details", boardHidden: false, bothSides: null },
  bga: { name: "bga", share: 0.34, panes: [], weights: {}, sidebar: true, sidebarTab: "details", boardHidden: false, bothSides: "separate" },
  compare: { name: "compare", share: 0.5, panes: [], weights: {}, sidebar: true, sidebarTab: "details", boardHidden: false, bothSides: null, compare: true },
  microscope: {
    name: "microscope",
    share: 0.45,
    panes: ["camera", "schematic"],
    weights: { camera: 1.2, schematic: 1 },
    sidebar: true,
    sidebarTab: "measure",
    boardHidden: false,
    bothSides: null,
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export const MIN_SHARE = 0.2;
export const MAX_SHARE = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Sidebar width in pixels for a layout on a window this wide. */
export function sidebarPixels(layout: SavedLayout, windowWidth: number, fallback: number): number {
  const wanted = layout.sidebarShare !== undefined ? layout.sidebarShare * windowWidth : fallback;
  // Never more than half the window, never too narrow to read.
  return Math.round(clamp(wanted, 240, Math.max(240, windowWidth * 0.5)));
}

const PANES = new Set<DockPane>(DOCK_ORDER);
const SIDE_MODES = new Set(["together", "separate", "synced"]);

/** One stored layout, checked; `undefined` when it is not one. */
export function parseLayout(v: unknown): SavedLayout | undefined {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Record<string, unknown>;
  if (typeof d.name !== "string" || !d.name.trim()) return undefined;
  const share = typeof d.share === "number" && Number.isFinite(d.share) ? clamp(d.share, MIN_SHARE, MAX_SHARE) : 0.5;
  const panes = Array.isArray(d.panes) ? DOCK_ORDER.filter((p) => (d.panes as unknown[]).includes(p)) : [];
  const weights: Partial<Record<DockPane, number>> = {};
  if (d.weights && typeof d.weights === "object") {
    for (const [k, w] of Object.entries(d.weights as Record<string, unknown>)) {
      if (PANES.has(k as DockPane) && typeof w === "number" && Number.isFinite(w) && w > 0) weights[k as DockPane] = clamp(w, 0.05, 20);
    }
  }
  const sidebarShare = typeof d.sidebarShare === "number" && Number.isFinite(d.sidebarShare) ? clamp(d.sidebarShare, 0.1, 0.5) : undefined;
  return {
    name: d.name.trim().slice(0, 60),
    share,
    panes,
    weights,
    sidebar: d.sidebar !== false,
    ...(typeof d.sidebarTab === "string" && { sidebarTab: d.sidebarTab }),
    ...(sidebarShare !== undefined && { sidebarShare }),
    boardHidden: d.boardHidden === true,
    bothSides: typeof d.bothSides === "string" && SIDE_MODES.has(d.bothSides) ? (d.bothSides as SavedLayout["bothSides"]) : null,
  };
}

/** Stored layouts, broken entries dropped, one per name (the later wins). */
export function parseLayouts(v: unknown): SavedLayout[] {
  if (!Array.isArray(v)) return [];
  const byName = new Map<string, SavedLayout>();
  for (const item of v) {
    const layout = parseLayout(item);
    if (layout) byName.set(layout.name.toLowerCase(), layout);
  }
  return [...byName.values()];
}

/** Adds or replaces a layout by name (ignoring case). */
export function withLayout(list: SavedLayout[], layout: SavedLayout): SavedLayout[] {
  const key = layout.name.toLowerCase();
  return [...list.filter((l) => l.name.toLowerCase() !== key), layout];
}

/** Flex weights for the open panes: the stored ones, 1 for the rest. */
export function paneWeights(open: DockPane[], weights: Partial<Record<DockPane, number>> | undefined): Record<string, number> {
  return Object.fromEntries(open.map((p) => [p, weights?.[p] ?? 1]));
}
