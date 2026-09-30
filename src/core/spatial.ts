import type { Bounds } from "./types";

/**
 * Uniform grid for rectangle and point queries. Boards are roughly evenly
 * populated, so a grid sized to the item count beats a tree in both build
 * time and query speed.
 */
export class GridIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;

  constructor(bounds: Bounds, expectedItems: number) {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    // Aim for a handful of items per cell.
    this.cellSize = Math.max(Math.sqrt((w * h) / Math.max(expectedItems / 4, 1)), 1);
    this.minX = bounds.minX;
    this.minY = bounds.minY;
    this.cols = Math.ceil(w / this.cellSize) + 1;
  }

  private col(x: number): number {
    return Math.max(0, Math.floor((x - this.minX) / this.cellSize));
  }

  private row(y: number): number {
    return Math.max(0, Math.floor((y - this.minY) / this.cellSize));
  }

  insert(id: number, b: Bounds): void {
    const c0 = this.col(b.minX);
    const c1 = this.col(b.maxX);
    const r0 = this.row(b.minY);
    const r1 = this.row(b.maxY);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = r * this.cols + c;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(id);
      }
    }
  }

  /** Ids whose bounds may intersect `b`. May contain duplicates for large items. */
  query(b: Bounds, visit: (id: number) => void): void {
    const c0 = this.col(b.minX);
    const c1 = Math.min(this.col(b.maxX), this.cols - 1);
    const r0 = this.row(b.minY);
    const r1 = this.row(b.maxY);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells.get(r * this.cols + c);
        if (cell) for (const id of cell) visit(id);
      }
    }
  }
}
