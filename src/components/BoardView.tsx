import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { BoardModel, Hit, ViewSide } from "../core/board";
import { Camera, lerpCamera } from "../core/camera";
import { bottomCamera, boundsToLayout, dualLayout, fromLayout, sideAt, toLayout, type DualLayout } from "../core/dualView";
import type { Bounds, Point, Selection } from "../core/types";
import { useI18n } from "../i18n";
import { drawDrawings, drawLabels, drawMarkers, markerAt, type DrawingMark, type MarkerMark, type PadValues } from "../render/labels";
import type { Palette, RGBA } from "../render/palette";
import { BoardRenderer, type RenderView } from "../render/renderer";
import { computeStyle } from "../render/style";
import type { Settings } from "../settings";
import { formatLength } from "../format";
import type { NetStatus } from "../workbench/notes";
import { photoCorners, type Affine, type Homography } from "../workbench/photo";

/** A decoded photo with its alignment (photo units: pixels / image width). */
export interface PhotoLayer {
  image: HTMLCanvasElement;
  matrix: Affine;
  perspective?: Homography;
  opacity: number;
}

/** Where the view looks, to bring a tab back as it was left. */
export interface ViewState {
  centerX: number;
  centerY: number;
  scale: number;
}

export interface BoardViewHandle {
  fit(): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  /** `side`: the side the bounds are on, when both sides are shown ("both": a net with pins on both). */
  zoomTo(bounds: Bounds, side?: ViewSide | "both"): void;
  /** The current view with labels as a PNG. */
  snapshot(): Promise<Blob>;
  /** Screen position (relative to the view) of a board point. */
  toScreen(p: Point, side?: ViewSide): Point;
  viewState(): ViewState;
  /** Moves the view without reporting it back through `onViewChange` (for syncing two views). */
  setViewState(view: ViewState): void;
}

interface Props {
  model: BoardModel;
  side: ViewSide;
  /** Both sides at once: top as it is, bottom mirrored beside it. */
  dual?: boolean;
  rotation: number;
  selection: Selection;
  settings: Settings;
  palette: Palette;
  /** Trace layers switched off. */
  hiddenLayers?: ReadonlySet<number>;
  /** Changes when net names change, so labels redraw. */
  namesRevision?: number;
  /** Nets pinned in their own colors. */
  pinnedNets?: ReadonlyMap<number, RGBA>;
  /** Notes pinned to spots on the board. */
  markers?: readonly MarkerMark[];
  activeMarker?: string | null;
  onMarkerClick?(id: string): void;
  /** Drawn above the board, positioned by the caller (marker editor). */
  children?: ReactNode;
  /** Measurement state by net index, drawn as dots on pins. */
  measured?: ReadonlyMap<number, NetStatus>;
  /** View to show a newly set board with, instead of fitting it. */
  initialView?: ViewState;
  /** Photo of the real board for the visible side. */
  photo?: PhotoLayer;
  /** Values to print under part names (from the schematic), by part index. */
  partValues?: ReadonlyMap<number, string>;
  /** Measured values written at pads (see labels.ts). */
  padValues?: PadValues;
  /** Lines, areas and jumpers drawn on the board. */
  drawings?: readonly DrawingMark[];
  /** The drawing being made; its next point follows the cursor. */
  draft?: DrawingMark | null;
  /** Reports pans and zooms, for a second view that follows this one. */
  onViewChange?(view: ViewState): void;
  /**
   * While set, clicks pick board points instead of selecting; the point
   * snaps to the pin or test point under the cursor.
   */
  onPointPick?: (point: Point, side: ViewSide) => void;
  onSelect(selection: Selection, zoom: boolean): void;
  /** ⌘- or Shift-click: adds the part (or the part of the pin) to a multiple selection. */
  onAddPart?(part: number): void;
  /** Parts selected together with the selection (multiple selection). */
  extraParts?: ReadonlySet<number>;
  ref?: Ref<BoardViewHandle>;
}

/** One side as drawn: its camera, style slot and side. */
interface SideView extends RenderView {
  side: ViewSide;
}

interface Hover {
  x: number;
  y: number;
  text: string;
}

