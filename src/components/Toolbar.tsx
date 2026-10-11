import type { Ref } from "react";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n, type MessageKey } from "../i18n";
import { SearchBox } from "./SearchBox";
import { Sym, type SymbolName } from "./Symbols";

interface Props {
  model: BoardModel | null;
  hasSchematic: boolean;
  schematicVisible: boolean;
  onSchematic(): void;
  /** Zoom by a factor: big steps (×2) and small ones (×1.25), as in FlexBV. */
  onZoom(factor: number): void;
  /** A quarter turn: 1 clockwise, -1 counter-clockwise. */
  onRotate(step: 1 | -1): void;
  /** The other side, mirrored left-right ("h") or top-bottom ("v"). */
  onFlip(axis: "h" | "v"): void;
  onFit(): void;
  bothSides: boolean;
  onBothSides(): void;
  onClear(): void;
  /** Shields and frames kept out of sight. */
  mechanicalHidden: boolean;
  onMechanical(): void;
  ratsnest: boolean;
  onRatsnest(): void;
  onScreenshot(): void;
  onPick(selection: Selection): void;
  searchRef: Ref<HTMLInputElement>;
}

/**
 * The bar above the board, laid out like FlexBV's: one row of symbols for the view, the
 * search at the end. Files, settings and the workshop are in the menu bar and the
 * command palette (⌘K). The bar doubles as the macOS title bar: empty areas drag the window.
 */
export function Toolbar(p: Props) {
  const { t } = useI18n();
  const board = p.model !== null;
  const tool = (symbol: SymbolName, label: MessageKey, run: () => void, on?: boolean) => (
    <button
      className={`tool icon-only${on ? " active" : ""}`}
      onClick={run}
      title={t(label)}
      aria-label={t(label)}
      aria-pressed={on}
      disabled={!board}
    >
      <Sym name={symbol} />
    </button>
  );
  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="toolbar-group symbols" role="toolbar" aria-label={t("toolbar.viewTools")}>
        <button
          className={`tool icon-only${p.schematicVisible ? " active" : ""}`}
          onClick={p.onSchematic}
          title={p.hasSchematic ? t("schematic.toggle") : t("schematic.open")}
          aria-label={p.hasSchematic ? t("schematic.toggle") : t("schematic.open")}
          aria-pressed={p.schematicVisible}
        >
          <Sym name="split" />
        </button>
        {tool("zoomOut", "toolbar.zoomOut", () => p.onZoom(1 / 2))}
        {tool("zoomIn", "toolbar.zoomIn", () => p.onZoom(2))}
        {tool("stepOut", "toolbar.stepOut", () => p.onZoom(1 / 1.25))}
        {tool("stepIn", "toolbar.stepIn", () => p.onZoom(1.25))}
        {tool("rotateLeft", "toolbar.rotateLeft", () => p.onRotate(-1))}
        {tool("flipVertical", "toolbar.flipVertical", () => p.onFlip("v"))}
        {tool("flipHorizontal", "toolbar.flipHorizontal", () => p.onFlip("h"))}
        {tool("rotateRight", "toolbar.rotateRight", () => p.onRotate(1))}
        {tool("fit", "toolbar.fit", p.onFit)}
        {tool(p.bothSides ? "panel" : "bothSides", p.bothSides ? "toolbar.oneSide" : "toolbar.bothSides", p.onBothSides, p.bothSides)}
        {tool("clear", "toolbar.clear", p.onClear)}
        {tool(p.mechanicalHidden ? "hidden" : "visible", p.mechanicalHidden ? "mechanical.show" : "mechanical.hide", p.onMechanical)}
        {tool("lines", "menu.ratsnest", p.onRatsnest, p.ratsnest)}
        {tool("camera", "toolbar.screenshot", p.onScreenshot)}
      </div>
      <div className="toolbar-spacer" data-tauri-drag-region />
      {board && (
        <div className="toolbar-search">
          <SearchBox model={p.model!} onPick={p.onPick} inputRef={p.searchRef} />
        </div>
      )}
    </header>
  );
}
