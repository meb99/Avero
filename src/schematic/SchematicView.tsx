import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  FitIcon,
  PopOutIcon,
  SchematicIcon,
  SearchIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "../components/Icons";
import { useI18n } from "../i18n";
import type { OutlineEntry, PageSize, SchematicDocument } from "./document";
import { PageCamera } from "./pageCamera";
import type { Box, Word } from "./textIndex";

/** What the schematic should show; a new nonce re-applies the same text. */
export interface SchematicFocus {
  text: string;
  /** Move the view to the first occurrence (false when the click came from here). */
  jump: boolean;
  nonce: number;
  /** Search for words containing the text (typed into the search field). */
  partial?: boolean;
  /** Occurrence to show, in reading order (from the occurrence list). */
  hit?: number;
}

export interface SchematicViewHandle {
  nextPage(): void;
  prevPage(): void;
  nextHit(): void;
  prevHit(): void;
  /** Puts the keyboard into the schematic's own text search. */
  focusSearch(): void;
}

export type WordTarget = "part" | "net" | null;

interface Props {
  doc: SchematicDocument;
  focus: SchematicFocus | null;
  scroll: "pan" | "zoom";
  classify(word: Word): WordTarget;
  onPick(word: Word): void;
  onClose(): void;
  /** Moves the schematic into its own window; no button without it. */
  onPopOut?: () => void;
  ref?: Ref<SchematicViewHandle>;
}

interface Layer {
  page: number;
  canvas: HTMLCanvasElement;
  /** Page area the bitmap covers. */
  box: Box;
}

const BASE_MAX_PX = 2600;
const DETAIL_DELAY_MS = 140;
const DRAG_THRESHOLD = 4;
/** Target on-screen height of a word we jump to. */
const JUMP_TEXT_PX = 14;

function flattenOutline(entries: OutlineEntry[], depth = 0): { title: string; page: number; depth: number }[] {
  return entries.flatMap((e) => [
    ...(e.page === null ? [] : [{ title: e.title, page: e.page, depth }]),
    ...flattenOutline(e.children, depth + 1),
  ]);
}

function isCancel(e: unknown): boolean {
  return !!e && typeof e === "object" && "name" in e && (e as { name: string }).name === "RenderingCancelledException";
}

