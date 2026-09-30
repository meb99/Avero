import type { Box } from "./textIndex";

/**
 * View onto a PDF page. Page coordinates are pdf.js viewport units at scale
 * 1 (points, Y down); `x`/`y` is the page point shown at the top-left corner.
 */
export class PageCamera {
  x = 0;
  y = 0;
  scale = 1;
  width = 1;
  height = 1;

  static readonly MIN_SCALE = 0.05;
  static readonly MAX_SCALE = 40;

  toScreen(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.x) * this.scale, y: (py - this.y) * this.scale };
  }

  toPage(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / this.scale + this.x, y: sy / this.scale + this.y };
  }

  /** Visible page area. */
  visible(): Box {
    return { x0: this.x, y0: this.y, x1: this.x + this.width / this.scale, y1: this.y + this.height / this.scale };
  }

  /** Shows `box` centered, at `scale` or smaller if it would not fit. */
  center(box: Box, scale: number, padding = 24): void {
    const w = Math.max(box.x1 - box.x0, 1);
    const h = Math.max(box.y1 - box.y0, 1);
    const fit = Math.min((this.width - 2 * padding) / w, (this.height - 2 * padding) / h);
    this.scale = clamp(Math.min(scale, fit), PageCamera.MIN_SCALE, PageCamera.MAX_SCALE);
    this.x = (box.x0 + box.x1) / 2 - this.width / 2 / this.scale;
    this.y = (box.y0 + box.y1) / 2 - this.height / 2 / this.scale;
  }

  fitPage(pageWidth: number, pageHeight: number, padding = 16): void {
    this.center({ x0: 0, y0: 0, x1: pageWidth, y1: pageHeight }, PageCamera.MAX_SCALE, padding);
  }

  fitWidth(pageWidth: number, padding = 16): void {
    this.scale = clamp((this.width - 2 * padding) / pageWidth, PageCamera.MIN_SCALE, PageCamera.MAX_SCALE);
    this.x = -padding / this.scale;
    this.y = -padding / this.scale;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toPage(sx, sy);
    this.scale = clamp(this.scale * factor, PageCamera.MIN_SCALE, PageCamera.MAX_SCALE);
    this.x = before.x - sx / this.scale;
    this.y = before.y - sy / this.scale;
  }

  pan(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
