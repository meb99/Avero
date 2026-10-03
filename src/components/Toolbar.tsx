import type { Ref } from "react";
import type { BoardModel, ViewSide } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import {
  CloseIcon,
  FitIcon,
  FlagIcon,
  FlipIcon,
  HelpIcon,
  LibraryIcon,
  OpenIcon,
  RotateIcon,
  SchematicIcon,
  SettingsIcon,
  SidebarIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./Icons";
import { SearchBox } from "./SearchBox";

interface Props {
  model: BoardModel | null;
  side: ViewSide;
  hasSchematic: boolean;
  schematicVisible: boolean;
  sidebarVisible: boolean;
  onOpen(): void;
  onClose(): void;
  /** Oben / Unten switch on and off on their own; at least one stays on. */
  onToggleSide(side: ViewSide): void;
  onFlip(): void;
  bothSides: boolean;
  bothSidesMode: "together" | "separate" | "synced";
  onBothSidesMode(mode: "together" | "separate" | "synced"): void;
  onRotate(): void;
  onFit(): void;
  onZoom(factor: number): void;
  onSchematic(): void;
  onLibrary(): void;
  onSidebar(): void;
  onSettings(): void;
  onHelp(): void;
  onPick(selection: Selection): void;
  searchRef: Ref<HTMLInputElement>;
  /** Next click on the board places a note. */
  placingMarker: boolean;
  onMarker(): void;
  /** Drawing tool in use, and starting or stopping one. */
  drawing: "line" | "area" | "jumper" | "ruler" | null;
  onDraw(kind: "line" | "area" | "jumper" | "ruler" | null): void;
}

export function Toolbar(p: Props) {
  const { t } = useI18n();
  const board = p.model !== null;
  return (
    // The toolbar doubles as the macOS title bar: empty areas drag the window.
    <header className="toolbar" data-tauri-drag-region>
      <div className="toolbar-group" data-tauri-drag-region>
        <div className="brand" aria-label="Avero" data-tauri-drag-region>
          <img src={`${import.meta.env.BASE_URL}avero.svg`} alt="" width={22} height={22} />
          <span>Avero</span>
        </div>
        <button className="tool" onClick={p.onOpen} title={`${t("toolbar.open")} (⌘O)`}>
          <OpenIcon />
          <span className="tool-label">{t("toolbar.open")}</span>
        </button>
        {board && (
          <button className="tool icon-only" onClick={p.onClose} title={t("toolbar.close")} aria-label={t("toolbar.close")}>
            <CloseIcon />
          </button>
        )}
      </div>

      {board && (
        <>
          <div className="toolbar-group">
            <div className="segmented" role="group" aria-label={t("toolbar.sides")} title={t("toolbar.sidesHint")}>
              {(["top", "bottom"] as const).map((s) => {
                const on = p.bothSides || p.side === s;
                return (
                  <button key={s} aria-pressed={on} className={on ? "on" : ""} onClick={() => p.onToggleSide(s)}>
                    {t(s === "top" ? "toolbar.top" : "toolbar.bottom")}
                  </button>
                );
              })}
            </div>
            {p.bothSides && (
              <select
                className="tool sides-mode"
                value={p.bothSidesMode}
                title={t("sides.modeHint")}
                aria-label={t("sides.mode")}
                onChange={(e) => p.onBothSidesMode(e.target.value as "together" | "separate" | "synced")}
              >
                <option value="together">{t("sides.together")}</option>
                <option value="separate">{t("sides.separate")}</option>
                <option value="synced">{t("sides.synced")}</option>
              </select>
            )}
            <button className="tool icon-only" onClick={p.onFlip} title={t("toolbar.flip")} aria-label={t("toolbar.flip")}>
              <FlipIcon />
            </button>
            <button className="tool icon-only" onClick={p.onRotate} title={t("toolbar.rotate")} aria-label={t("toolbar.rotate")}>
              <RotateIcon />
            </button>
            <button className="tool icon-only" onClick={p.onFit} title={t("toolbar.fit")} aria-label={t("toolbar.fit")}>
              <FitIcon />
            </button>
            <button className="tool icon-only" onClick={() => p.onZoom(1 / 1.5)} title={t("toolbar.zoomOut")} aria-label={t("toolbar.zoomOut")}>
              <ZoomOutIcon />
            </button>
            <button className="tool icon-only" onClick={() => p.onZoom(1.5)} title={t("toolbar.zoomIn")} aria-label={t("toolbar.zoomIn")}>
              <ZoomInIcon />
            </button>
            <button
              className={`tool icon-only${p.placingMarker ? " active" : ""}`}
              onClick={p.onMarker}
              title={`${t("marker.place")} (M)`}
              aria-label={t("marker.place")}
              aria-pressed={p.placingMarker}
            >
              <FlagIcon />
            </button>
            <select
              className={`tool draw-select${p.drawing ? " active" : ""}`}
              value={p.drawing ?? ""}
              title={t("draw.title")}
              aria-label={t("draw.title")}
              onChange={(e) => p.onDraw((e.target.value || null) as "line" | "area" | "jumper" | "ruler" | null)}
            >
              <option value="">✎ {t("draw.title")}</option>
              <option value="line">{t("draw.line")}</option>
              <option value="area">{t("draw.area")}</option>
              <option value="jumper">{t("draw.jumper")}</option>
              <option value="ruler">{t("ruler.title")} (L)</option>
            </select>
          </div>
          <div className="toolbar-search">
            <SearchBox model={p.model!} onPick={p.onPick} inputRef={p.searchRef} />
          </div>
        </>
      )}

      <div className="toolbar-spacer" data-tauri-drag-region />
      <div className="toolbar-group">
        <button className="tool icon-only" onClick={p.onLibrary} title={t("library.toggle")} aria-label={t("library.toggle")}>
          <LibraryIcon />
        </button>
        <button
          className={`tool icon-only${p.schematicVisible ? " active" : ""}`}
          onClick={p.onSchematic}
          title={p.hasSchematic ? t("schematic.toggle") : t("schematic.open")}
          aria-label={p.hasSchematic ? t("schematic.toggle") : t("schematic.open")}
          aria-pressed={p.schematicVisible}
        >
          <SchematicIcon />
        </button>
        {board && (
          <button
            className={`tool icon-only${p.sidebarVisible ? " active" : ""}`}
            onClick={p.onSidebar}
            title={t("toolbar.sidebar")}
            aria-label={t("toolbar.sidebar")}
            aria-pressed={p.sidebarVisible}
          >
            <SidebarIcon />
          </button>
        )}
        <button className="tool icon-only" onClick={p.onHelp} title={t("toolbar.help")} aria-label={t("toolbar.help")}>
          <HelpIcon />
        </button>
        <button className="tool icon-only" onClick={p.onSettings} title={t("toolbar.settings")} aria-label={t("toolbar.settings")}>
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
