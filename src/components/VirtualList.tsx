import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props<T> {
  items: T[];
  rowHeight: number;
  render(item: T, index: number): ReactNode;
  /** Index to keep in view, e.g. the selected row. */
  scrollTo?: number;
}

/** Renders only the rows in view so lists of 50 000 nets stay fast. */
export function VirtualList<T>({ items, rowHeight, render, scrollTo }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || scrollTo === undefined || scrollTo < 0) return;
    const top = scrollTo * rowHeight;
    if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2);
    }
  }, [scrollTo, rowHeight]);

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + 5);
  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <div key={i} className="vrow" style={{ top: i * rowHeight, height: rowHeight }}>
        {render(items[i], i)}
      </div>,
    );
  }

  return (
    <div ref={ref} className="vlist" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: "relative" }}>{rows}</div>
    </div>
  );
}