const NO_LAYERS: ReadonlySet<number> = new Set();
const NO_PINS: ReadonlyMap<number, RGBA> = new Map();
const NO_MARKERS: readonly MarkerMark[] = [];
const NO_DRAWINGS: readonly DrawingMark[] = [];
const DRAG_THRESHOLD = 4;
const FLY_MS = 280;

function hitToSelection(hit: Hit | undefined): Selection {
  if (!hit) return { kind: "none" };
  switch (hit.kind) {
    case "pin":
      return { kind: "pin", pin: hit.pin };
    case "testPoint":
      return { kind: "testPoint", testPoint: hit.testPoint };
    case "trace":
      return { kind: "net", net: hit.net };
    case "part":
      return { kind: "part", part: hit.part };
  }
}

export function BoardView({
  model,
  side,
  dual = false,
  rotation,
  selection,
  settings,
  palette,
  hiddenLayers = NO_LAYERS,
  namesRevision = 0,
  pinnedNets = NO_PINS,
  markers = NO_MARKERS,
  activeMarker = null,
  onMarkerClick,
  children,
  measured,
  initialView,
  photo,
  partValues,
  padValues,
  drawings = NO_DRAWINGS,
  draft = null,
  onViewChange,
  onPointPick,
  onSelect,
  onAddPart,
  extraParts,
  ref,
}: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  /** The overview's static picture, redrawn when the board, sides or colors change. */
  const overviewCache = useRef<{ key: string; image: HTMLCanvasElement } | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const cameraRef = useRef(new Camera());
  const frameRef = useRef(0);
  const animRef = useRef(0);
  const dprRef = useRef(1);
  // A new board is fitted once the view has a real size.
  const needsFitRef = useRef(true);
  const stateRef = useRef({
    model,
    side,
    dual,
    layout: dualLayout(model.board.bounds) as DualLayout,
    selection,
    settings,
    palette,
    hiddenLayers,
    measured,
    markers,
    activeMarker,
    partValues,
    padValues,
    drawings,
    draft,
    /** Board point under the cursor, for the draft's last segment. */
    cursorWorld: null as Point | null,
    highlightedNet: undefined as number | undefined,
  });
  const [hover, setHover] = useState<Hover | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [glError, setGlError] = useState(false);
  const [rendererVersion, setRendererVersion] = useState(0);
  const initialViewRef = useRef(initialView);
  initialViewRef.current = initialView;

  /** The sides on screen, each with its own camera. */
  const sideViews = useCallback((): SideView[] => {
    const s = stateRef.current;
    const cam = cameraRef.current;
    if (!s.dual) return [{ camera: cam, slot: 0, side: s.side }];
    return [
      { camera: cam, slot: 0, side: "top" },
      { camera: bottomCamera(cam, s.layout), slot: 1, side: "bottom" },
    ];
  }, []);

  /** Bounds of everything on screen: one side, or both together. */
  const allBounds = useCallback((): Bounds => {
    const s = stateRef.current;
    return s.dual ? s.layout.bounds : s.model.board.bounds;
  }, []);

  /** Camera of the overview map: everything on screen, fitted into the little map. */
  const overviewCamera = useCallback((): Camera | null => {
    const main = cameraRef.current;
    const bounds = allBounds();
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    if (w <= 0 || h <= 0) return null;
    const sideways = (main.rotation & 1) === 1;
    const aspect = sideways ? h / w : w / h;
    const max = Math.min(220, main.width * 0.28);
    const cam = new Camera();
    cam.width = Math.round(aspect >= 1 ? max : max * aspect);
    cam.height = Math.round(aspect >= 1 ? max / aspect : max);
    cam.rotation = main.rotation;
    cam.mirrored = main.mirrored;
    cam.fit(bounds, 4);
    return cam;
  }, [allBounds]);

  /** The overview map while zoomed in: the board, and the part of it on screen. */
  const drawOverview = useCallback(() => {
    const canvas = overviewRef.current;
    const s = stateRef.current;
    const main = cameraRef.current;
    if (!canvas) return;
    const mini = s.settings.overview ? overviewCamera() : null;
    const view = main.visibleBounds();
    const all = allBounds();
    const zoomedIn = view.minX > all.minX || view.maxX < all.maxX || view.minY > all.minY || view.maxY < all.maxY;
    if (!mini || !zoomedIn || main.width < 360) {
      canvas.style.display = "none";
      return;
    }
    const dpr = dprRef.current;
    canvas.style.display = "block";
    canvas.style.width = `${mini.width}px`;
    canvas.style.height = `${mini.height}px`;
    const pw = Math.round(mini.width * dpr);
    const ph = Math.round(mini.height * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const key = [s.model.board.bounds.maxX, s.model.parts.length, s.side, s.dual, mini.rotation, mini.width, mini.height, dpr, s.palette.background.join()].join("|");
    let cached = overviewCache.current;
    if (!cached || cached.key !== key || cached.image.width !== canvas.width) {
      const image = document.createElement("canvas");
      image.width = canvas.width;
      image.height = canvas.height;
      const g = image.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rgba = (c: readonly number[], a = c[3] / 255) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
      g.fillStyle = rgba(s.palette.background, 0.92);
      g.fillRect(0, 0, mini.width, mini.height);
      const views: [Camera, ViewSide][] = s.dual
        ? [
            [mini, "top"],
            [bottomCamera(mini, s.layout), "bottom"],
          ]
        : [[mini, s.side]];
      for (const [cam, side] of views) {
        g.fillStyle = rgba(s.palette.boardFill);
        g.strokeStyle = rgba(s.palette.boardEdge);
        g.lineWidth = 1;
        for (const path of s.model.board.outline) {
          g.beginPath();
          path.forEach((p, i) => {
            const q = cam.toScreen(p);
            if (i) g.lineTo(q.x, q.y);
            else g.moveTo(q.x, q.y);
          });
          g.fill();
          g.stroke();
        }
        g.fillStyle = rgba(s.palette.partOutline, 0.8);
        for (const part of s.model.parts) {
          if (part.side !== side && part.side !== "both") continue;
          const a = cam.toScreen({ x: part.bounds.minX, y: part.bounds.minY });
          const b = cam.toScreen({ x: part.bounds.maxX, y: part.bounds.maxY });
          g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(Math.abs(b.x - a.x), 0.7), Math.max(Math.abs(b.y - a.y), 0.7));
        }
      }
      cached = overviewCache.current = { key, image };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cached.image, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The part of the board on screen.
    const corners = [
      { x: 0, y: 0 },
      { x: main.width, y: 0 },
      { x: main.width, y: main.height },
      { x: 0, y: main.height },
    ].map((p) => mini.toScreen(main.toWorld(p)));
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(79, 195, 247, 0.18)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#4fc3f7";
    ctx.stroke();
  }, [allBounds, overviewCamera]);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const renderer = rendererRef.current;
    const labels = labelRef.current?.getContext("2d");
    if (!renderer || !labels) return;
    const s = stateRef.current;
    const views = sideViews();
    renderer.draw(views, cameraRef.current, s.palette, dprRef.current);
    views.forEach((v, i) =>
      drawLabels(
        labels,
        s.model,
        v.camera,
        v.side,
        s.selection,
        s.highlightedNet,
        { partNames: s.settings.partNames, pinNumbers: s.settings.pinNumbers, netNames: s.settings.netNames },
        s.palette,
        dprRef.current,
        s.measured,
        i === 0,
        s.partValues,
        s.padValues,
      ),
    );
    for (const v of views) {
      const draftShown = s.draft && s.cursorWorld && s.draft.side === v.side ? { ...s.draft, points: [...s.draft.points, s.cursorWorld] } : s.draft;
      drawDrawings(labels, v.camera, s.drawings, v.side, dprRef.current, draftShown);
      drawMarkers(labels, v.camera, s.markers, v.side, s.palette, dprRef.current, s.activeMarker, !s.dual && s.settings.ghostOtherSide);
    }
    drawOverview();
  }, [sideViews, drawOverview]);

  // The last view reported or set from outside, so a synced pair does not echo.
  const lastView = useRef<string>("");
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const drawAndReport = useCallback(() => {
    draw();
    const report = onViewChangeRef.current;
    if (!report) return;
    const { centerX, centerY, scale } = cameraRef.current;
    const key = `${centerX.toFixed(3)}|${centerY.toFixed(3)}|${scale.toPrecision(6)}`;
    if (key === lastView.current) return;
    lastView.current = key;
    report({ centerX, centerY, scale });
  }, [draw]);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(drawAndReport);
  }, [drawAndReport]);

  const fitIfNeeded = useCallback(() => {
    const cam = cameraRef.current;
    if (needsFitRef.current && cam.width > 10 && cam.height > 10) {
      cam.fit(allBounds());
      needsFitRef.current = false;
    }
  }, [allBounds]);

  const flyTo = useCallback(
    (target: Camera) => {
      cancelAnimationFrame(animRef.current);
      const from = cameraRef.current.clone();
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / FLY_MS);
        const next = lerpCamera(from, target, k);
        Object.assign(cameraRef.current, {
          centerX: next.centerX,
          centerY: next.centerY,
          scale: next.scale,
        });
        drawAndReport();
        if (k < 1) animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    },
    [drawAndReport],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit() {
        const target = cameraRef.current.clone();
        target.fit(allBounds());
        flyTo(target);
      },
      zoomBy(factor: number) {
        const c = cameraRef.current;
        c.zoomAt({ x: c.width / 2, y: c.height / 2 }, factor);
        requestDraw();
      },
      panBy(dx: number, dy: number) {
        cameraRef.current.pan(dx, dy);
        requestDraw();
      },
      zoomTo(bounds: Bounds, side?: ViewSide | "both") {
        const s = stateRef.current;
        const target = cameraRef.current.clone();
        const onLayout = (v: ViewSide) => boundsToLayout(bounds, v, s.layout);
        const both = (a: Bounds, b: Bounds): Bounds => ({
          minX: Math.min(a.minX, b.minX),
          minY: Math.min(a.minY, b.minY),
          maxX: Math.max(a.maxX, b.maxX),
          maxY: Math.max(a.maxY, b.maxY),
        });
        const shown = !s.dual ? bounds : side === "both" ? both(onLayout("top"), onLayout("bottom")) : onLayout(side ?? s.side);
        target.fit(shown, 80, 6);
        // Never zoom out to show a selection that is already comfortably visible.
        if (target.scale < cameraRef.current.scale) target.scale = Math.max(target.scale, cameraRef.current.scale * 0.5);
        flyTo(target);
      },
      async snapshot() {
        draw();
        const gl = glRef.current!;
        const out = document.createElement("canvas");
        out.width = gl.width;
        out.height = gl.height;
        const ctx = out.getContext("2d")!;
        ctx.drawImage(gl, 0, 0);
        if (labelRef.current) ctx.drawImage(labelRef.current, 0, 0);
        return new Promise<Blob>((resolve, reject) =>
          out.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
        );
      },
      toScreen(p: Point, side?: ViewSide) {
        const s = stateRef.current;
        return cameraRef.current.toScreen(s.dual ? toLayout(p, side ?? s.side, s.layout) : p);
      },
      viewState() {
        const { centerX, centerY, scale } = cameraRef.current;
        return { centerX, centerY, scale };
      },
      setViewState(view: ViewState) {
        cancelAnimationFrame(animRef.current);
        Object.assign(cameraRef.current, view);
        lastView.current = `${view.centerX.toFixed(3)}|${view.centerY.toFixed(3)}|${view.scale.toPrecision(6)}`;
        requestDraw();
      },
    }),
    [draw, flyTo, requestDraw, allBounds],
  );

  // Renderer lifetime.
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new BoardRenderer(canvas);
    } catch {
      setGlError(true);
      return;
    }
    const cam = cameraRef.current;
    rendererRef.current.resize(cam.width, cam.height, dprRef.current);
    setRendererVersion((v) => v + 1);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Size tracking.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const cam = cameraRef.current;
      cam.width = rect.width;
      cam.height = rect.height;
      rendererRef.current?.resize(rect.width, rect.height, dpr);
      const labels = labelRef.current;
      if (labels) {
        labels.width = Math.round(rect.width * dpr);
        labels.height = Math.round(rect.height * dpr);
      }
      fitIfNeeded();
      draw();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [draw, fitIfNeeded]);

  // New board: upload geometry and fit.
  useEffect(() => {
    stateRef.current.model = model;
    stateRef.current.layout = dualLayout(model.board.bounds);
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setBoard(model, stateRef.current.palette);
    const view = initialViewRef.current;
    if (view) Object.assign(cameraRef.current, view);
    needsFitRef.current = !view;
    fitIfNeeded();
    requestDraw();
  }, [model, requestDraw, fitIfNeeded, rendererVersion]);

  // Orientation. Both sides: the layout camera is never mirrored, the bottom side's own camera is.
  useEffect(() => {
    const cam = cameraRef.current;
    cam.mirrored = !dual && side === "bottom";
    cam.rotation = rotation & 3;
    requestDraw();
  }, [side, dual, rotation, requestDraw]);

  // Switching between one and both sides shows everything.
  const firstDual = useRef(true);
  useEffect(() => {
    stateRef.current.dual = dual;
    if (firstDual.current) {
      firstDual.current = false;
      return;
    }
    const target = cameraRef.current.clone();
    target.fit(allBounds());
    cameraRef.current.centerX = target.centerX;
    cameraRef.current.centerY = target.centerY;
    cameraRef.current.scale = target.scale;
    requestDraw();
  }, [dual, allBounds, requestDraw]);

  // Colors follow selection, side, options and theme; with both sides, one style slot each.
  useEffect(() => {
    const styleFor = (view: ViewSide) =>
      computeStyle(
        model,
        view,
        selection,
        {
          // The other side has its own place on screen.
          ghostOtherSide: !dual && settings.ghostOtherSide,
          showVias: settings.showVias,
          showTraces: settings.showTraces,
          hiddenLayers,
          pinnedNets,
          dimUnselected: settings.dimUnselected,
          extraParts,
        },
        palette,
      );
    const style = styleFor(dual ? "top" : side);
    Object.assign(stateRef.current, { model, side, dual, selection, settings, palette, hiddenLayers, highlightedNet: style.highlightedNet });
    // pinnedNets: colors of pins and tracks.
    rendererRef.current?.setStyle(style, palette, 0);
    if (dual) rendererRef.current?.setStyle(styleFor("bottom"), palette, 1);
    requestDraw();
    // namesRevision: net names live in the model and are drawn as labels.
  }, [model, side, dual, selection, settings, palette, hiddenLayers, pinnedNets, namesRevision, requestDraw, rendererVersion, extraParts]);

  useEffect(() => {
    Object.assign(stateRef.current, { markers, activeMarker });
    requestDraw();
  }, [markers, activeMarker, requestDraw]);

  // Photo of the real board: new image or alignment re-uploads, opacity only redraws.
  const photoImage = photo?.image;
  const photoMatrix = photo?.matrix;
  const photoPerspective = photo?.perspective;
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (photoImage && photoMatrix) {
      renderer.setPhoto(photoImage, photoCorners({ matrix: photoMatrix, perspective: photoPerspective }, 1, photoImage.height / photoImage.width));
    } else {
      renderer.setPhoto(null);
    }
    requestDraw();
    // The model dependency re-uploads after setBoard released the photo.
  }, [model, photoImage, photoMatrix, photoPerspective, requestDraw, rendererVersion]);

  const photoOpacity = photo?.opacity ?? 1;
  useEffect(() => {
    rendererRef.current?.setPhotoOpacity(photoOpacity);
    requestDraw();
  }, [photoOpacity, photoImage, requestDraw]);

  // Connection lines of the highlighted net.
  const ratsnestNet = settings.ratsnest ? model.selectedNet(selection) : undefined;
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    // Sides kept apart: only the lines between pins of the side in view.
    // Both sides shown: lines run between them, each pin where its side is drawn.
    const view = dual || settings.ghostOtherSide ? undefined : side;
    const edges =
      ratsnestNet === undefined || model.nets[ratsnestNet].kind === "ground" ? [] : model.ratsnest(ratsnestNet, 2500, view);
    const layout = dualLayout(model.board.bounds);
    const at = (pin: number) => {
      const p = model.pins[pin];
      return dual ? toLayout(p, p.side === "bottom" ? "bottom" : "top", layout) : p;
    };
    const segs = new Float32Array(edges.length * 4);
    edges.forEach(([a, b], i) => {
      const p = at(a);
      const q = at(b);
      segs.set([p.x, p.y, q.x, q.y], i * 4);
    });
    renderer.setOverlay(segs, palette.ratsnest, 1.4);
    requestDraw();
  }, [model, ratsnestNet, palette, requestDraw, rendererVersion, side, dual, settings.ghostOtherSide]);

  useEffect(() => {
    stateRef.current.measured = measured;
    requestDraw();
  }, [measured, requestDraw]);

  useEffect(() => {
    stateRef.current.partValues = partValues;
    requestDraw();
  }, [partValues, requestDraw]);

  useEffect(() => {
    stateRef.current.padValues = padValues;
    requestDraw();
  }, [padValues, requestDraw]);

  useEffect(() => {
    Object.assign(stateRef.current, { drawings, draft });
    requestDraw();
  }, [drawings, draft, requestDraw]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // Pointer handling: click selects, drag pans, two fingers pinch.
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ start: Point; last: Point; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; mid: Point } | null>(null);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** The side, its camera and the board point under a screen point. */
  const placeAt = (p: Point): { side: ViewSide; camera: Camera; world: Point } => {
    const cam = cameraRef.current;
    const s = stateRef.current;
    if (!s.dual) return { side: s.side, camera: cam, world: cam.toWorld(p) };
    const q = cam.toWorld(p);
    const side = sideAt(q, s.layout);
    return { side, camera: side === "top" ? cam : bottomCamera(cam, s.layout), world: fromLayout(q, side, s.layout) };
  };

  const hitAt = (p: Point): Hit | undefined => {
    const cam = cameraRef.current;
    const s = stateRef.current;
    const at = placeAt(p);
    return s.model.hitTest(at.world, at.side, 4 / cam.scale, s.settings.showVias, s.settings.showTraces, s.hiddenLayers);
  };

  const describe = (hit: Hit | undefined): string | null => {
    const m = stateRef.current.model;
    if (!hit) return null;
    switch (hit.kind) {
      case "pin": {
        const pin = m.pins[hit.pin];
        return `${m.pinLabel(hit.pin)}  ·  ${m.nets[pin.net].name}`;
      }
      case "testPoint": {
        const tp = m.testPoints[hit.testPoint];
        const probe = tp.name ? ` ${tp.name}` : tp.probe !== undefined ? ` ${tp.probe}` : "";
        return `${tp.kind === "via" ? t("details.via") : t("details.testPoint")}${probe}  ·  ${m.nets[tp.net].name}`;
      }
      case "trace":
        return `${t("details.trace")}  ·  ${m.nets[hit.net].name}`;
      case "part": {
        const part = m.parts[hit.part];
        return part.device ? `${part.name}  ·  ${part.device}` : part.name;
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    cancelAnimationFrame(animRef.current);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { start: p, last: p, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const cam = cameraRef.current;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cam.pan(mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y);
      if (pinch.current.distance > 0) cam.zoomAt(mid, distance / pinch.current.distance);
      pinch.current = { distance, mid };
      requestDraw();
      return;
    }

    const d = drag.current;
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_THRESHOLD) d.moved = true;
      if (d.moved) {
        cam.pan(p.x - d.last.x, p.y - d.last.y);
        d.last = p;
        setHover(null);
        requestDraw();
        return;
      }
    }

    const world = placeAt(p).world;
    setCursor(world);
    if (stateRef.current.draft) {
      stateRef.current.cursorWorld = world;
      requestDraw();
    }
    if (e.pointerType === "mouse") {
      const text = describe(hitAt(p));
      setHover(text ? { x: p.x, y: p.y, text } : null);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && e.button === 0) {
      const p = local(e);
      if (onPointPick) {
        const m = stateRef.current.model;
        const hit = hitAt(p);
        const snapped =
          hit?.kind === "pin" ? m.pins[hit.pin] : hit?.kind === "testPoint" ? m.testPoints[hit.testPoint] : undefined;
        const at = placeAt(p);
        onPointPick(snapped ? { x: snapped.x, y: snapped.y } : at.world, at.side);
        return;
      }
      const s = stateRef.current;
      const at = placeAt(p);
      const shown = !s.dual && s.settings.ghostOtherSide ? s.markers : s.markers.filter((m) => m.side === at.side);
      const marker = onMarkerClick && markerAt(at.camera, shown, p.x, p.y);
      if (marker) {
        onMarkerClick!(marker.id);
        return;
      }
      const hit = hitAt(p);
      if ((e.metaKey || e.shiftKey || e.ctrlKey) && onAddPart && hit) {
        const part = hit.kind === "part" ? hit.part : hit.kind === "pin" ? stateRef.current.model.pins[hit.pin].part : undefined;
        if (part !== undefined) {
          onAddPart(part);
          return;
        }
      }
      onSelect(hitToSelection(hit), false);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (onPointPick) return;
    const sel = hitToSelection(hitAt(local(e)));
    if (sel.kind !== "none") onSelect(sel, true);
  };

  const onWheel = (e: React.WheelEvent) => {
    cancelAnimationFrame(animRef.current);
    const cam = cameraRef.current;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || stateRef.current.settings.scroll === "zoom") {
      // ctrlKey is set for pinch gestures that arrive as wheel events.
      cam.zoomAt(local(e), Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018)));
    } else {
      cam.pan(-e.deltaX * unit, -e.deltaY * unit);
    }
    requestDraw();
  };

  // React registers wheel listeners as passive, so page zoom is blocked
  // separately. WebKit reports trackpad pinches as gesture events.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastScale = 1;
    const block = (e: Event) => e.preventDefault();
    const gestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      cancelAnimationFrame(animRef.current);
      cameraRef.current.zoomAt(local(g), g.scale / lastScale);
      lastScale = g.scale;
      requestDraw();
    };
    el.addEventListener("wheel", block, { passive: false });
    el.addEventListener("gesturestart", gestureStart);
    el.addEventListener("gesturechange", gestureChange);
    el.addEventListener("gestureend", block);
    return () => {
      el.removeEventListener("wheel", block);
      el.removeEventListener("gesturestart", gestureStart);
      el.removeEventListener("gesturechange", gestureChange);
      el.removeEventListener("gestureend", block);
    };
  }, [requestDraw]);

  /** Moves the view to the spot clicked on the overview map. */
  const jumpOverview = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mini = overviewCamera();
    if (!mini) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = mini.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    cancelAnimationFrame(animRef.current);
    cameraRef.current.centerX = p.x;
    cameraRef.current.centerY = p.y;
    requestDraw();
  };

  if (glError) return <div className="board-error">{t("error.webgl")}</div>;

  return (
    <div
      ref={containerRef}
      className={`board-view${onPointPick ? " picking" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setHover(null);
        setCursor(null);
      }}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={glRef} className="board-canvas" />
      <canvas ref={labelRef} className="board-labels" />
      <canvas
        ref={overviewRef}
        className="board-overview"
        title={t("overview.hint")}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          jumpOverview(e);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          if (e.currentTarget.hasPointerCapture(e.pointerId)) jumpOverview(e);
        }}
        onPointerUp={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      />
      {hover && (
        <div className="board-tooltip" style={{ left: hover.x + 14, top: hover.y + 16 }}>
          {hover.text}
        </div>
      )}
      {cursor && (
        <div className="board-cursor">
          {formatLength(cursor.x, settings.units)} · {formatLength(cursor.y, settings.units)}
        </div>
      )}
      {/* Bars and buttons over the board: their clicks are not board clicks. */}
      <div className="board-overlays" onPointerDown={stop} onPointerUp={stop} onDoubleClick={stop} onWheel={stop}>
        {children}
      </div>
    </div>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
