/**
 * Window frames that survive a missing monitor or another resolution: a
 * saved frame is put back only where a screen still shows it, otherwise it
 * moves onto the first screen. All values are logical pixels (points).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** At least this much of the title bar must be on a screen to leave a frame where it is. */
const GRIP = 80;

function overlap(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Where to put a saved frame on the screens there are now. It stays when
 * its title bar can still be grabbed on a screen (shrunk to fit that
 * screen); otherwise it is centred on the first screen. No screens known:
 * the frame as it is.
 */
export function placeOnScreens(frame: Rect, screens: Rect[]): Rect {
  if (screens.length === 0) return frame;
  const titleBar = { x: frame.x, y: frame.y, width: frame.width, height: 28 };
  const home = screens.find((s) => {
    const o = overlap(titleBar, s);
    return o !== null && o.width >= Math.min(GRIP, frame.width);
  });
  if (home) {
    const width = Math.min(frame.width, home.width);
    const height = Math.min(frame.height, home.height);
    // Pulled inside the screen where it sticks out.
    const x = Math.min(Math.max(frame.x, home.x), home.x + home.width - width);
    const y = Math.min(Math.max(frame.y, home.y), home.y + home.height - height);
    return { x, y, width, height };
  }
  const screen = screens[0];
  const width = Math.min(frame.width, Math.round(screen.width * 0.9));
  const height = Math.min(frame.height, Math.round(screen.height * 0.9));
  return {
    x: Math.round(screen.x + (screen.width - width) / 2),
    y: Math.round(screen.y + (screen.height - height) / 2),
    width,
    height,
  };
}

/** The screens there are now, in logical pixels (none outside the desktop app). */
export async function currentScreens(): Promise<Rect[]> {
  try {
    const { availableMonitors } = await import("@tauri-apps/api/window");
    const monitors = await availableMonitors();
    return monitors.map((m) => {
      const area = m.workArea ?? { position: m.position, size: m.size };
      const f = m.scaleFactor || 1;
      return { x: area.position.x / f, y: area.position.y / f, width: area.size.width / f, height: area.size.height / f };
    });
  } catch {
    return [];
  }
}

const SCHEMATIC_FRAME_KEY = "avero.schematicWindow.frame";

/** The separate schematic window's last frame (logical pixels). */
export function savedSchematicFrame(): Rect | null {
  try {
    const v = JSON.parse(localStorage.getItem(SCHEMATIC_FRAME_KEY) ?? "null") as Rect | null;
    return v && [v.x, v.y, v.width, v.height].every((n) => typeof n === "number" && Number.isFinite(n)) && v.width > 200 && v.height > 150 ? v : null;
  } catch {
    return null;
  }
}

export function saveSchematicFrame(frame: Rect): void {
  try {
    localStorage.setItem(SCHEMATIC_FRAME_KEY, JSON.stringify(frame));
  } catch {
    // Only a convenience.
  }
}
