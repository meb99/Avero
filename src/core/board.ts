import { GridIndex } from "./spatial";
import { passesThrough } from "./partRole";
import type { Board, Bounds, Net, Part, Pin, Point, Selection, Side, TestPoint, Trace, Layer, NetKind } from "./types";

export type ViewSide = "top" | "bottom";

export function visibleFrom(side: Side, view: ViewSide): boolean {
  return side === "both" || side === view;
}

/** The sides a net has pins or test points on. */
export function netSides(model: BoardModel, net: number): ViewSide | "both" | undefined {
  let top = false;
  let bottom = false;
  const n = model.nets[net];
  for (const s of [...n.pins.map((i) => model.pins[i].side), ...n.testPoints.filter((i) => !model.testPoints[i].via?.buried).map((i) => model.testPoints[i].side)]) {
    if (s !== "bottom") top = true;
    if (s !== "top") bottom = true;
    if (top && bottom) return "both";
  }
  return top ? "top" : bottom ? "bottom" : undefined;
}

/** A net reached through a series part (coil, fuse, 0 Ω resistor …). */
export interface SeriesLink {
  net: number;
  /** The part that connects it to the previous net in the chain. */
  via: number;
  /** The net on the other side of `via`. */
  from: number;
}


export type Hit =
  | { kind: "pin"; pin: number }
  | { kind: "testPoint"; testPoint: number }
  | { kind: "trace"; trace: number; net: number }
  | { kind: "part"; part: number };

/** Footprint names of chips and connectors, as opposed to small parts. */
const CHIP_FOOTPRINT = /^(BGA|LGA|QFN|QFP|DFN|SON|SOP|SOIC|TSSOP|SSOP|SOT|CSP|WLCSP|IC|U\d|CPU|SOC|PMIC|J|CN|CON|USB|HDMI|SIM|SD)/i;

/** Marker size in CSS pixels for parts whose size is unknown. */
export function markerSize(part: Part): number {
  return CHIP_FOOTPRINT.test(part.name) ? 7 : 3;
}

