import type { BoardModel } from "../core/board";
import type { BoardSource } from "../core/loader";
import type { SchematicDocument } from "../schematic/document";
import { formatSize } from "../format";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";

interface Props {
  model: BoardModel | null;
  source: BoardSource | null;
  schematic: SchematicDocument | null;
  loading: string | null;
  settings: Settings;
}

export function StatusBar({ model, source, schematic, loading, settings }: Props) {
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
          {b.warnings.length > 0 && (
            <span className="status-warn" title={b.warnings.join("\n")}>
              {t("status.warnings", { n: b.warnings.length })}
            </span>
          )}
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
