import { GridIndex } from "./spatial";
import type { Board, Bounds, Net, Part, Pin, Point, Selection, Side, TestPoint } from "./types";

export type ViewSide = "top" | "bottom";

export function visibleFrom(side: Side, view: ViewSide): boolean {
  return side === "both" || side === view;
}

/** A net reached through a series part (coil, fuse, 0 Ω resistor …). */
export interface SeriesLink {
  net: number;
  /** The part that connects it to the previous net in the chain. */
  via: number;
  /** The net on the other side of `via`. */
  from: number;
}

/** Parts that pass a signal through, by designator prefix. */
const SERIES_PREFIX = /^(L|FB|FL|F|FU|XW|JP|SJ)\d/i;
const ZERO_OHM = /^(0|0R|0R0|0\.0|0Ω|0 ?OHMS?)\b/i;

export type Hit =
  | { kind: "pin"; pin: number }
  | { kind: "testPoint"; testPoint: number }
  | { kind: "part"; part: number };

/** A loaded board plus the lookup structures the UI needs. */
export class BoardModel {
  readonly partIndex: GridIndex;
  readonly pinIndex: GridIndex;
  readonly testPointIndex: GridIndex;
  private readonly partsByName = new Map<string, number>();
  private readonly netsByName = new Map<string, number>();
  /** Parts sorted by name for list views. */
  readonly sortedParts: number[];
  /** Nets sorted by name, unconnected last. */
  readonly sortedNets: number[];
  private readonly ratsnestCache = new Map<number, [number, number][]>();
  private readonly seriesCache = new Map<number, SeriesLink[]>();

  constructor(readonly board: Board) {
    const b = board.bounds;
    this.partIndex = new GridIndex(b, board.parts.length);
    this.pinIndex = new GridIndex(b, board.pins.length);
    this.testPointIndex = new GridIndex(b, board.testPoints.length);

    board.parts.forEach((p, i) => {
      this.partIndex.insert(i, p.bounds);
      if (!this.partsByName.has(p.name.toUpperCase())) this.partsByName.set(p.name.toUpperCase(), i);
    });
    board.pins.forEach((p, i) => this.pinIndex.insert(i, circleBounds(p)));
    board.testPoints.forEach((t, i) => this.testPointIndex.insert(i, circleBounds(t)));
    board.nets.forEach((n, i) => this.netsByName.set(n.name.toUpperCase(), i));

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    this.sortedParts = board.parts.map((_, i) => i).sort((a, b) => collator.compare(board.parts[a].name, board.parts[b].name));
    this.sortedNets = board.nets
      .map((_, i) => i)
      .sort((a, b) => {
        const ua = board.nets[a].kind === "unconnected" ? 1 : 0;
        const ub = board.nets[b].kind === "unconnected" ? 1 : 0;
        return ua - ub || collator.compare(board.nets[a].name, board.nets[b].name);
      });
  }

  get parts(): Part[] {
    return this.board.parts;
  }

  get pins(): Pin[] {
    return this.board.pins;
  }

  get nets(): Net[] {
    return this.board.nets;
  }

  get testPoints(): TestPoint[] {
    return this.board.testPoints;
  }

  findPart(name: string): number | undefined {
    return this.partsByName.get(name.trim().toUpperCase());
  }

  findNet(name: string): number | undefined {
    return this.netsByName.get(name.trim().toUpperCase());
  }

