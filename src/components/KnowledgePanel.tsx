import { useMemo, useState, type ReactNode } from "react";
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import type { KnowledgeBase, KnowledgePage } from "../knowledge/store";
import { pagesForBoard, relatedPages, searchKnowledge } from "../knowledge/store";
import { measurementPictures, pageUrl, textPieces, type Block, type GalleryItem } from "../knowledge/wikitext";
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
  /** OpenBoardData ID in use for the board in view. */
  boardObdata?: string | null;
  /** OpenBoardData ID chosen by hand for the board in view. */
  chosenObdata?: string | null;
  /** Uses an OpenBoardData board for the board in view; null matches by board number again. */
  onChooseObdata?(id: string | null): void;
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

const WEB_ADDRESS = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/;

/** Short form of a long address: host and the end of the path. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 24 ? `…${u.pathname.slice(-20)}` : u.pathname;
    return u.hostname.replace(/^www\./, "") + (path === "/" ? "" : path);
  } catch {
    return url;
  }
}

interface TextProps {
  text: string;
  model: BoardModel;
  onSelect: Props["onSelect"];
  onLink(target: string): void;
}

/** Block text: links and web addresses open, net and part names select. */
function RichText({ text, model, onSelect, onLink }: TextProps) {
  return (
    <>
      {textPieces(text).flatMap((piece, i) => {
        if ("target" in piece)
          return [
            <button key={i} className="link kb-link" title={piece.target.replace(/^wiki:/, "")} onClick={() => onLink(piece.target)}>
              {piece.text}
            </button>,
          ];
        return piece.text.split(WEB_ADDRESS).map((part, j) =>
          j % 2 === 1 ? (
            <button key={`${i}.${j}`} className="link kb-link" title={part} onClick={() => onLink(part)}>
              {shortUrl(part)}
            </button>
          ) : (
            <Linked key={`${i}.${j}`} text={part} model={model} onSelect={onSelect} />
          ),
        );
      })}
    </>
  );
}

/** Pictures on the wiki; shown when the wiki lets them load, else as captions. */
function Gallery({ items, base, onLink }: { items: GalleryItem[]; base: string; onLink(target: string): void }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  return (
    <div className="kb-gallery">
      {items.map((item) => {
        const caption = item.caption || item.file.replace(/\.\w+$/, "");
        const src = `${base}Special:FilePath/${encodeURIComponent(item.file.replace(/ /g, "_"))}?width=480`;
        return (
          <button key={item.file} className="kb-picture" title={item.file} onClick={() => onLink(`wiki:File:${item.file}`)}>
            {!failed.has(item.file) && (
              <img src={src} alt="" loading="lazy" onError={() => setFailed((s) => new Set(s).add(item.file))} />
            )}
            <span>{caption}</span>
          </button>
        );
      })}
    </div>
  );
}

function BlockView({ block, model, onSelect, onLink, base }: Omit<TextProps, "text"> & { block: Block; base: string }) {
  const linked = (text: string) => <RichText text={text} model={model} onSelect={onSelect} onLink={onLink} />;
  switch (block.type) {
    case "heading":
      return block.level <= 2 ? <h3>{block.text}</h3> : <h4>{block.text}</h4>;
    case "paragraph":
      return <p>{linked(block.text)}</p>;
    case "note":
      return <p className={`kb-note kb-${block.kind}`}>{linked(block.text)}</p>;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} style={block.levels && block.levels[i] > 1 ? { marginLeft: (block.levels[i] - 1) * 16 } : undefined}>
          {linked(item)}
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <div className="kb-table-wrap">
          <table className="kb-table">
            {block.caption && <caption>{block.caption}</caption>}
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
    case "gallery":
      return <Gallery items={block.items} base={base} onLink={onLink} />;
  }
}

const measurementCounts = new WeakMap<KnowledgePage, number>();
/** Number of reference measurement pictures of a page, cached per page. */
function measurements(page: KnowledgePage): number {
  let n = measurementCounts.get(page);
  if (n === undefined) measurementCounts.set(page, (n = measurementPictures(page).length));
  return n;
}

