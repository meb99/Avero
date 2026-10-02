import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import type { SchematicDocument } from "../schematic/document";
import { SchematicView, type SchematicViewHandle } from "../schematic/SchematicView";
import type { Datasheet } from "../workbench/datasheets";

/** A datasheet beside the board, with its remembered pages one click away. */
export function DatasheetPane({
  doc,
  sheet,
  page,
  scroll,
  onRemember,
  onClose,
}: {
  doc: SchematicDocument;
  sheet: Datasheet;
  /** Page to show first (0-based). */
  page: number;
  scroll: "pan" | "zoom";
  onRemember(page: number, label: string): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const view = useRef<SchematicViewHandle>(null);
  useEffect(() => {
    // After the document has shown its first page.
    const timer = window.setTimeout(() => view.current?.goToPage(page), 120);
    return () => window.clearTimeout(timer);
  }, [doc, page]);
  return (
    <div className="datasheet-pane">
      <header className="compare-bar">
        <span className="compare-name" title={sheet.file}>
          {t("sheet.title")}: <strong>{sheet.title}</strong>
        </span>
        {sheet.pages.map((p) => (
          <button key={`${p.label}${p.page}`} className="small" onClick={() => view.current?.goToPage(p.page)} title={t("sheet.pageN", { n: p.page + 1 })}>
            {p.label}
          </button>
        ))}
        <button
          className="small"
          title={t("sheet.rememberHint")}
          onClick={() => {
            const at = view.current?.currentPage() ?? 0;
            const label = window.prompt(t("sheet.rememberAsk", { n: at + 1 }), t("sheet.pinout"));
            if (label?.trim()) onRemember(at, label.trim());
          }}
        >
          + {t("sheet.remember")}
        </button>
      </header>
      <SchematicView ref={view} doc={doc} focus={null} scroll={scroll} classify={() => null} onPick={() => {}} onClose={onClose} />
    </div>
  );
}
