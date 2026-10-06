import type { BoardModel } from "../core/board";
import type { BoardSource } from "../core/loader";
import type { SchematicDocument } from "../schematic/document";
import { formatSize } from "../format";
import { useI18n, type MessageKey } from "../i18n";
import type { ScopeRow } from "../core/dataScope";
import type { Settings } from "../settings";

interface Props {
  model: BoardModel | null;
  source: BoardSource | null;
  schematic: SchematicDocument | null;
  loading: string | null;
  settings: Settings;
  /** What the board's data holds (see dataScope). */
  scope?: ScopeRow[] | null;
  onReport(): void;
}

/** Copper first: whether the board has it, hidden, added by Avero, or none in the file. */
function copperChip(scope: ScopeRow[] | null | undefined): ScopeRow | undefined {
  return scope?.find((r) => r.id === "traces");
}

export function StatusBar({ model, source, schematic, loading, settings, scope, onReport }: Props) {
  const { t } = useI18n();
  const b = model?.board;
  return (
    <footer className="statusbar">
      {loading && <span className="status-loading">{t("status.loading", { name: loading })}</span>}
      {!loading && b && source && (
        <>
          <span className="status-file" title={source.path ?? source.name}>
            {source.name}
          </span>
          <span className="muted">{b.formatName}</span>
          <span>{formatSize(b.bounds.maxX - b.bounds.minX, b.bounds.maxY - b.bounds.minY, settings.units)}</span>
          <span>{t("status.parts", { n: b.parts.length })}</span>
          <span>{t("status.pins", { n: b.pins.length })}</span>
          <span>{t("status.nets", { n: b.nets.length })}</span>
          {(() => {
            const c = copperChip(scope);
            if (!c) return null;
            const derived = scope?.some((r) => r.state === "derived" || r.state === "estimated");
            return (
              <button className={`link status-scope scope-state-${c.state}`} onClick={onReport} title={t("scope.statusHint")}>
                {t(`scope.status.${c.state}` as MessageKey, { n: c.n ?? 0, m: c.m ?? 0 })}
                {derived && c.state !== "derived" ? ` · ${t("scope.status.reconstructed")}` : ""}
              </button>
            );
          })()}
          {b.warnings.length > 0 && (
            <span className="status-warn" title={b.warnings.join("\n")}>
              {t("status.warnings", { n: b.warnings.length })}
            </span>
          )}
          <button className="link status-report" onClick={onReport} title={t("quality.hint")}>
            {t("quality.button")}
          </button>
        </>
      )}
      {!loading && schematic && (
        <span className="status-file muted" title={schematic.path ?? schematic.name}>
          {t("schematic.title")}: {schematic.name} · {schematic.pageCount} {t("schematic.pages")}
        </span>
      )}
      <span className="status-spacer" />
      <span className="muted">Avero {__APP_VERSION__}</span>
    </footer>
  );
}