export function SchematicView({ doc, focus, scroll, classify, onPick, onClose, onPopOut, ref }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef(new PageCamera()).current;
  const pageRef = useRef(0);
  const sizeRef = useRef<PageSize>({ width: 842, height: 595 });
  const baseRef = useRef<Layer | null>(null);
  const detailRef = useRef<Layer | null>(null);
  const tasks = useRef<{ base?: RenderTask; detail?: RenderTask }>({});
  const detailTimer = useRef(0);
  const frame = useRef(0);
  const dprRef = useRef(1);
  const hoverRef = useRef<Word | null>(null);
  // Last explicit framing, re-applied once the panel knows its real size.
  const framedRef = useRef<{ box: Box; scale: number } | null>(null);
  const hitsRef = useRef<Word[]>([]);
  const hitRef = useRef(0);
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [indexed, setIndexed] = useState(doc.indexedPages);
  const [outline, setOutline] = useState<{ title: string; page: number; depth: number }[]>([]);
  const [hits, setHits] = useState<Word[]>([]);
  const [hit, setHit] = useState(0);
  // Free text typed into the schematic's search field; while set it
  // replaces the board selection as what is highlighted.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState<"default" | "pointer" | "grabbing">("default");

  // --- drawing -------------------------------------------------------------

  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, -cam.x * cam.scale * dpr, -cam.y * cam.scale * dpr);

    const { width, height } = sizeRef.current;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 12 * dpr;
    ctx.fillRect(0, 0, width, height);
    ctx.shadowColor = "transparent";

    ctx.imageSmoothingQuality = "high";
    for (const layer of [baseRef.current, detailRef.current]) {
      if (layer && layer.page === pageRef.current) {
        const b = layer.box;
        ctx.drawImage(layer.canvas, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
    }

    const px = 1 / cam.scale;
    hitsRef.current.forEach((w, i) => {
      if (w.page !== pageRef.current) return;
      const b = w.box;
      const pad = 1.5 * px;
      ctx.fillStyle = "rgba(255, 196, 0, 0.32)";
      ctx.fillRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad);
      ctx.strokeStyle = i === hitRef.current ? "rgba(230, 81, 0, 1)" : "rgba(230, 140, 0, 0.8)";
      ctx.lineWidth = (i === hitRef.current ? 2.5 : 1.2) * px;
      ctx.strokeRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad);
    });

    const hover = hoverRef.current;
    if (hover && hover.page === pageRef.current) {
      const b = hover.box;
      ctx.strokeStyle = "rgba(2, 119, 189, 0.9)";
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.moveTo(b.x0, b.y1 + px);
      ctx.lineTo(b.x1, b.y1 + px);
      ctx.stroke();
    }
  }, [cam]);

  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  /** Renders a page region at a given pixel scale into a fresh canvas. */
  const renderRegion = useCallback(
    async (kind: "base" | "detail", index: number, box: Box, pixelScale: number): Promise<Layer | null> => {
      tasks.current[kind]?.cancel();
      const pdfPage = await doc.page(index);
      const viewport = pdfPage.getViewport({ scale: pixelScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil((box.x1 - box.x0) * pixelScale));
      canvas.height = Math.max(1, Math.ceil((box.y1 - box.y0) * pixelScale));
      const task = pdfPage.render({
        canvas,
        viewport,
        transform: [1, 0, 0, 1, -box.x0 * pixelScale, -box.y0 * pixelScale],
        background: "#ffffff",
      });
      tasks.current[kind] = task;
      try {
        await task.promise;
      } catch (e) {
        if (isCancel(e)) return null;
        throw e;
      }
      return { page: index, canvas, box };
    },
    [doc],
  );

  const baseScale = useCallback(() => {
    const { width, height } = sizeRef.current;
    return Math.min(BASE_MAX_PX / Math.max(width, height), 3);
  }, []);

  const scheduleDetail = useCallback(() => {
    window.clearTimeout(detailTimer.current);
    detailTimer.current = window.setTimeout(async () => {
      const pixelScale = cam.scale * dprRef.current;
      if (pixelScale <= baseScale() * 1.05) {
        detailRef.current = null;
        requestDraw();
        return;
      }
      const { width, height } = sizeRef.current;
      const v = cam.visible();
      const box = { x0: Math.max(0, v.x0), y0: Math.max(0, v.y0), x1: Math.min(width, v.x1), y1: Math.min(height, v.y1) };
      if (box.x1 <= box.x0 || box.y1 <= box.y0) return;
      try {
        const layer = await renderRegion("detail", pageRef.current, box, pixelScale);
        if (layer && layer.page === pageRef.current) {
          detailRef.current = layer;
          requestDraw();
        }
      } catch (e) {
        // Keep the lower-resolution base layer.
        console.warn("Avero: rendering schematic detail failed", e);
      }
    }, DETAIL_DELAY_MS);
  }, [cam, baseScale, renderRegion, requestDraw]);

  const viewChanged = useCallback(() => {
    requestDraw();
    scheduleDetail();
  }, [requestDraw, scheduleDetail]);

  // --- pages ---------------------------------------------------------------

  const showPage = useCallback(
    async (index: number, frameTo?: Box, scale?: number) => {
      const target = Math.max(0, Math.min(doc.pageCount - 1, index));
      const changed = target !== pageRef.current || !baseRef.current;
      pageRef.current = target;
      setPage(target);
      setPageInput(String(target + 1));
      sizeRef.current = await doc.pageSize(target);
      if (frameTo) {
        framedRef.current = { box: frameTo, scale: scale ?? cam.scale };
        cam.center(frameTo, scale ?? cam.scale);
      } else if (changed) {
        framedRef.current = null;
        cam.fitPage(sizeRef.current.width, sizeRef.current.height);
      }
      if (changed) {
        detailRef.current = null;
        const { width, height } = sizeRef.current;
        renderRegion("base", target, { x0: 0, y0: 0, x1: width, y1: height }, baseScale())
          .then((layer) => {
            if (layer && layer.page === pageRef.current) {
              baseRef.current = layer;
              requestDraw();
            }
          })
          .catch((e) => console.warn("Avero: rendering schematic page failed", e));
      }
      viewChanged();
    },
    [doc, cam, renderRegion, baseScale, requestDraw, viewChanged],
  );

  const jumpTo = useCallback(
    (index: number) => {
      const list = hitsRef.current;
      if (list.length === 0) return;
      const i = ((index % list.length) + list.length) % list.length;
      hitRef.current = i;
      setHit(i);
      const w = list[i];
      const h = Math.max(w.box.y1 - w.box.y0, 1);
      const pad = h * 6;
      const box = { x0: w.box.x0 - pad, y0: w.box.y0 - pad, x1: w.box.x1 + pad, y1: w.box.y1 + pad };
      void showPage(w.page, box, Math.max(JUMP_TEXT_PX / h, Math.min(cam.scale, 6)));
    },
    [cam, showPage],
  );

  useImperativeHandle(
    ref,
    () => ({
      nextPage: () => void showPage(pageRef.current + 1),
      prevPage: () => void showPage(pageRef.current - 1),
      nextHit: () => jumpTo(hitRef.current + 1),
      prevHit: () => jumpTo(hitRef.current - 1),
      focusSearch: () => {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
    }),
    [showPage, jumpTo],
  );

  // New document: first page, bookmarks, index progress.
  useEffect(() => {
    baseRef.current = null;
    detailRef.current = null;
    pageRef.current = -1;
    void showPage(0);
    setIndexed(doc.indexedPages);
    const unsubscribe = doc.subscribe(() => setIndexed(doc.indexedPages));
    void doc.outline().then((o) => setOutline(flattenOutline(o)));
    const pending = tasks.current;
    return () => {
      unsubscribe();
      pending.base?.cancel();
      pending.detail?.cancel();
    };
  }, [doc, showPage]);

  // A new selection on the board takes over from typed text; a text search
  // from outside (the library) fills the search field.
  useEffect(() => setQuery(focus?.partial ? focus.text : ""), [focus]);

  // Occurrences of the typed text or the focused name; re-evaluated while
  // indexing continues.
  const jumpedFor = useRef<number | string>(-1);
  const typed = query.trim();
  useEffect(() => {
    const found = typed ? doc.index.search(typed) : focus ? doc.index.find(focus.text) : [];
    hitsRef.current = found;
    setHits(found);
    if (found.length === 0) {
      hitRef.current = 0;
      setHit(0);
      requestDraw();
      return;
    }
    const jumpKey = typed ? `q:${typed}` : focus?.jump ? focus.nonce : jumpedFor.current;
    if (jumpKey !== jumpedFor.current) {
      jumpedFor.current = jumpKey;
      // A chosen occurrence, else stay on the current page when the text is on it.
      const here = found.findIndex((w) => w.page === pageRef.current);
      const wanted = !typed && focus?.hit !== undefined && focus.hit < found.length ? focus.hit : undefined;
      jumpTo(wanted ?? (here >= 0 ? here : 0));
    } else {
      hitRef.current = Math.min(hitRef.current, found.length - 1);
      requestDraw();
    }
  }, [doc, focus, typed, indexed, jumpTo, requestDraw]);

  // Size tracking.
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      const keepCenter = cam.toPage(cam.width / 2, cam.height / 2);
      cam.width = r.width;
      cam.height = r.height;
      if (first) {
        first = false;
        const framed = framedRef.current;
        if (framed) cam.center(framed.box, framed.scale);
        else cam.fitPage(sizeRef.current.width, sizeRef.current.height);
      } else {
        cam.x = keepCenter.x - cam.width / 2 / cam.scale;
        cam.y = keepCenter.y - cam.height / 2 / cam.scale;
      }
      draw();
      scheduleDetail();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cam, draw, scheduleDetail]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(detailTimer.current);
    },
    [],
  );

  // --- input ---------------------------------------------------------------

  const local = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const wordAt = (p: { x: number; y: number }): Word | undefined => {
    const q = cam.toPage(p.x, p.y);
    const w = doc.index.wordAt(pageRef.current, q.x, q.y, 2 / cam.scale);
    return w && classify(w) ? w : undefined;
  };

  const drag = useRef<{ start: { x: number; y: number }; last: { x: number; y: number }; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    drag.current = { start: p, last: p, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const d = drag.current;
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_THRESHOLD) {
        d.moved = true;
        setCursor("grabbing");
      }
      if (d.moved) {
        cam.pan(p.x - d.last.x, p.y - d.last.y);
        d.last = p;
        viewChanged();
      }
      return;
    }
    const w = wordAt(p) ?? null;
    if (w !== hoverRef.current) {
      hoverRef.current = w;
      setCursor(w ? "pointer" : "default");
      requestDraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setCursor(hoverRef.current ? "pointer" : "default");
    if (d && !d.moved) {
      const w = wordAt(local(e));
      if (w) onPick(w);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const p = local(e);
    if (e.ctrlKey || scrollRef.current === "zoom") cam.zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018)));
    else cam.pan(-e.deltaX * unit, -e.deltaY * unit);
    viewChanged();
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let last = 1;
    const block = (e: Event) => e.preventDefault();
    const start = (e: Event) => {
      e.preventDefault();
      last = 1;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const p = local(g);
      cam.zoomAt(p.x, p.y, g.scale / last);
      last = g.scale;
      viewChanged();
    };
    el.addEventListener("wheel", block, { passive: false });
    el.addEventListener("gesturestart", start);
    el.addEventListener("gesturechange", change);
    el.addEventListener("gestureend", block);
    return () => {
      el.removeEventListener("wheel", block);
      el.removeEventListener("gesturestart", start);
      el.removeEventListener("gesturechange", change);
      el.removeEventListener("gestureend", block);
    };
  }, [cam, viewChanged]);

  const zoomBy = (factor: number) => {
    cam.zoomAt(cam.width / 2, cam.height / 2, factor);
    viewChanged();
  };

  const currentOutline = useMemo(() => {
    let best = -1;
    outline.forEach((o, i) => {
      if (o.page <= page && (best < 0 || o.page >= outline[best].page)) best = i;
    });
    return best;
  }, [outline, page]);

  return (
    <section className="schematic" aria-label={t("schematic.title")}>
      <header className="schematic-bar">
        <span className="schematic-name" title={doc.path ?? doc.name}>
          <SchematicIcon />
          <span>{doc.name}</span>
        </span>
        <div className="pager">
          <button className="tool icon-only" onClick={() => void showPage(page - 1)} disabled={page === 0} aria-label={t("schematic.prevPage")} title={t("schematic.prevPage")}>
            <ChevronLeftIcon />
          </button>
          <input
            className="page-input"
            value={pageInput}
            inputMode="numeric"
            aria-label={t("schematic.page")}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = Number.parseInt(pageInput, 10);
                if (Number.isFinite(n)) void showPage(n - 1);
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => setPageInput(String(page + 1))}
          />
          <span className="muted">/ {doc.pageCount}</span>
          <button
            className="tool icon-only"
            onClick={() => void showPage(page + 1)}
            disabled={page >= doc.pageCount - 1}
            aria-label={t("schematic.nextPage")}
            title={t("schematic.nextPage")}
          >
            <ChevronRightIcon />
          </button>
        </div>
        {outline.length > 0 && (
          <select
            className="outline-select"
            value={currentOutline}
            onChange={(e) => {
              const o = outline[Number(e.target.value)];
              if (o) void showPage(o.page);
            }}
            aria-label={t("schematic.sections")}
          >
            {currentOutline < 0 && <option value={-1}>{t("schematic.sections")}</option>}
            {outline.map((o, i) => (
              <option key={i} value={i}>
                {" ".repeat(o.depth)}
                {o.title}
              </option>
            ))}
          </select>
        )}
        <div className="schematic-tools">
          <button className="tool icon-only" onClick={() => zoomBy(1 / 1.4)} aria-label={t("toolbar.zoomOut")} title={t("toolbar.zoomOut")}>
            <ZoomOutIcon />
          </button>
          <button
            className="tool icon-only"
            onClick={() => {
              cam.fitPage(sizeRef.current.width, sizeRef.current.height);
              viewChanged();
            }}
            aria-label={t("schematic.fit")}
            title={t("schematic.fit")}
          >
            <FitIcon />
          </button>
          <button className="tool icon-only" onClick={() => zoomBy(1.4)} aria-label={t("toolbar.zoomIn")} title={t("toolbar.zoomIn")}>
            <ZoomInIcon />
          </button>
        </div>
        <label className="schematic-search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            spellCheck={false}
            autoComplete="off"
            placeholder={t("schematic.search")}
            aria-label={t("schematic.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jumpTo(hitRef.current + (e.shiftKey ? -1 : 1));
              } else if (e.key === "Escape") {
                setQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </label>
        <span className="schematic-spacer" />
        {(typed || focus) && hits.length > 0 && (
          <div className="hits" title={t("schematic.hitsHint")}>
            <span className="hits-text">{typed || focus?.text}</span>
            <span className="muted">
              {hit + 1}/{hits.length}
            </span>
            <button className="tool icon-only" onClick={() => jumpTo(hit - 1)} aria-label={t("schematic.prevHit")}>
              <ChevronLeftIcon />
            </button>
            <button className="tool icon-only" onClick={() => jumpTo(hit + 1)} aria-label={t("schematic.nextHit")}>
              <ChevronRightIcon />
            </button>
          </div>
        )}
        {(typed || focus) && hits.length === 0 && indexed >= doc.pageCount && (
          <span className="muted hits-none">{t("schematic.notFound", { text: typed || focus?.text || "" })}</span>
        )}
        {indexed < doc.pageCount && <span className="muted">{t("schematic.indexing", { n: indexed, total: doc.pageCount })}</span>}
        {onPopOut && (
          <button className="tool icon-only" onClick={onPopOut} aria-label={t("schematic.popOut")} title={t("schematic.popOut")}>
            <PopOutIcon />
          </button>
        )}
        <button className="tool icon-only" onClick={onClose} aria-label={t("schematic.close")} title={t("schematic.close")}>
          <CloseIcon />
        </button>
      </header>
      <div
        ref={containerRef}
        className="schematic-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (hoverRef.current) {
            hoverRef.current = null;
            requestDraw();
          }
        }}
        onDoubleClick={(e) => {
          const p = local(e);
          cam.zoomAt(p.x, p.y, 2);
          viewChanged();
        }}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} />
      </div>
    </section>
  );
}
