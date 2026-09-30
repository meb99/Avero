import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { BoardModel, Hit, ViewSide } from "../core/board";
import { Camera, lerpCamera } from "../core/camera";
import type { Bounds, Point, Selection } from "../core/types";
import { useI18n } from "../i18n";
import { drawLabels } from "../render/labels";
import type { Palette } from "../render/palette";
import { BoardRenderer } from "../render/renderer";
import { computeStyle } from "../render/style";
import type { Settings } from "../settings";
import { formatLength } from "../format";

export interface BoardViewHandle {
  fit(): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  zoomTo(bounds: Bounds): void;
}

interface Props {
  model: BoardModel;
  side: ViewSide;
  rotation: number;
  selection: Selection;
  settings: Settings;
  palette: Palette;
  onSelect(selection: Selection, zoom: boolean): void;
  ref?: Ref<BoardViewHandle>;
}

interface Hover {
  x: number;
  y: number;
  text: string;
}

const DRAG_THRESHOLD = 4;
const FLY_MS = 280;

function hitToSelection(hit: Hit | undefined): Selection {
  if (!hit) return { kind: "none" };
  switch (hit.kind) {
    case "pin":
      return { kind: "pin", pin: hit.pin };
    case "testPoint":
      return { kind: "testPoint", testPoint: hit.testPoint };
    case "part":
      return { kind: "part", part: hit.part };
  }
}

export function BoardView({ model, side, rotation, selection, settings, palette, onSelect, ref }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const cameraRef = useRef(new Camera());
  const frameRef = useRef(0);
  const animRef = useRef(0);
  const dprRef = useRef(1);
  // A new board is fitted once the view has a real size.
  const needsFitRef = useRef(true);
  const stateRef = useRef({ model, side, selection, settings, palette, highlightedNet: undefined as number | undefined });
  const [hover, setHover] = useState<Hover | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [glError, setGlError] = useState(false);
  const [rendererVersion, setRendererVersion] = useState(0);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const renderer = rendererRef.current;
    const labels = labelRef.current?.getContext("2d");
    if (!renderer || !labels) return;
    const s = stateRef.current;
    renderer.draw(cameraRef.current, s.palette, dprRef.current);
    drawLabels(
      labels,
      s.model,
      cameraRef.current,
      s.side,
      s.selection,
      s.highlightedNet,
      { partNames: s.settings.partNames, pinNumbers: s.settings.pinNumbers, netNames: s.settings.netNames },
      s.palette,
      dprRef.current,
    );
  }, []);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fitIfNeeded = useCallback(() => {
    const cam = cameraRef.current;
    if (needsFitRef.current && cam.width > 10 && cam.height > 10) {
      cam.fit(stateRef.current.model.board.bounds);
      needsFitRef.current = false;
    }
  }, []);

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
        draw();
        if (k < 1) animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    },
    [draw],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit() {
        const target = cameraRef.current.clone();
        target.fit(stateRef.current.model.board.bounds);
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
      zoomTo(bounds: Bounds) {
        const target = cameraRef.current.clone();
        target.fit(bounds, 80, 6);
        // Never zoom out to show a selection that is already comfortably visible.
        if (target.scale < cameraRef.current.scale) target.scale = Math.max(target.scale, cameraRef.current.scale * 0.5);
        flyTo(target);
      },
    }),
    [flyTo, requestDraw],
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
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setBoard(model, stateRef.current.palette);
    needsFitRef.current = true;
    fitIfNeeded();
    requestDraw();
  }, [model, requestDraw, fitIfNeeded, rendererVersion]);

  // Orientation.
  useEffect(() => {
    const cam = cameraRef.current;
    cam.mirrored = side === "bottom";
    cam.rotation = rotation & 3;
    requestDraw();
  }, [side, rotation, requestDraw]);

  // Colors follow selection, side, options and theme.
  useEffect(() => {
    const style = computeStyle(
      model,
      side,
      selection,
      { ghostOtherSide: settings.ghostOtherSide, showVias: settings.showVias, dimUnselected: settings.dimUnselected },
      palette,
    );
    Object.assign(stateRef.current, { model, side, selection, settings, palette, highlightedNet: style.highlightedNet });
    rendererRef.current?.setStyle(style, palette);
    requestDraw();
  }, [model, side, selection, settings, palette, requestDraw, rendererVersion]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // Pointer handling: click selects, drag pans, two fingers pinch.
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ start: Point; last: Point; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; mid: Point } | null>(null);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitAt = (p: Point): Hit | undefined => {
    const cam = cameraRef.current;
    const s = stateRef.current;
    return s.model.hitTest(cam.toWorld(p), s.side, 4 / cam.scale, s.settings.showVias);
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
        const probe = tp.probe !== undefined ? ` ${tp.probe}` : "";
        return `${tp.kind === "via" ? t("details.via") : t("details.testPoint")}${probe}  ·  ${m.nets[tp.net].name}`;
      }
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

    setCursor(cam.toWorld(p));
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
    if (d && !d.moved && e.button === 0) onSelect(hitToSelection(hitAt(local(e))), false);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
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

  if (glError) return <div className="board-error">{t("error.webgl")}</div>;

  return (
    <div
      ref={containerRef}
      className="board-view"
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
    </div>
  );
}
