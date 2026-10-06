/**
 * The workspace to bring back on the next start: open boards with their
 * schematic, side, rotation and view, the active tab and the window frame.
 */
import type { ViewSide } from "../core/board";

export interface WorkspaceTab {
  path: string;
  /** The document shown. */
  schematicPath?: string;
  /** All documents open for the board, in their order (the shown one among them). */
  schematicPaths?: string[];
  schematicVisible: boolean;
  side: ViewSide;
  rotation: number;
  view?: { centerX: number; centerY: number; scale: number };
}

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  /** In points (logical pixels); older workspaces saved device pixels. */
  logical?: boolean;
}

export interface Workspace {
  version: 1;
  tabs: WorkspaceTab[];
  active: number;
  window?: WindowFrame;
}

const finite = (...v: unknown[]) => v.every((x) => typeof x === "number" && Number.isFinite(x));

export function parseWorkspace(json: string | null): Workspace | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Partial<Workspace>;
    if (d.version !== 1 || !Array.isArray(d.tabs)) return null;
    const tabs = d.tabs.flatMap((t): WorkspaceTab[] => {
      if (!t || typeof t.path !== "string" || !t.path) return [];
      const v = t.view;
      return [
        {
          path: t.path,
          ...(typeof t.schematicPath === "string" && t.schematicPath && { schematicPath: t.schematicPath }),
          ...(Array.isArray(t.schematicPaths) && {
            schematicPaths: t.schematicPaths.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 24),
          }),
          schematicVisible: t.schematicVisible !== false,
          side: t.side === "bottom" ? "bottom" : "top",
          rotation: finite(t.rotation) ? t.rotation & 3 : 0,
          ...(v && finite(v.centerX, v.centerY, v.scale) && v.scale > 0 && { view: { centerX: v.centerX, centerY: v.centerY, scale: v.scale } }),
        },
      ];
    });
    const w = d.window;
    return {
      version: 1,
      tabs,
      active: finite(d.active) ? Math.min(Math.max(0, d.active as number), Math.max(0, tabs.length - 1)) : 0,
      ...(w && finite(w.x, w.y, w.width, w.height) && w.width > 200 && w.height > 150 && { window: { x: w.x, y: w.y, width: w.width, height: w.height, maximized: !!w.maximized, ...(w.logical === true && { logical: true }) } }),
    };
  } catch {
    return null;
  }
}
