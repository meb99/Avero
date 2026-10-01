import { useEffect, useState } from "react";
import type { BoardModel } from "../core/board";
import type { Point } from "../core/types";
import { useI18n } from "../i18n";
import type { RGBA } from "../render/palette";
import type { BoardMarker } from "../workbench/notes";

/** Text box for a board note, shown next to its pin. */
export function MarkerEditor({
  marker,
  at,
  onSave,
  onDelete,
  onClose,
}: {
  marker: BoardMarker;
  /** Screen position of the marker in the board view. */
  at: Point;
  onSave(text: string): void;
  onDelete(): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(marker.text);
  useEffect(() => setText(marker.text), [marker.id]);
  // Saving closes the editor on the caller's side; closing alone is cancel.
  const save = () => onSave(text.trim());
  return (
    <div
      className="marker-editor"
      style={{ left: at.x + 14, top: Math.max(8, at.y - 24) }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder={t("marker.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="marker-editor-actions">
        <button className="small danger" onClick={onDelete}>
          {t("marker.delete")}
        </button>
        <button className="small" onClick={onClose}>
          {t("photo.cancel")}
        </button>
        <button className="small primary" onClick={save}>
          {t("marker.save")}
        </button>
      </div>
    </div>
  );
}

/** Nets pinned in their own colors, as chips on the board. */
export function PinnedLegend({
  model,
  pinned,
  onSelect,
  onUnpin,
}: {
  model: BoardModel;
  pinned: ReadonlyMap<number, RGBA>;
  onSelect(net: number): void;
  onUnpin(net: number): void;
}) {
  const { t } = useI18n();
  if (pinned.size === 0) return null;
  return (
    <div
      className="pinned-legend"
      aria-label={t("pin.legend")}
      // Clicks here must not reach the board below.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {[...pinned].map(([net, [r, g, b]]) => (
        <span key={net} className="pinned-chip">
          <span className="pinned-swatch" style={{ background: `rgb(${r} ${g} ${b})` }} />
          <button className="link" onClick={() => onSelect(net)}>
            {model.nets[net].name}
          </button>
          <button className="tool icon-only" onClick={() => onUnpin(net)} aria-label={t("pin.unpin")} title={t("pin.unpin")}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
