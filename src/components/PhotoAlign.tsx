import { useEffect, useRef } from "react";
import type { Point } from "../core/types";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialogs";

/**
 * Step 1 of aligning a photo: two points picked on the photo. Points are in
 * photo units (pixels divided by the image width).
 */
export function PhotoPointDialog({
  image,
  points,
  onPoint,
  onCancel,
}: {
  image: HTMLCanvasElement;
  points: Point[];
  onPoint(p: Point): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    image.className = "photo-image";
    frame.prepend(image);
    return () => image.remove();
  }, [image]);

  const aspect = image.height / image.width;
  return (
    <Dialog title={t("photo.alignTitle")} onClose={onCancel} className="photo-dialog">
      <p className="muted">{t("photo.alignPhoto")}</p>
      <div
        ref={frameRef}
        className="photo-frame"
        // As wide as fits, but never taller than 68 % of the window; the
        // photo fills the frame, so click positions map straight to it.
        style={{ width: `min(100%, calc(68vh * ${image.width / image.height}))` }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPoint({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width });
        }}
      >
        {points.map((p, i) => (
          <span key={i} className="photo-marker" style={{ left: `${p.x * 100}%`, top: `${(p.y / aspect) * 100}%` }}>
            {i + 1}
          </span>
        ))}
      </div>
    </Dialog>
  );
}

/** Step 2: banner over the board with a close-up of the photo point to find. */
export function PhotoBoardHint({
  image,
  point,
  index,
  onCancel,
}: {
  image: HTMLCanvasElement;
  point: Point;
  index: number;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const SIZE = 132;

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const span = image.width / 12;
    const cx = point.x * image.width;
    const cy = point.y * image.width;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(image, cx - span / 2, cy - span / 2, span, span, 0, 0, SIZE, SIZE);
    ctx.strokeStyle = "#ffd54f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 9, 0, Math.PI * 2);
    ctx.moveTo(SIZE / 2 - 16, SIZE / 2);
    ctx.lineTo(SIZE / 2 - 9, SIZE / 2);
    ctx.moveTo(SIZE / 2 + 9, SIZE / 2);
    ctx.lineTo(SIZE / 2 + 16, SIZE / 2);
    ctx.stroke();
  }, [image, point]);

  return (
    <div className="photo-hint" role="status">
      <canvas ref={ref} width={SIZE} height={SIZE} />
      <div>
        <strong>{t("photo.alignTitle")}</strong>
        <p>{t("photo.alignBoard", { n: index + 1 })}</p>
        <button className="small" onClick={onCancel}>
          {t("photo.cancel")}
        </button>
      </div>
    </div>
  );
}
