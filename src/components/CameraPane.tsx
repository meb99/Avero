import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardModel } from "../core/board";
import type { Point, Selection } from "../core/types";
import { useI18n } from "../i18n";
import {
  boardToVideo,
  calibrate,
  greyThumb,
  loadCalibration,
  MOVED,
  saveCalibration,
  screenToVideo,
  THUMB_H,
  THUMB_W,
  thumbDifference,
  videoToBoard,
  videoToScreen,
  type CameraCalibration,
} from "../workbench/cameraOverlay";
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
  model,
  boardKey,
  selection,
  side,
  onSelect,
}: {
  /** A PNG of what is on screen: into the repair case, or as the board photo. */
  onSnapshot(png: Uint8Array, use: "case" | "board"): void;
  onClose(): void;
  /** The board, for the overlay; without it the picture is shown plain. */
  model?: BoardModel;
  /** Calibrations are kept per board. */
  boardKey?: string;
  selection?: Selection;
  /** Side in view on the board (for a pin on both sides). */
  side?: "top" | "bottom";
  onSelect?(selection: Selection): void;
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

  // --- the board over the picture -------------------------------------------------
  const [cal, setCal] = useState<CameraCalibration | null>(() => (boardKey ? loadCalibration(boardKey) : null));
  useEffect(() => setCal(boardKey ? loadCalibration(boardKey) : null), [boardKey]);
  const [calibrating, setCalibrating] = useState<{ video: Point[]; board: Point[]; side: "top" | "bottom" } | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [allPads, setAllPads] = useState(false);
  const [moved, setMoved] = useState(false);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  /** The selected spot on the board: a pin, a test point, or a part's centre. */
  const target = (() => {
    if (!model || !selection) return null;
    if (selection.kind === "pin") {
      const p = model.pins[selection.pin];
      return { x: p.x, y: p.y, label: model.pinLabel(selection.pin), side: p.side === "both" ? (side ?? "top") : p.side };
    }
    if (selection.kind === "testPoint") {
      const tp = model.testPoints[selection.testPoint];
      return { x: tp.x, y: tp.y, label: tp.name ?? "TP", side: tp.side === "both" ? (side ?? "top") : tp.side };
    }
    return null;
  })();

  /** The video's layout box in the frame and its pixel size. */
  const geometry = () => {
    const el = videoRef.current;
    if (!el || !el.videoWidth) return null;
    return { video: { width: el.videoWidth, height: el.videoHeight }, box: { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } };
  };

  const thumbNow = (): number[] | null => {
    const el = videoRef.current;
    if (!el || !el.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = THUMB_W;
    c.height = THUMB_H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0, THUMB_W, THUMB_H);
    return greyThumb(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data);
  };

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const dpr = window.devicePixelRatio || 1;
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = geometry();
    if (!g) return;
    const toScreen = (v: Point) => videoToScreen(v, g.video, g.box, view);
    // Points picked while calibrating.
    if (calibrating) {
      ctx.strokeStyle = "#ffd600";
      ctx.lineWidth = 2;
      calibrating.video.forEach((v, i) => {
        const s = toScreen(v);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#ffd600";
        ctx.font = "600 12px system-ui";
        ctx.fillText(String(i + 1), s.x + 9, s.y - 9);
      });
      return;
    }
    if (!cal || !overlay || !model) return;
    const toVideo = boardToVideo(cal);
    if (!toVideo) return;
    const at = (b: Point) => toScreen(toVideo(b));
    /** A pad's radius on screen, from a point beside it. */
    const radius = (b: Point, r: number) => {
      const a = at(b);
      const c = at({ x: b.x + r, y: b.y });
      return Math.max(3, Math.hypot(c.x - a.x, c.y - a.y));
    };
    const onSide = (s: string) => s === cal.side || s === "both";
    const ring = (b: Point, r: number, color: string, width: number) => {
      const s = at(b);
      if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius(b, r) + 2, 0, Math.PI * 2);
      ctx.stroke();
    };
    if (allPads) {
      let drawn = 0;
      for (const p of model.pins) {
        if (!onSide(p.side) || drawn++ > 4000) continue;
        ring(p, p.radius, "rgba(79, 195, 247, 0.45)", 1);
      }
    }
    // The selected net's pads, and the selected pad: rings around them, the joint itself left free.
    const net = model.selectedNet(selection ?? { kind: "none" });
    if (net !== undefined) for (const i of model.nets[net].pins) if (onSide(model.pins[i].side)) ring(model.pins[i], model.pins[i].radius, "rgba(255, 214, 0, 0.9)", 2);
    if (selection?.kind === "part") {
      const part = model.parts[selection.part];
      for (let i = part.firstPin; i < part.firstPin + part.pinCount; i++) if (onSide(model.pins[i].side)) ring(model.pins[i], model.pins[i].radius, "rgba(255, 214, 0, 0.9)", 2);
    }
    if (target && onSide(target.side)) {
      const s = at(target);
      const r = radius(target, selection?.kind === "pin" ? model.pins[selection.pin].radius : 10) + 5;
      ctx.strokeStyle = "#ff4081";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // Ticks pointing in from outside, not over the joint.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath();
        ctx.moveTo(s.x + dx * (r + 4), s.y + dy * (r + 4));
        ctx.lineTo(s.x + dx * (r + 14), s.y + dy * (r + 14));
        ctx.stroke();
      }
    }
  }, [cal, calibrating, overlay, allPads, model, selection, target?.x, target?.y, target?.side, view]);

  useEffect(() => {
    drawOverlay();
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => drawOverlay());
    observer.observe(frame);
    const el = videoRef.current;
    el?.addEventListener("loadedmetadata", drawOverlay);
    return () => {
      observer.disconnect();
      el?.removeEventListener("loadedmetadata", drawOverlay);
    };
  }, [drawOverlay]);

  // A camera or board that moved since calibrating: the alignment is no longer to be trusted.
  useEffect(() => {
    if (!cal || frozen) return;
    let streak = 0;
    const timer = window.setInterval(() => {
      const now = thumbNow();
      if (!now) return;
      streak = thumbDifference(now, cal.thumb) > MOVED ? streak + 1 : 0;
      setMoved(streak >= 3);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cal, frozen]);

  const startCalibration = () => {
    setMoved(false);
    setCalibrating({ video: [], board: [], side: target?.side === "bottom" ? "bottom" : (side ?? "top") });
  };

  const onOverlayClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = geometry();
    if (!g || !model) return;
    const r = e.currentTarget.getBoundingClientRect();
    const v = screenToVideo({ x: e.clientX - r.left, y: e.clientY - r.top }, g.video, g.box, view);
    if (calibrating) {
      if (!target) return setCalError(t("cam.pickPinFirst"));
      if (calibrating.board.some((b) => b.x === target.x && b.y === target.y)) return setCalError(t("cam.otherPin"));
      setCalError(null);
      const next = { ...calibrating, video: [...calibrating.video, v], board: [...calibrating.board, { x: target.x, y: target.y }] };
      if (next.video.length < 4) return setCalibrating(next);
      const made = calibrate(next.video, next.board);
      setCalibrating(null);
      if (!made) return setCalError(t("cam.badPoints"));
      const done: CameraCalibration = {
        side: next.side,
        toBoard: made.toBoard,
        videoWidth: g.video.width,
        videoHeight: g.video.height,
        thumb: thumbNow() ?? [],
        created: new Date().toISOString(),
      };
      setCal(done);
      if (boardKey) saveCalibration(boardKey, done);
      return;
    }
    if (!cal || !onSelect) return;
    const b = videoToBoard(cal, v);
    // A few screen pixels of slack, in board units.
    const toVideo = boardToVideo(cal);
    const unit = toVideo ? Math.hypot(...((): [number, number] => {
      const a = videoToScreen(toVideo(b), g.video, g.box, view);
      const c = videoToScreen(toVideo({ x: b.x + 10, y: b.y }), g.video, g.box, view);
      return [c.x - a.x, c.y - a.y];
    })()) / 10 : 1;
    const hit = model.hitTest(b, cal.side, 6 / Math.max(unit, 1e-6), true, false);
    if (hit) onSelect(hit.kind === "pin" ? { kind: "pin", pin: hit.pin } : hit.kind === "testPoint" ? { kind: "testPoint", testPoint: hit.testPoint } : hit.kind === "part" ? { kind: "part", part: hit.part } : { kind: "net", net: hit.net });
  };
  const [calError, setCalError] = useState<string | null>(null);

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
        {model && (
          <>
            <button className={`small${calibrating ? " on" : ""}`} onClick={() => (calibrating ? setCalibrating(null) : startCalibration())} title={t("cam.alignHint")}>
              {calibrating ? t("cam.alignStop") : cal ? t("cam.realign") : t("cam.align")}
            </button>
            {cal && (
              <>
                <button className={`small${overlay ? " on" : ""}`} aria-pressed={overlay} onClick={() => setOverlay((o) => !o)}>
                  {t("cam.overlay")}
                </button>
                <button className={`small${allPads ? " on" : ""}`} aria-pressed={allPads} onClick={() => setAllPads((a) => !a)}>
                  {t("cam.allPads")}
                </button>
              </>
            )}
          </>
        )}
      </div>
      <div className={`camera-frame${flash ? " flash" : ""}`} ref={frameRef}>
        {error ? (
          <p className="camera-error">{error}</p>
        ) : (
          <>
            <video ref={videoRef} muted playsInline style={{ transform }} />
            {view.grid && <div className="camera-grid" aria-hidden />}
            {model && (
              <canvas
                ref={overlayRef}
                className={`camera-overlay${calibrating || cal ? " live" : ""}`}
                onClick={onOverlayClick}
                aria-label={t("cam.overlay")}
              />
            )}
            <div className="cam-hints">
        {calibrating && (
          <p className="cam-hint">
            {t("cam.step", { n: calibrating.video.length + 1, label: target?.label ?? "…" })}
            {calError && <span className="wb-error"> {calError}</span>}
          </p>
        )}
        {!calibrating && calError && <p className="cam-hint wb-error">{calError}</p>}
        {cal && moved && !calibrating && (
          <p className="cam-hint cam-moved">
            {t("cam.moved")}{" "}
            <button className="small" onClick={startCalibration}>
              {t("cam.realign")}
            </button>{" "}
            <button
              className="small"
              onClick={() => {
                const now = thumbNow();
                if (!now) return;
                const next = { ...cal, thumb: now };
                setCal(next);
                if (boardKey) saveCalibration(boardKey, next);
                setMoved(false);
              }}
            >
              {t("cam.stillFits")}
            </button>
          </p>
        )}
            </div>
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
