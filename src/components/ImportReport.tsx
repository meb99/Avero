import type { BoardModel } from "../core/board";
import type { BoardSource } from "../core/loader";
import { importQuality, type QualityCheck } from "../core/quality";
import { useI18n, type MessageKey } from "../i18n";
import { Dialog } from "./Dialogs";

const MARK: Record<QualityCheck["level"], string> = { ok: "✓", info: "ℹ", warn: "⚠" };

/** What came over from the board file, what was estimated and what is missing. */
export function ImportReport({ model, source, onClose }: { model: BoardModel; source: BoardSource | null; onClose(): void }) {
  const { t } = useI18n();
  const b = model.board;
  const checks = importQuality(model);
  const warn = checks.filter((c) => c.level === "warn").length;
  return (
    <Dialog title={t("quality.title")} onClose={onClose} className="report-dialog">
      <p>
        <strong>{source?.name}</strong> <span className="muted">· {b.formatName}</span>
      </p>
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
