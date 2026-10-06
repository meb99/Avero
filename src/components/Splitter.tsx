import { useRef, type RefObject } from "react";

interface Props {
  /** Element whose width the share refers to. */
  container: RefObject<HTMLElement | null>;
  /** Share of the container taken by the pane right of the splitter. */
  share: number;
  onDrag(share: number): void;
  onDone(share: number): void;
}

const MIN = 0.2;
const MAX = 0.8;

/** Draggable divider between the board and the schematic. */
export function Splitter({ container, share, onDrag, onDone }: Props) {
  const current = useRef(share);
  current.current = share;

  const shareAt = (clientX: number): number => {
    const r = container.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return share;
    return Math.min(MAX, Math.max(MIN, (r.right - clientX) / r.width));
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(share * 100)}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if ((e.target as Element).hasPointerCapture(e.pointerId)) onDrag(shareAt(e.clientX));
      }}
      onPointerUp={(e) => {
        document.body.classList.remove("resizing");
        (e.target as Element).releasePointerCapture(e.pointerId);
        onDone(current.current);
      }}
      onDoubleClick={() => {
        onDrag(0.5);
        onDone(0.5);
      }}
    />
  );
}

/** Smallest height a stacked pane is dragged down to, in pixels. */
const MIN_PANE = 90;

/**
 * Draggable divider between two panes stacked in the side area. Weights are
 * flex-grow values, so they hold whatever the window's size or scaling.
 */
export function StackSplitter({ onDrag, onDone }: { onDrag(before: number, after: number): void; onDone(): void }) {
  const start = useRef<{ y: number; before: number; after: number } | null>(null);
  return (
    <div
      className="stack-splitter"
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={(e) => {
        const el = e.currentTarget;
        const before = el.previousElementSibling?.getBoundingClientRect().height ?? 0;
        const after = el.nextElementSibling?.getBoundingClientRect().height ?? 0;
        start.current = { y: e.clientY, before, after };
        el.setPointerCapture(e.pointerId);
        document.body.classList.add("resizing-rows");
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const total = s.before + s.after;
        const before = Math.min(total - MIN_PANE, Math.max(MIN_PANE, s.before + e.clientY - s.y));
        onDrag(before / total, (total - before) / total);
      }}
      onPointerUp={(e) => {
        document.body.classList.remove("resizing-rows");
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
        onDone();
      }}
      onDoubleClick={() => {
        onDrag(0.5, 0.5);
        onDone();
      }}
    />
  );
}
