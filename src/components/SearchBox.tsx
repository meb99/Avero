import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { BoardModel } from "../core/board";
import { search, type SearchResult } from "../core/search";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { ChipIcon, NetIcon, PinIcon, SearchIcon } from "./Icons";

interface Props {
  model: BoardModel;
  onPick(selection: Selection): void;
  inputRef?: Ref<HTMLInputElement>;
}

export function SearchBox({ model, onPick, inputRef }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const results = useMemo(() => search(model, query, 60), [model, query]);

  useEffect(() => setActive(0), [query, model]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (r: SearchResult | undefined) => {
    if (!r) return;
    onPick(r.selection);
    setOpen(false);
    // Hand the keyboard back to the board so shortcuts work right away.
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const icon = (kind: SearchResult["kind"]) =>
    kind === "part" ? <ChipIcon size={15} /> : kind === "net" ? <NetIcon size={15} /> : <PinIcon size={15} />;

  return (
    <div className="search">
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        spellCheck={false}
        autoComplete="off"
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (results.length === 0) setOpen(false);
            else pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={t("search.placeholder")}
      />
      {open && query.trim() && (
        <ul className={`search-results${results.length === 0 ? " empty" : ""}`} ref={listRef} role="listbox">
          {results.length === 0 && <li className="search-empty">{t("search.none")}</li>}
          {results.map((r, i) => (
            <li
              key={`${r.kind}-${r.label}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={`search-kind kind-${r.kind}`}>{icon(r.kind)}</span>
              <span className="search-label">{r.label}</span>
              <span className="search-detail">
                {r.kind === "net" ? t("search.pins", { n: Number(r.detail) }) : r.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