  /** Pin of `part` whose designator matches `number`, case-insensitive. */
  findPin(part: number, number: string): number | undefined {
    const p = this.parts[part];
    const wanted = number.trim().toUpperCase();
    for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
      if (this.pins[i].number.toUpperCase() === wanted) return i;
    }
    return undefined;
  }

  pinLabel(pin: number): string {
    const p = this.pins[pin];
    return `${this.parts[p.part].name}.${p.number}`;
  }

  /** Net highlighted by a selection, if highlighting it makes sense. */
  selectedNet(sel: Selection): number | undefined {
    let net: number | undefined;
    if (sel.kind === "pin") net = this.pins[sel.pin].net;
    else if (sel.kind === "testPoint") net = this.testPoints[sel.testPoint].net;
    else if (sel.kind === "net") net = sel.net;
    if (net === undefined || this.nets[net].kind === "unconnected") return undefined;
    return net;
  }

  /** The part a selection belongs to, if any. */
  selectedPart(sel: Selection): number | undefined {
    if (sel.kind === "part") return sel.part;
    if (sel.kind === "pin") return this.pins[sel.pin].part;
    return undefined;
  }

  /**
   * True for two-pin parts that connect their nets for tracing purposes:
   * coils, ferrites, fuses, net ties, jumpers and 0 Ω resistors.
   */
  isSeriesPart(part: number): boolean {
    const p = this.parts[part];
    if (p.pinCount !== 2) return false;
    if (SERIES_PREFIX.test(p.name)) return true;
    return /^R\d/i.test(p.name) && !!p.device && ZERO_OHM.test(p.device.trim());
  }

  /**
   * Nets reachable from `net` through series parts, breadth first, with the
   * part that links each one. Ground and unconnected nets end a chain.
   */
  seriesLinks(net: number): SeriesLink[] {
    const cached = this.seriesCache.get(net);
    if (cached) return cached;
    const out: SeriesLink[] = [];
    const seen = new Set([net]);
    const queue = [net];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const pin of this.nets[current].pins) {
        const part = this.pins[pin].part;
        if (!this.isSeriesPart(part)) continue;
        const p = this.parts[part];
        for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
          const other = this.pins[i].net;
          const kind = this.nets[other].kind;
          if (seen.has(other) || kind === "ground" || kind === "unconnected") continue;
          seen.add(other);
          out.push({ net: other, via: part, from: current });
          queue.push(other);
        }
      }
    }
    this.seriesCache.set(net, out);
    return out;
  }

  /**
   * Connection lines for a net: a minimum spanning tree over its pins, so
   * every pin is linked to its nearest neighbour without clutter. Returns
   * pairs of pin indices. Very large nets (ground) are skipped.
   */
  ratsnest(net: number, maxPins = 2500): [number, number][] {
    const cached = this.ratsnestCache.get(net);
    if (cached) return cached;
    const pins = this.nets[net].pins;
    const n = pins.length;
    const edges: [number, number][] = [];
    if (n >= 2 && n <= maxPins) {
      // Prim's algorithm on the complete graph, O(n²) without a heap.
      const inTree = new Uint8Array(n);
      const best = new Float64Array(n).fill(Infinity);
      const parent = new Int32Array(n).fill(-1);
      best[0] = 0;
      for (let k = 0; k < n; k++) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
        inTree[u] = 1;
        if (parent[u] >= 0) edges.push([pins[parent[u]], pins[u]]);
        const a = this.pins[pins[u]];
        for (let i = 0; i < n; i++) {
          if (inTree[i]) continue;
          const b = this.pins[pins[i]];
          const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (d < best[i]) {
            best[i] = d;
            parent[i] = u;
          }
        }
      }
    }
    this.ratsnestCache.set(net, edges);
    return edges;
  }

  /** Parts touched by a net with the pins involved, sorted by part name. */
  netMembers(net: number): { part: number; pins: number[] }[] {
    const byPart = new Map<number, number[]>();
    for (const pin of this.nets[net].pins) {
      const part = this.pins[pin].part;
      let list = byPart.get(part);
      if (!list) byPart.set(part, (list = []));
      list.push(pin);
    }
    const collator = new Intl.Collator(undefined, { numeric: true });
    return [...byPart.entries()]
      .map(([part, pins]) => ({ part, pins }))
      .sort((a, b) => collator.compare(this.parts[a.part].name, this.parts[b.part].name));
  }

  /** Bounds that frame a selection, for zoom-to. */
  selectionBounds(sel: Selection): Bounds | undefined {
    switch (sel.kind) {
      case "none":
        return undefined;
      case "part": {
        // Small parts get some surroundings, like single pins.
        const b = this.parts[sel.part].bounds;
        return padBounds(b, Math.max((b.maxX - b.minX + b.maxY - b.minY) * 0.1, 120));
      }
      // Single pads get some surroundings so you can see where you are.
      case "pin":
        return padBounds(circleBounds(this.pins[sel.pin]), Math.max(this.pins[sel.pin].radius * 15, 150));
      case "testPoint":
        return padBounds(circleBounds(this.testPoints[sel.testPoint]), Math.max(this.testPoints[sel.testPoint].radius * 15, 150));
      case "net": {
        const net = this.nets[sel.net];
        const pts: Point[] = [...net.pins.map((i) => this.pins[i]), ...net.testPoints.map((i) => this.testPoints[i])];
        if (pts.length === 0) return undefined;
        const b = boundsOf(pts);
        return padBounds(b, 40);
      }
    }
  }

  /**
   * What is under a world-space point on the visible side. Pins and test
   * points win over part bodies; among bodies the smallest one wins so that
   * small parts inside connectors or shields stay clickable.
   */
  hitTest(p: Point, view: ViewSide, tolerance: number, showVias: boolean): Hit | undefined {
    const probe: Bounds = { minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance };

    let best: Hit | undefined;
    let bestDist = Infinity;
    this.pinIndex.query(probe, (i) => {
      const pin = this.pins[i];
      if (!visibleFrom(pin.side, view)) return;
      const d = Math.hypot(pin.x - p.x, pin.y - p.y) - pin.radius;
      if (d <= tolerance && d < bestDist) {
        bestDist = d;
        best = { kind: "pin", pin: i };
      }
    });
    this.testPointIndex.query(probe, (i) => {
      const t = this.testPoints[i];
      if (!visibleFrom(t.side, view) || (t.kind === "via" && !showVias)) return;
      const d = Math.hypot(t.x - p.x, t.y - p.y) - t.radius;
      if (d <= tolerance && d < bestDist) {
        bestDist = d;
        best = { kind: "testPoint", testPoint: i };
      }
    });
    if (best) return best;

    let bestArea = Infinity;
    this.partIndex.query(probe, (i) => {
      const part = this.parts[i];
      if (!visibleFrom(part.side, view)) return;
      const b = part.bounds;
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) return;
      if (part.outline.length >= 3 && !pointInPolygon(p, part.outline)) return;
      const area = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (area < bestArea) {
        bestArea = area;
        best = { kind: "part", part: i };
      }
    });
    return best;
  }
}

export function circleBounds(c: { x: number; y: number; radius: number }): Bounds {
  return { minX: c.x - c.radius, minY: c.y - c.radius, maxX: c.x + c.radius, maxY: c.y + c.radius };
}

export function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export function boundsOf(points: Point[]): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
