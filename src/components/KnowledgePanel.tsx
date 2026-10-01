import { useMemo, useState, type ReactNode } from "react";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import type { KnowledgeBase, KnowledgePage } from "../knowledge/store";
import { pagesForBoard, searchKnowledge } from "../knowledge/store";
import type { Block } from "../knowledge/wikitext";
import type { Category } from "../workbench/catalog";

interface Props {
  model: BoardModel;
  base: KnowledgeBase;
  /** Device of the board in view. */
  device: Category;
  /** Board numbers of the open file (EDM-020, 820-02100). */
  boardNumbers: string[];
  busy: boolean;
  message: string | null;
  onImport(): void;
  onRemove(page: KnowledgePage): void;
  onOpenUrl(url: string): void;
  onSelect(selection: Selection, zoom: boolean): void;
}

const TOKEN = /([A-Za-z0-9_+./-]{2,})/;

/** Text in which net and part names of the open board are clickable. */
function Linked({ text, model, onSelect }: { text: string; model: BoardModel; onSelect: Props["onSelect"] }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((piece, i) => {
        if (i % 2 === 0 || !/[A-Za-z]/.test(piece)) return piece;
        const word = piece.replace(/[.,;:]+$/, "");
        const rest = piece.slice(word.length);
        const net = word.length >= 3 ? model.findNet(word) : undefined;
        if (net !== undefined && model.nets[net].kind !== "unconnected")
          return (
            <span key={i}>
              <button className={`link net-chip kind-${model.nets[net].kind}`} onClick={() => onSelect({ kind: "net", net }, true)}>
                {word}
              </button>
              {rest}
            </span>
          );
        const part = model.findPart(word);
        if (part !== undefined && /\d/.test(word))
          return (
            <span key={i}>
              <button className="link part-name" onClick={() => onSelect({ kind: "part", part }, true)}>
                {word}
              </button>
              {rest}
            </span>
          );
        return piece;
      })}
    </>
  );
}

function BlockView({ block, model, onSelect }: { block: Block; model: BoardModel; onSelect: Props["onSelect"] }) {
  const linked = (text: string) => <Linked text={text} model={model} onSelect={onSelect} />;
  switch (block.type) {
    case "heading":
      return block.level <= 2 ? <h3>{block.text}</h3> : <h4>{block.text}</h4>;
    case "paragraph":
      return <p>{linked(block.text)}</p>;
    case "note":
      return <p className={`kb-note kb-${block.kind}`}>{linked(block.text)}</p>;
    case "list": {
      const items = block.items.map((item, i) => <li key={i}>{linked(item)}</li>);
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <div className="kb-table-wrap">
          <table className="kb-table">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) =>
                    block.header && r === 0 ? <th key={c}>{cell}</th> : <td key={c}>{linked(cell)}</td>,
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** The "Knowledge" tab: wiki pages for the board in view, search, import. */
export function KnowledgePanel(p: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<KnowledgePage | null>(null);
  const forBoard = useMemo(() => pagesForBoard(p.base, p.device, p.boardNumbers), [p.base, p.device, p.boardNumbers]);
  const found = useMemo(() => (query.trim() ? searchKnowledge(p.base, query) : null), [p.base, query]);
  const deviceName = [p.device.brand, p.device.family, p.device.model].filter(Boolean).join(" › ");

  if (open) {
    return (
      <div className="kb-page">
        <div className="kb-page-bar">
          <button className="small" onClick={() => setOpen(null)}>
            ← {t("kb.back")}
          </button>
          <button className="small" onClick={() => p.onOpenUrl(open.url)}>
            {t("kb.openOriginal")}
          </button>
        </div>
        <h2>{open.title}</h2>
        {open.device.brand && (
          <p className="muted">{[open.device.brand, open.device.family, open.device.model].filter(Boolean).join(" › ")}</p>
        )}
        {open.blocks.map((b, i) => (
          <BlockView key={i} block={b} model={p.model} onSelect={p.onSelect} />
        ))}
        <p className="kb-source muted">
          {t("kb.source", { source: open.source, license: open.license || "–" })}
          {open.edited && ` · ${new Date(open.edited).toLocaleDateString()}`}
        </p>
        <button
          className="small danger"
          onClick={() => {
            p.onRemove(open);
            setOpen(null);
          }}
        >
          {t("kb.remove")}
        </button>
      </div>
    );
  }

  const list = (pages: KnowledgePage[]): ReactNode =>
    pages.length === 0 ? null : (
      <ul className="kb-list">
        {pages.map((page) => (
          <li key={`${page.source}:${page.title}`}>
            <button className="link" onClick={() => setOpen(page)}>
              {page.title}
            </button>
            {page.device.brand && (
              <span className="muted"> {[page.device.family, page.device.model].filter(Boolean).join(" ")}</span>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="kb">
      <div className="kb-bar">
        <input type="search" placeholder={t("kb.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="small" disabled={p.busy} onClick={p.onImport}>
          {p.busy ? "…" : t("kb.import")}
        </button>
      </div>
      {p.message && <p className="muted">{p.message}</p>}
      {p.base.pages.length === 0 ? (
        <div className="kb-empty">
          <p>{t("kb.emptyTitle")}</p>
          <ol>
            <li>{t("kb.step1")}</li>
            <li>{t("kb.step2")}</li>
            <li>{t("kb.step3")}</li>
          </ol>
          <button className="small" onClick={() => p.onOpenUrl("https://repair.wiki/w/Special:Export")}>
            {t("kb.openExport")}
          </button>
        </div>
      ) : found ? (
        <>
          <h3>{t("kb.results", { n: found.length })}</h3>
          {list(found)}
        </>
      ) : (
        <>
          <h3>
            {t("kb.forBoard")} {deviceName && <span className="muted">{deviceName}</span>}
          </h3>
          {forBoard.length ? list(forBoard) : <p className="muted">{t("kb.noneForBoard", { n: p.base.pages.length })}</p>}
        </>
      )}
    </div>
  );
}