/** The "Knowledge" tab: wiki pages for the board in view, search, import. */
export function KnowledgePanel(p: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<KnowledgePage | null>(null);
  const forBoard = useMemo(() => pagesForBoard(p.base, p.device, p.boardNumbers), [p.base, p.device, p.boardNumbers]);
  const related = useMemo(() => relatedPages(p.base, p.device, forBoard), [p.base, p.device, forBoard]);
  const found = useMemo(() => (query.trim() ? searchKnowledge(p.base, query) : null), [p.base, query]);
  const deviceName = [p.device.brand, p.device.family, p.device.model].filter(Boolean).join(" › ");

  if (open) {
    // Wiki address of the open page ("https://repair.wiki/w/").
    const base = open.url.replace(/[^/]*$/, "");
    const onLink = (target: string) => {
      // OpenBoardData notes point at nets and pins of the board.
      if (target.startsWith("net:")) {
        const net = p.model.findNet(target.slice(4));
        if (net !== undefined) p.onSelect({ kind: "net", net }, true);
        return;
      }
      if (target.startsWith("part:")) {
        const [, name, pinNumber] = target.split(":");
        const part = p.model.findPart(name);
        if (part === undefined) return;
        const info = p.model.parts[part];
        const pin = pinNumber
          ? p.model.pins.slice(info.firstPin, info.firstPin + info.pinCount).findIndex((x) => x.number === pinNumber)
          : -1;
        p.onSelect(pin >= 0 ? { kind: "pin", pin: info.firstPin + pin } : { kind: "part", part }, true);
        return;
      }
      const title = target.startsWith("wiki:") ? target.slice(5) : target.startsWith(base) ? decodeURIComponent(target.slice(base.length)).replace(/_/g, " ") : null;
      if (title === null) return p.onOpenUrl(target);
      // Pages already in Avero open here, others on the wiki.
      const [name, anchor] = title.split("#");
      const known = p.base.pages.find((k) => k.source === open.source && k.title.toLowerCase() === name.trim().toLowerCase());
      if (known) setOpen(known);
      else p.onOpenUrl(pageUrl(name.trim(), base) + (anchor ? `#${anchor.replace(/ /g, "_")}` : ""));
    };
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
        {open.obdata && p.onChooseObdata && (
          <div className="kb-obd-bar">
            {p.boardObdata === open.obdata.id ? (
              <>
                <span className="muted">{t("obd.inUse")}</span>
                {p.chosenObdata === open.obdata.id && (
                  <button className="small" onClick={() => p.onChooseObdata!(null)}>
                    {t("obd.unchoose")}
                  </button>
                )}
              </>
            ) : (
              <>
                {p.boardObdata && <span className="muted">{t("obd.otherInUse", { id: p.boardObdata })}</span>}
                <button className="small" onClick={() => p.onChooseObdata!(open.obdata!.id)}>
                  {t("obd.choose")}
                </button>
              </>
            )}
          </div>
        )}
        {open.device.brand && (
          <p className="muted">{[open.device.brand, open.device.family, open.device.model].filter(Boolean).join(" › ")}</p>
        )}
        {open.blocks.map((b, i) => (
          <BlockView key={i} block={b} model={p.model} onSelect={p.onSelect} onLink={onLink} base={base} />
        ))}
        <p className="kb-source muted">
          {t("kb.source", { source: open.source, license: open.license || "–" })}
          {open.edited && ` · ${new Date(open.edited).toLocaleDateString()}`}
        </p>
        {open.builtin ? (
          <p className="muted">{t("kb.builtinNote")}</p>
        ) : (
          <button
            className="small danger"
            onClick={() => {
              p.onRemove(open);
              setOpen(null);
            }}
          >
            {t("kb.remove")}
          </button>
        )}
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
            {page.builtin && <span className="kb-badge">{t("kb.reference")}</span>}
            {!page.builtin && measurements(page) > 0 && (
              <span className="kb-badge">{t("kb.measurements", { n: measurements(page) })}</span>
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
      {found ? (
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
          {related.length > 0 && (
            <details className="kb-related">
              <summary>{t("kb.related", { n: related.length })}</summary>
              {list(related)}
            </details>
          )}
        </>
      )}
      {!found && !p.base.pages.some((page) => !page.builtin) && (
        <div className="kb-empty">
          <p>{t("kb.emptyTitle")}</p>
          <ol>
            <li>{t("kb.step1")}</li>
            <li>{t("kb.step2")}</li>
            <li>{t("kb.step3")}</li>
          </ol>
          <button className="small" onClick={() => p.onOpenUrl("https://repair.wiki/w/Special:Export")}>
            {t("kb.openExport")}
          </button>{" "}
          <button className="small" onClick={() => p.onOpenUrl("https://openboarddata.org")}>
            {t("obd.open")}
          </button>
        </div>
      )}
    </div>
  );
}
