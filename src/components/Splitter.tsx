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
