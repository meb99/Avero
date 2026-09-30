import type { Bounds, Point } from "./types";

/**
 * Maps board coordinates (mils, Y up) to screen pixels (Y down).
 *
 * The view can be mirrored (looking at the bottom side, the board is flipped
 * left-to-right as if turned over in your hand) and rotated in quarter turns.
 */
export class Camera {
  centerX = 0;
  centerY = 0;
  /** Screen pixels per mil. */
  scale = 1;
  /** Clockwise quarter turns on screen. */
  rotation = 0;
  mirrored = false;
  width = 1;
  height = 1;

  static readonly MIN_SCALE = 0.005;
  static readonly MAX_SCALE = 80;

  clone(): Camera {
    return Object.assign(new Camera(), this);
  }

  /** Affine transform [a, b, c, d, e, f] with X = a·x + c·y + e, Y = b·x + d·y + f. */
  matrix(): [number, number, number, number, number, number] {
    const s = this.scale;
    const m = this.mirrored ? -1 : 1;
    // Local screen vector for a world unit step in x and y before rotation.
    let ax = m * s;
    let ay = 0;
    let cx = 0;
    let cy = -s;
    for (let i = 0; i < (this.rotation & 3); i++) {
      // Clockwise quarter turn in Y-down screen space: (u, v) -> (-v, u).
      [ax, ay] = [-ay, ax];
      [cx, cy] = [-cy, cx];
    }
    const e = this.width / 2 - (ax * this.centerX + cx * this.centerY);
    const f = this.height / 2 - (ay * this.centerX + cy * this.centerY);
    return [ax, ay, cx, cy, e, f];
  }

  toScreen(p: Point): Point {
    const [a, b, c, d, e, f] = this.matrix();
    return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
  }

  toWorld(p: Point): Point {
    const [a, b, c, d, e, f] = this.matrix();
    const det = a * d - b * c;
    const x = p.x - e;
    const y = p.y - f;
    return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
  }

  /** World-space rectangle currently visible, padded by `marginPx`. */
  visibleBounds(marginPx = 0): Bounds {
    const corners = [
      this.toWorld({ x: -marginPx, y: -marginPx }),
      this.toWorld({ x: this.width + marginPx, y: -marginPx }),
      this.toWorld({ x: -marginPx, y: this.height + marginPx }),
      this.toWorld({ x: this.width + marginPx, y: this.height + marginPx }),
    ];
    return {
      minX: Math.min(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxX: Math.max(...corners.map((c) => c.x)),
      maxY: Math.max(...corners.map((c) => c.y)),
    };
  }

  /** Centers `bounds` and zooms so it fills the view with some padding. */
  fit(bounds: Bounds, paddingPx = 40, maxScale = Camera.MAX_SCALE): void {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const sideways = (this.rotation & 1) === 1;
    const [bw, bh] = sideways ? [h, w] : [w, h];
    const availW = Math.max(this.width - 2 * paddingPx, 10);
    const availH = Math.max(this.height - 2 * paddingPx, 10);
    this.scale = clamp(Math.min(availW / bw, availH / bh), Camera.MIN_SCALE, maxScale);
    this.centerX = (bounds.minX + bounds.maxX) / 2;
    this.centerY = (bounds.minY + bounds.maxY) / 2;
  }

  /** Zooms by `factor`, keeping the world point under `screen` fixed. */
  zoomAt(screen: Point, factor: number): void {
    const before = this.toWorld(screen);
    this.scale = clamp(this.scale * factor, Camera.MIN_SCALE, Camera.MAX_SCALE);
    const after = this.toWorld(screen);
    this.centerX += before.x - after.x;
    this.centerY += before.y - after.y;
  }

  /** Moves the view by a screen-space delta. */
  pan(dx: number, dy: number): void {
    const a = this.toWorld({ x: 0, y: 0 });
    const b = this.toWorld({ x: dx, y: dy });
    this.centerX -= b.x - a.x;
    this.centerY -= b.y - a.y;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Interpolates between two cameras for fly-to animations (zoom in log space). */
export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const c = to.clone();
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  c.centerX = from.centerX + (to.centerX - from.centerX) * e;
  c.centerY = from.centerY + (to.centerY - from.centerY) * e;
  c.scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e);
  return c;
}
