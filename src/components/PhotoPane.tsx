import { useEffect, useMemo, useRef, useState } from "react";
import { visibleFrom, type BoardModel, type ViewSide } from "../core/board";
import type { Point, Selection } from "../core/types";
import { useI18n } from "../i18n";
import { applyAffine, invertAffine, partAtPoint, photoScale, type Affine } from "../workbench/photo";
import { CloseIcon } from "./Icons";

interface Props {
  image: HTMLCanvasElement;
  /** Photo units (pixels / image width) → board mils. */
  matrix: Affine;
  model: BoardModel;
  side: ViewSide;
  selection: Selection;
  onSelect(selection: Selection, zoom: boolean): void;
  onClose(): void;
}

/** Screen position and size of the photo: screen = photo pixel · scale + (x, y). */
interface View {
  scale: number;
  x: number;
  y: number;
}

const SELECTED = "#ffd54f";
const HOVER = "rgba(255, 255, 255, 0.9)";
/** Pixels a click may move before it counts as dragging. */
const CLICK_SLOP = 4;

/**
 * The aligned photo of the board on its own, as it is: clicking a part on it
 * selects that part on the board, and the selection on the board is marked
 * on the photo. No searching for a part you can see in front of you.
 */
export function PhotoPane({ image, matrix, model, side, selection, onSelect, onClose }: Props) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<{ part: number; at: Point } | null>(null);
  const drag = useRef<{ start: Point; view: View; moved: boolean } | null>(null);
  const inverse = useMemo(() => invertAffine(matrix), [matrix]);

  const fit = (): View | null => {
    if (!size.width || !size.height) return null;
    const scale = Math.min(size.width / image.width, size.height / image.height) * 0.96;
    return { scale, x: (size.width - image.width * scale) / 2, y: (size.height - image.height * scale) / 2 };
  };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => setSize({ width: frame.clientWidth, height: frame.clientHeight }));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Fit a new photo, and the first time the pane has a size.
  useEffect(() => {
    setView(fit());
  }, [image, size.width > 0 && size.height > 0]);

  const toScreen = (board: Point, v: View): Point | null => {
    if (!inverse) return null;
    const uv = applyAffine(inverse, board);
    return { x: uv.x * image.width * v.scale + v.x, y: uv.y * image.width * v.scale + v.y };
  };
  const toBoard = (screen: Point, v: View): Point => {
    const u = (screen.x - v.x) / v.scale / image.width;
    const w = (screen.y - v.y) / v.scale / image.width;
    return applyAffine(matrix, { x: u, y: w });
  };
  /** Board mils per screen pixel at the current zoom. */
  const milsPerPixel = (v: View) => photoScale(matrix) / (image.width * v.scale);

  const partShape = (part: number, v: View): Point[] => {
    const p = model.parts[part];
    const b = p.bounds;
    const corners =
      p.outline.length >= 3
        ? p.outline
        : [
            { x: b.minX, y: b.minY },
            { x: b.maxX, y: b.minY },
            { x: b.maxX, y: b.maxY },
            { x: b.minX, y: b.maxY },
          ];
    return corners.map((c) => toScreen(c, v)).filter((c): c is Point => c !== null);
  };

  // What the selection marks on the photo, in board space.
  const marks = useMemo(() => {
    const part = model.selectedPart(selection);
    const net = model.selectedNet(selection);
    const dots: { x: number; y: number; radius: number }[] = [];
    if (selection.kind === "net" && net !== undefined) {
      for (const i of model.nets[net].pins) {
        const pin = model.pins[i];
        if (visibleFrom(pin.side, side)) dots.push(pin);
      }
      for (const i of model.nets[net].testPoints) {
        const tp = model.testPoints[i];
        if (visibleFrom(tp.side, side)) dots.push(tp);
      }
    } else if (selection.kind === "pin") dots.push(model.pins[selection.pin]);
    else if (selection.kind === "testPoint") dots.push(model.testPoints[selection.testPoint]);
    return { part: part !== undefined && visibleFrom(model.parts[part].side, side) ? part : undefined, dots };
  }, [model, selection, side]);

  // Bring a selection made on the board into view when it is off the photo's visible part.
  useEffect(() => {
    if (!view || !size.width) return;
    const points =
      marks.part !== undefined ? partShape(marks.part, view) : marks.dots.slice(0, 1).map((d) => toScreen(d, view)).filter((p): p is Point => !!p);
    if (points.length === 0) return;
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const margin = 24;
    if (cx > margin && cx < size.width - margin && cy > margin && cy < size.height - margin) return;
    setView({ ...view, x: view.x + size.width / 2 - cx, y: view.y + size.height / 2 - cy });
    // Only a new selection moves the photo; panning by hand must not.
  }, [marks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, view.x, view.y, image.width * view.scale, image.height * view.scale);

    const outline = (part: number, color: string, width: number, fill?: string) => {
      const shape = partShape(part, view);
      if (shape.length < 2) return;
      ctx.beginPath();
      shape.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.lineWidth = width;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.stroke();
      ctx.lineWidth = Math.max(1, width - 1.5);
      ctx.strokeStyle = color;
      ctx.stroke();
      return shape;
    };
    const label = (text: string, at: Point) => {
      ctx.font = "600 12px -apple-system, system-ui, sans-serif";
      const w = ctx.measureText(text).width + 10;
      const x = Math.min(Math.max(at.x - w / 2, 2), size.width - w - 2);
      const y = Math.max(at.y - 26, 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(x, y, w, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x + 5, y + 14);
    };

    if (hover && hover.part !== marks.part) outline(hover.part, HOVER, 2.5);
    if (marks.part !== undefined) {
      const shape = outline(marks.part, SELECTED, 3.5, "rgba(255, 213, 79, 0.18)");
      if (shape) label(model.parts[marks.part].name, { x: shape.reduce((s, p) => s + p.x, 0) / shape.length, y: Math.min(...shape.map((p) => p.y)) });
    }
    const perMil = 1 / milsPerPixel(view);
    for (const d of marks.dots.slice(0, 5000)) {
      const p = toScreen(d, view);
      if (!p || p.x < -10 || p.y < -10 || p.x > size.width + 10 || p.y > size.height + 10) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(d.radius * perMil, 4), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 213, 79, 0.55)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = SELECTED;
      ctx.stroke();
    }
    if (hover && hover.part !== marks.part) label(model.parts[hover.part].name, hover.at);
  }, [view, size, image, matrix, marks, hover]);

  // Zoom around the pointer; a non-passive listener so the page does not scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      setView((v) => {
        if (!v) return v;
        const base = Math.min(size.width / image.width, size.height / image.height);
        const scale = Math.min(Math.max(v.scale * Math.exp(-e.deltaY * 0.0015), base * 0.5), base * 40);
        const k = scale / v.scale;
        return { scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [image, size]);

  const pointer = (e: React.PointerEvent): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** The part under a screen point, with some slack for the alignment. */
  const partAt = (at: Point, v: View): number | undefined => {
    const slack = Math.max(12 * milsPerPixel(v), 8);
    const { inside, near } = partAtPoint(model, toBoard(at, v), side, slack);
    return inside ?? near;
  };

  const pick = (at: Point, v: View) => {
    const board = toBoard(at, v);
    const slack = Math.max(12 * milsPerPixel(v), 8);
    const { inside, near } = partAtPoint(model, board, side, slack);
    if (inside !== undefined) return onSelect({ kind: "part", part: inside }, true);
    // Test points have no body of their own.
    const hit = model.hitTest(board, side, slack, true, false);
    if (hit?.kind === "testPoint") return onSelect({ kind: "testPoint", testPoint: hit.testPoint }, true);
    if (hit?.kind === "pin") return onSelect({ kind: "part", part: model.pins[hit.pin].part }, true);
    if (near !== undefined) onSelect({ kind: "part", part: near }, true);
  };

  return (
    <div className="photo-pane">
      <header className="compare-bar">
        <span className="compare-name">
          {t("photo.title")} · <strong>{t(side === "top" ? "side.top" : "side.bottom")}</strong>
        </span>
        <span className="muted photo-pane-hint">{t("photo.paneHint")}</span>
        <span className="schematic-spacer" />
        <button className="small" onClick={() => setView(fit())}>
          {t("photo.fit")}
        </button>
        <button className="tool icon-only" onClick={onClose} aria-label={t("photo.paneClose")} title={t("photo.paneClose")}>
          <CloseIcon />
        </button>
      </header>
      <div className="photo-pane-frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          style={{ width: size.width, height: size.height, cursor: hover ? "pointer" : "grab" }}
          onPointerDown={(e) => {
            if (!view || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { start: pointer(e), view, moved: false };
          }}
          onPointerMove={(e) => {
            const at = pointer(e);
            const d = drag.current;
            if (d) {
              const dx = at.x - d.start.x;
              const dy = at.y - d.start.y;
              if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
              d.moved = true;
              setHover(null);
              setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
              return;
            }
            if (!view) return;
            const part = partAt(at, view);
            setHover(part === undefined ? null : { part, at });
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved && view) pick(pointer(e), view);
          }}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={(e) => {
            if (!view) return;
            const r = e.currentTarget.getBoundingClientRect();
            const at = { x: e.clientX - r.left, y: e.clientY - r.top };
            const k = 2.5;
            setView({ scale: view.scale * k, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k });
          }}
        />
      </div>
    </div>
  );
}