export function partCenter(part: Part): Point {
  const b = part.bounds;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** A loaded board plus the lookup structures the UI needs. */
export class BoardModel {
  readonly partIndex: GridIndex;
  readonly pinIndex: GridIndex;
  readonly testPointIndex: GridIndex;
  readonly traceIndex: GridIndex;
  private readonly partsByName = new Map<string, number>();
  private netsByName = new Map<string, number>();
  /** Net names as the file has them; `nets[i].name` may be the user's own. */
  private readonly fileNetNames: string[];
  private readonly fileNetKinds: NetKind[];
  /** Parts sorted by name for list views. */
  readonly sortedParts: number[];
  /** Nets sorted by name, unconnected last. */
  sortedNets: number[] = [];
  private readonly ratsnestCache = new Map<string, [number, number][]>();
  private readonly seriesCache = new Map<number, SeriesLink[]>();

  constructor(readonly board: Board) {
    const b = board.bounds;
    this.partIndex = new GridIndex(b, board.parts.length);
    this.pinIndex = new GridIndex(b, board.pins.length);
    this.testPointIndex = new GridIndex(b, board.testPoints.length);
    this.traceIndex = new GridIndex(b, this.traces.length);

    board.parts.forEach((p, i) => {
      this.partIndex.insert(i, p.bounds);
      if (!this.partsByName.has(p.name.toUpperCase())) this.partsByName.set(p.name.toUpperCase(), i);
    });
    board.pins.forEach((p, i) => this.pinIndex.insert(i, circleBounds(p)));
    board.testPoints.forEach((t, i) => this.testPointIndex.insert(i, circleBounds(t)));
    this.traces.forEach((t, i) => this.traceIndex.insert(i, traceBounds(t)));
    this.fileNetNames = board.nets.map((n) => n.name);
    this.fileNetKinds = board.nets.map((n) => n.kind);

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    this.sortedParts = board.parts.map((_, i) => i).sort((a, b) => collator.compare(board.parts[a].name, board.parts[b].name));
    this.indexNets();
  }

  private indexNets(): void {
    const nets = this.board.nets;
    this.netsByName = new Map();
    // File names stay findable (schematics, old exports); own names win.
    this.fileNetNames.forEach((n, i) => this.netsByName.set(n.toUpperCase(), i));
    nets.forEach((n, i) => this.netsByName.set(n.name.toUpperCase(), i));
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    this.sortedNets = nets
      .map((_, i) => i)
      .sort((a, b) => {
        const ua = nets[a].kind === "unconnected" ? 1 : 0;
        const ub = nets[b].kind === "unconnected" ? 1 : 0;
        return ua - ub || collator.compare(nets[a].name, nets[b].name);
      });
  }

  /** The net's name in the file, before any renaming. */
  fileNetName(net: number): string {
    return this.fileNetNames[net];
  }

  /**
   * Applies the user's own net names (file name -> own name). Nets missing
   * from `names` get their file name back. Returns true when a name changed.
   */
  /** Parts hidden from view: 1 the body only (pads stay), 2 body and pads. */
  private hiddenParts = new Uint8Array(0);

  /**
   * Hides parts by name (a shield over the pads, parts only on ground …);
   * the net list stays as it is. The parts in `bodies` (indices) lose their
   * body only, whatever the mode (see mechanicalParts). True when anything changed.
   */
  setHiddenParts(names: readonly string[], mode: "body" | "all", bodies: readonly number[] = []): boolean {
    const next = new Uint8Array(this.parts.length);
    for (const i of bodies) next[i] = 1;
    for (const name of names) {
      const i = this.findPart(name);
      if (i !== undefined) next[i] = mode === "all" ? 2 : 1;
    }
    const changed = next.length !== this.hiddenParts.length || next.some((v, i) => v !== this.hiddenParts[i]);
    this.hiddenParts = next;
    return changed;
  }

  /** Isolation view: only these nets and the parts on them are shown. */
  private isolation: { nets: Set<number>; parts: Set<number>; pinNets: Set<number> } | null = null;

  /**
   * Shows only the given nets with their pins, test points, tracks and parts
   * ("union"), or with the parts on all of them ("intersection": the parts
   * the nets have in common). `alsoPins` (ground, unconnected) shows those
   * nets' pins on the parts shown, nothing else of them. `null` ends the
   * isolation. Returns the parts shown.
   */
  setIsolation(
    nets: readonly number[] | null,
    mode: "union" | "intersection" = "union",
    alsoPins: (kind: NetKind) => boolean = () => false,
  ): number[] {
    if (!nets || nets.length === 0) {
      this.isolation = null;
      return [];
    }
    const netSet = new Set(nets);
    const count = new Map<number, Set<number>>();
    for (const net of netSet) {
      for (const pin of this.nets[net].pins) {
        const part = this.pins[pin].part;
        let on = count.get(part);
        if (!on) count.set(part, (on = new Set()));
        on.add(net);
      }
    }
    const parts = new Set([...count].filter(([, on]) => mode === "union" || on.size === netSet.size).map(([part]) => part));
    const pinNets = new Set<number>();
    for (const part of parts) {
      const { firstPin, pinCount } = this.parts[part];
      for (let pin = firstPin; pin < firstPin + pinCount; pin++) {
        const net = this.pins[pin].net;
        if (!netSet.has(net) && alsoPins(this.nets[net].kind)) pinNets.add(net);
      }
    }
    this.isolation = { nets: netSet, parts, pinNets };
    return [...parts];
  }

  /** Bounds of what the isolation shows. */
  isolationBounds(): Bounds | undefined {
    if (!this.isolation) return undefined;
    const pts: Point[] = [];
    for (const part of this.isolation.parts) {
      const b = this.parts[part].bounds;
      pts.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    }
    for (const net of this.isolation.nets) {
      for (const i of this.nets[net].testPoints) pts.push(this.testPoints[i]);
      for (const i of this.nets[net].traces ?? []) pts.push({ x: this.traces[i].x1, y: this.traces[i].y1 }, { x: this.traces[i].x2, y: this.traces[i].y2 });
    }
    return pts.length ? padBounds(boundsOf(pts), 80) : undefined;
  }

  get isolated(): boolean {
    return this.isolation !== null;
  }

  /** The part's body is hidden (not drawn, not clickable): hidden by hand, or outside the isolation. */
  partHidden(part: number): boolean {
    return (this.hiddenParts[part] ?? 0) > 0 || (this.isolation !== null && !this.isolation.parts.has(part));
  }

  /** The pin is hidden with its part, or is on a net outside the isolation. */
  pinHidden(pin: number): boolean {
    const p = this.pins[pin];
    if (this.hiddenParts[p.part] === 2) return true;
    const iso = this.isolation;
    return iso !== null && (!(iso.nets.has(p.net) || iso.pinNets.has(p.net)) || !iso.parts.has(p.part));
  }

  /** The net is outside the isolation (its tracks and test points are not shown). */
  netHidden(net: number): boolean {
    return this.isolation !== null && !this.isolation.nets.has(net);
  }

  get hiddenCount(): number {
    return this.hiddenParts.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
  }

  /** The kind the file gave a net (before own corrections). */
  fileNetKind(net: number): NetKind {
    return this.fileNetKinds[net];
  }

  /**
   * Own corrections of net kinds (by file net name): a net the file calls a
   * signal that is ground, or the other way round. True when anything changed.
   */
  applyNetKinds(kinds: Readonly<Record<string, NetKind>>): boolean {
    let changed = false;
    this.board.nets.forEach((n, i) => {
      const want = kinds[this.fileNetNames[i]] ?? this.fileNetKinds[i];
      if (n.kind !== want) {
        n.kind = want;
        changed = true;
      }
    });
    if (changed) this.indexNets();
    return changed;
  }

  applyNetNames(names: Readonly<Record<string, string>>): boolean {
    let changed = false;
    this.board.nets.forEach((n, i) => {
      const want = names[this.fileNetNames[i]] ?? this.fileNetNames[i];
      if (n.name !== want) {
        n.name = want;
        changed = true;
      }
    });
    if (changed) this.indexNets();
    return changed;
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

  get traces(): Trace[] {
    return this.board.traces ?? [];
  }

  get layers(): Layer[] {
    return this.board.layers ?? [];
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
   * True for two-terminal parts that connect their nets for tracing
   * purposes: coils (also with two pads per side), ferrites, fuses, net
   * ties, jumpers and 0 Ω resistors.
   */
  isSeriesPart(part: number): boolean {
    const p = this.parts[part];
    if (p.pinCount === 2) return passesThrough(p.name, p.device, 2);
    if (p.pinCount > 4) return false;
    const nets = new Set<number>();
    for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) nets.add(this.pins[i].net);
    return passesThrough(p.name, p.device, p.pinCount, nets.size);
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
  ratsnest(net: number, maxPins = 2500, view?: ViewSide): [number, number][] {
    const key = `${net}:${view ?? "all"}`;
    const cached = this.ratsnestCache.get(key);
    if (cached) return cached;
    // With a side given, only the pins seen from it are connected.
    const pins = view ? this.nets[net].pins.filter((p) => visibleFrom(this.pins[p].side, view)) : this.nets[net].pins;
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
    this.ratsnestCache.set(key, edges);
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
        const part = this.parts[sel.part];
        const b = part.bounds;
        // Markers have no size: show the neighbourhood a chip would cover.
        if (part.marker) return padBounds(b, markerSize(part) > 4 ? 450 : 150);
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
        for (const i of net.traces ?? []) {
          const t = this.traces[i];
          pts.push({ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 });
        }
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
  hitTest(
    p: Point,
    view: ViewSide,
    tolerance: number,
    showVias: boolean,
    showTraces = true,
    hiddenLayers: ReadonlySet<number> = new Set(),
  ): Hit | undefined {
    // On boards with routing, vias are part of the copper and always shown.
    showVias ||= this.traces.length > 0;
    const probe: Bounds = { minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance };

    let best: Hit | undefined;
    let bestDist = Infinity;
    this.pinIndex.query(probe, (i) => {
      const pin = this.pins[i];
      if (!visibleFrom(pin.side, view) || this.pinHidden(i)) return;
      const d = Math.hypot(pin.x - p.x, pin.y - p.y) - pin.radius;
      if (d <= tolerance && d < bestDist) {
        bestDist = d;
        best = { kind: "pin", pin: i };
      }
    });
    this.testPointIndex.query(probe, (i) => {
      const t = this.testPoints[i];
      if (t.via?.buried && (!showTraces || t.via.layers.every((name) => {
        const layer = this.layers.findIndex((l) => l.name === name);
        return layer >= 0 && hiddenLayers.has(layer);
      }))) return;
      if (!visibleFrom(t.side, view) || (t.kind === "via" && !showVias && !this.isolated) || this.netHidden(t.net)) return;
      const d = Math.hypot(t.x - p.x, t.y - p.y) - t.radius;
      if (d <= tolerance && d < bestDist) {
        bestDist = d;
        best = { kind: "testPoint", testPoint: i };
      }
    });
    if (best) return best;

    // Markers have a fixed size on screen; `tolerance` is 4 pixels.
    const px = tolerance / 4;
    this.partIndex.query(
      { minX: p.x - 12 * px, minY: p.y - 12 * px, maxX: p.x + 12 * px, maxY: p.y + 12 * px },
      (i) => {
        const part = this.parts[i];
        if (!part.marker || !visibleFrom(part.side, view) || this.partHidden(i)) return;
        const c = partCenter(part);
        const d = Math.hypot(c.x - p.x, c.y - p.y) - markerSize(part) * px;
        if (d <= tolerance && d < bestDist) {
          bestDist = d;
          best = { kind: "part", part: i };
        }
      },
    );
    if (best) return best;

    if (showTraces) {
      this.traceIndex.query(probe, (i) => {
        const t = this.traces[i];
        if (t.side !== view || hiddenLayers.has(t.layer) || this.netHidden(t.net)) return;
        const d = segmentDistance(p, t) - t.width / 2;
        if (d <= tolerance && d < bestDist) {
          bestDist = d;
          best = { kind: "trace", trace: i, net: t.net };
        }
      });
      if (best) return best;
    }

    let bestArea = Infinity;
    this.partIndex.query(probe, (i) => {
      const part = this.parts[i];
      if (!visibleFrom(part.side, view) || this.partHidden(i)) return;
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

export function traceBounds(t: Trace): Bounds {
  const r = t.width / 2;
  return {
    minX: Math.min(t.x1, t.x2) - r,
    minY: Math.min(t.y1, t.y2) - r,
    maxX: Math.max(t.x1, t.x2) + r,
    maxY: Math.max(t.y1, t.y2) + r,
  };
}

/** Distance from `p` to the center line of a trace. */
function segmentDistance(p: Point, t: Trace): number {
  const dx = t.x2 - t.x1;
  const dy = t.y2 - t.y1;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - t.x1) * dx + (p.y - t.y1) * dy) / len2)) : 0;
  return Math.hypot(p.x - (t.x1 + k * dx), p.y - (t.y1 + k * dy));
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
