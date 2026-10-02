import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { CloseIcon } from "./Icons";

const DEVICE_KEY = "avero.camera.device";
const VIEW_KEY = "avero.camera.view";

interface CameraView {
  /** Digital zoom, 1–6. */
  zoom: number;
  mirror: boolean;
  /** Quarter turns. */
  turns: number;
  /** Crosshair and grid over the picture. */
  grid: boolean;
}

const DEFAULT_VIEW: CameraView = { zoom: 1, mirror: false, turns: 0, grid: false };

function loadView(): CameraView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<CameraView> | null;
    return { ...DEFAULT_VIEW, ...v };
  } catch {
    return DEFAULT_VIEW;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience.
  }
}

/**
 * Live picture of a USB microscope or camera beside the board, with digital
 * zoom, mirror and turn as the microscope stands, and snapshots that go into
 * the repair case or become the aligned board photo.
 */
export function CameraPane({
  onSnapshot,
  onClose,
}: {
  /** A PNG of what is on screen: into the repair case, or as the board photo. */
  onSnapshot(png: Uint8Array, use: "case" | "board"): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem(DEVICE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [view, setView] = useState<CameraView>(loadView);
  const [flash, setFlash] = useState(false);

  const changeView = (change: Partial<CameraView>) =>
    setView((old) => {
      const next = { ...old, ...change };
      remember(VIEW_KEY, JSON.stringify(next));
      return next;
    });

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t("camera.unsupported"));
      return;
    }
    let stream: MediaStream | null = null;
    let gone = false;
    setError(null);
    const video = deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };
    navigator.mediaDevices
      .getUserMedia({ video, audio: false })
      .catch((e: unknown) => {
        // A remembered camera that is unplugged: take any.
        if (deviceId && e instanceof DOMException && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
          return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        throw e;
      })
      .then(
        async (s) => {
          if (gone) return s.getTracks().forEach((track) => track.stop());
          stream = s;
          const el = videoRef.current;
          if (el) {
            el.srcObject = s;
            await el.play().catch(() => {});
          }
          // Labels are only there once access is granted.
          const all = await navigator.mediaDevices.enumerateDevices();
          if (!gone) setDevices(all.filter((d) => d.kind === "videoinput"));
        },
        (e: unknown) => {
          if (gone) return;
          const name = e instanceof DOMException ? e.name : "";
          setError(
            name === "NotAllowedError" || name === "SecurityError"
              ? t("camera.denied")
              : name === "NotFoundError"
                ? t("camera.none")
                : t("camera.failed", { message: e instanceof Error ? e.message : String(e) }),
          );
        },
      );
    return () => {
      gone = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (frozen) el.pause();
    else void el.play().catch(() => {});
  }, [frozen]);

  /** The picture as on screen: zoomed part, mirrored and turned. */
  const snapshot = async (): Promise<Uint8Array | null> => {
    const el = videoRef.current;
    if (!el || !el.videoWidth) return null;
    const sw = el.videoWidth / view.zoom;
    const sh = el.videoHeight / view.zoom;
    const sx = (el.videoWidth - sw) / 2;
    const sy = (el.videoHeight - sh) / 2;
    const quarter = view.turns % 2 === 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(quarter ? sh : sw);
    canvas.height = Math.round(quarter ? sw : sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((view.turns * Math.PI) / 2);
    if (view.mirror) ctx.scale(-1, 1);
    ctx.drawImage(el, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  };

  const take = async (use: "case" | "board") => {
    const png = await snapshot();
    if (!png) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    onSnapshot(png, use);
  };

  const transform = `rotate(${view.turns * 90}deg) scale(${view.mirror ? -view.zoom : view.zoom}, ${view.zoom})`;

  return (
    <div className="camera-pane">
      <div className="compare-bar camera-bar">
        <strong>{t("camera.title")}</strong>
        {devices.length > 1 && (
          <select
            value={deviceId}
            aria-label={t("camera.device")}
            onChange={(e) => {
              setDeviceId(e.target.value);
              remember(DEVICE_KEY, e.target.value);
            }}
          >
            <option value="">{t("camera.anyDevice")}</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `${t("camera.title")} ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <button className="tool icon-only" title={t("photo.paneClose")} aria-label={t("photo.paneClose")} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="compare-bar camera-tools">
        <label className="camera-zoom">
          {t("camera.zoom")}
          <input type="range" min={1} max={6} step={0.1} value={view.zoom} onChange={(e) => changeView({ zoom: Number(e.target.value) })} />
          <span className="mono">{view.zoom.toFixed(1)}×</span>
        </label>
        <button className={`small${view.mirror ? " on" : ""}`} aria-pressed={view.mirror} onClick={() => changeView({ mirror: !view.mirror })}>
          {t("camera.mirror")}
        </button>
        <button className="small" onClick={() => changeView({ turns: (view.turns + 1) % 4 })}>
          {t("camera.turn")}
        </button>
        <button className={`small${view.grid ? " on" : ""}`} aria-pressed={view.grid} onClick={() => changeView({ grid: !view.grid })}>
          {t("camera.grid")}
        </button>
        <button className={`small${frozen ? " on" : ""}`} aria-pressed={frozen} onClick={() => setFrozen((f) => !f)} title={t("camera.freezeHint")}>
          {frozen ? t("camera.live") : t("camera.freeze")}
        </button>
      </div>
      <div className={`camera-frame${flash ? " flash" : ""}`}>
        {error ? (
          <p className="camera-error">{error}</p>
        ) : (
          <>
            <video ref={videoRef} muted playsInline style={{ transform }} />
            {view.grid && <div className="camera-grid" aria-hidden />}
          </>
        )}
      </div>
      <div className="compare-bar camera-actions">
        <button className="small primary" disabled={!!error} onClick={() => void take("case")} title={t("camera.toCaseHint")}>
          {t("camera.toCase")}
        </button>
        <button className="small" disabled={!!error} onClick={() => void take("board")} title={t("camera.toBoardHint")}>
          {t("camera.toBoard")}
        </button>
      </div>
    </div>
  );
}
