import type { BoardModel, ViewSide } from "../core/board";
import type { BoardSource } from "../core/loader";
import type { Selection } from "../core/types";
import { useBoardCursor } from "../cursorStore";
import { useI18n, type MessageKey } from "../i18n";
import type { ScopeRow } from "../core/dataScope";
import type { Settings } from "../settings";
import { MILS_PER_MM } from "../core/types";

interface Props {
  model: BoardModel | null;
  source: BoardSource | null;
  selection: Selection;
  loading: string | null;
  settings: Settings;
  /** The last message; `fresh` while it is new (it used to float over the board as a toast). */
  message: { text: string; fresh: boolean } | null;
  /** What the board's data holds (see dataScope). */
  scope?: ScopeRow[] | null;
  /** The side in view, or both. */
  side: ViewSide | "both";
  /** The repair case being worked on, if any. */
  caseTitle?: string | null;
  onReport(): void;
}

/** The selection as FlexBV's status bar writes it: "U1000", "C7782:1(PP3V3)" or the net. */
export function selectionLabel(model: BoardModel, sel: Selection): string | null {
  switch (sel.kind) {
    case "part":
      return model.parts[sel.part].name;
    case "pin": {
      const pin = model.pins[sel.pin];
      return `${model.parts[pin.part].name}:${pin.number}(${model.nets[pin.net].name})`;
    }
    case "net":
      return model.nets[sel.net].name;
    case "testPoint": {
      const tp = model.testPoints[sel.testPoint];
      return `${tp.name ?? tp.probe ?? "TP"}(${model.nets[tp.net].name})`;
    }
    case "none":
      return null;
  }
}

/** Where the mouse is: side, inches and millimetres, as FlexBV shows it. */
function CursorReadout() {
  const { t } = useI18n();
  const c = useBoardCursor();
  if (!c) return <span className="status-cursor muted">–</span>;
  const inch = (v: number) => (v / 1000).toFixed(3);
  const mm = (v: number) => (v / MILS_PER_MM).toFixed(2);
  return (
    <span className="status-cursor" title={c.fromOrigin ? t("status.fromOrigin") : undefined}>
      {c.fromOrigin ? "Δ " : ""}
      {t(c.side === "bottom" ? "status.sideBottom" : "status.sideTop")} {inch(c.x)}, {inch(c.y)}″ ({mm(c.x)}, {mm(c.y)} mm)
    </span>
  );
}

/**
 * The bar under the board, laid out like FlexBV's: version, the last message, the
 * selection, the mouse position, and the file at the right end. What the file holds and
 * what Avero derived from it stays one click away (import report).
 */
export function StatusBar({ model, source, selection, loading, settings, message, scope, side, caseTitle, onReport }: Props) {
  const { t } = useI18n();
  const b = model?.board;
  const copper = scope?.find((r) => r.id === "traces");
  const derived = scope?.some((r) => r.state === "derived" || r.state === "estimated");
  return (
    <footer className="statusbar">
      <span className="muted">Avero {__APP_VERSION__}</span>
      <span className={`status-message${message?.fresh ? " fresh" : ""}`} role="status" title={message?.text}>
        {loading ? t("status.loading", { name: loading }) : (message?.text ?? "")}
      </span>
      {b && (
        <>
          <span className="status-selection">{(model && selectionLabel(model, selection)) ?? t("status.noSelection")}</span>
          <CursorReadout />
          <span className="status-side">{t(`status.side.${side}` as MessageKey)}</span>
          {copper && (
            <button className={`link status-scope scope-state-${copper.state}`} onClick={onReport} title={t("scope.statusHint")}>
              {t(`scope.status.${copper.state}` as MessageKey, { n: copper.n ?? 0, m: copper.m ?? 0 })}
              {derived && copper.state !== "derived" ? ` · ${t("scope.status.reconstructed")}` : ""}
            </button>
          )}
          {b.warnings.length > 0 && (
            <span className="status-warn" title={b.warnings.join("\n")}>
              {t("status.warnings", { n: b.warnings.length })}
            </span>
          )}
          {caseTitle && <span className="status-case">{t("status.case", { title: caseTitle })}</span>}
        </>
      )}
      <span className="status-spacer" />
      {settings.localMode && (
        <span className="status-local" title={t("local.statusHint")}>
          {t("local.status")}
        </span>
      )}
      {source && (
        <span className="status-file" title={source.path ?? source.name}>
          {source.name}
        </span>
      )}
    </footer>
  );
}
