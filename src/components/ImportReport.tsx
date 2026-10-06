import type { BoardModel } from "../core/board";
import type { BoardSource } from "../core/loader";
import { importQuality, type QualityCheck } from "../core/quality";
import { useI18n, type MessageKey } from "../i18n";
import { Dialog } from "./Dialogs";
import type { ScopeRow, ScopeState } from "../core/dataScope";

const MARK: Record<QualityCheck["level"], string> = { ok: "✓", info: "ℹ", warn: "⚠" };

const STATE_MARK: Record<ScopeState, string> = {
  yes: "✓",
  none: "–",
  hidden: "◌",
  derived: "↻",
  estimated: "≈",
  text: "Aa",
  manual: "✎",
  notRead: "✗",
  empty: "○",
};

/** What the board's data holds and where each part comes from. */
export function DataScope({ rows }: { rows: ScopeRow[] }) {
  const { t } = useI18n();
  return (
    <table className="scope-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={`scope-${r.state}`}>
            <th scope="row">{t(`scope.${r.id}` as MessageKey)}</th>
            <td>
              <span className={`scope-state scope-state-${r.state}`} title={t(`scope.stateHint.${r.state}` as MessageKey)}>
                {STATE_MARK[r.state]} {t(`scope.state.${r.state}` as MessageKey)}
              </span>
            </td>
            <td className="scope-detail">
              {t(`scope.detail.${r.id}.${r.state}` as MessageKey, { n: r.n ?? 0, m: r.m ?? 0 })}
              {r.how && <span className="muted"> – {r.how}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What came over from the board file, what was estimated and what is missing. */
export function ImportReport({ model, source, scope, onClose }: { model: BoardModel; source: BoardSource | null; scope: ScopeRow[]; onClose(): void }) {
  const { t } = useI18n();
  const b = model.board;
  const checks = importQuality(model);
  const warn = checks.filter((c) => c.level === "warn").length;
  return (
    <Dialog title={t("quality.title")} onClose={onClose} className="report-dialog">
      <p>
        <strong>{source?.name}</strong> <span className="muted">· {b.formatName}</span>
      </p>
      <h3>{t("scope.title")}</h3>
      <DataScope rows={scope} />
      <h3>{t("quality.checks")}</h3>
      <p className={warn ? "kb-note kb-warning" : "muted"}>{warn ? t("quality.summaryWarn", { n: warn }) : t("quality.summaryOk")}</p>
      <dl className="props quality-counts">
        <dt>{t("quality.count.parts")}</dt>
        <dd>{b.parts.length}</dd>
        <dt>{t("quality.count.pins")}</dt>
        <dd>{b.pins.length}</dd>
        <dt>{t("quality.count.nets")}</dt>
        <dd>{b.nets.length}</dd>
        <dt>{t("quality.count.testPoints")}</dt>
        <dd>{b.testPoints.length}</dd>
        <dt>{t("quality.count.traces")}</dt>
        <dd>{b.traces?.length ?? 0}</dd>
        <dt>{t("quality.count.layers")}</dt>
        <dd>{b.layers?.length ?? 0}</dd>
      </dl>
      <ul className="quality-list">
        {checks.map((c) => (
          <li key={c.id} className={`quality-${c.level}`}>
            <span className="quality-mark">{MARK[c.level]}</span>
            <span>
              {t(`quality.${c.id}` as MessageKey, { n: c.n ?? 0, m: c.m ?? 0 })}
              {c.examples && c.examples.length > 0 && <span className="muted mono"> – {c.examples.join(", ")}</span>}
            </span>
          </li>
        ))}
      </ul>
      {b.warnings.length > 0 && (
        <>
          <h3>{t("quality.parser")}</h3>
          <ul className="quality-list">
            {b.warnings.map((w, i) => (
              <li key={i} className="quality-info">
                <span className="quality-mark">ℹ</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
