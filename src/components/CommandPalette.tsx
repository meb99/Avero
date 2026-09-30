import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardModel } from "../core/board";
import { matchCommands, type Command } from "../core/commands";
import { search } from "../core/search";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { ChipIcon, NetIcon, PinIcon, SearchIcon } from "./Icons";

interface Props {
  commands: Command[];
  model: BoardModel | null;
  /** Text the search starts with, e.g. to offer only the compare commands. */
  initialQuery?: string;
  onPick(selection: Selection): void;
  onClose(): void;
}

type Row =
  | { kind: "command"; command: Command }
  | { kind: "part" | "net" | "pin"; label: string; detail: string; selection: Selection };

/** ⌘K: every command and every part, net and pin of the board in one list. */
export function CommandPalette({ commands, model, initialQuery = "", onPick, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const rows = useMemo<Row[]>(() => {
    const cmds: Row[] = matchCommands(commands, query).map((command) => ({ kind: "command", command }));
    const board: Row[] =
      model && query.trim()
        ? search(model, query, 30).map((r) => ({
            kind: r.kind,
            label: r.label,
            detail: r.kind === "net" ? t("search.pins", { n: Number(r.detail) }) : r.detail,
            selection: r.selection,
          }))
        : [];
    // An exact part or net name beats a command that merely contains it.
    return board.length > 0 && board[0].kind !== "command" && board[0].label.toUpperCase() === query.trim().toUpperCase()
      ? [...board, ...cmds]
      : [...cmds, ...board];
  }, [commands, model, query, t]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === "command") row.command.run();
    else onPick(row.selection);
  };

  const icon = (kind: Row["kind"]) =>
    kind === "part" ? <ChipIcon size={15} /> : kind === "net" ? <NetIcon size={15} /> : kind === "pin" ? <PinIcon size={15} /> : null;

  return (
    <dialog
      ref={ref}
      className="palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="palette-input">
        <SearchIcon />
        <input
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder={t(model ? "palette.placeholderBoard" : "palette.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(rows[active]);
            }
          }}
          aria-label={t("menu.palette")}
        />
      </div>
      <ul className="palette-list" ref={listRef} role="listbox">
        {rows.length === 0 && <li className="search-empty">{t("search.none")}</li>}
        {rows.map((row, i) => (
          <li
            key={row.kind === "command" ? row.command.id : `${row.kind}-${row.label}-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            className={i === active ? "active" : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              run(row);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {row.kind === "command" ? (
              <>
                <span className="palette-label">{row.command.label}</span>
                {row.command.shortcut && <kbd>{row.command.shortcut}</kbd>}
              </>
            ) : (
              <>
                <span className={`search-kind kind-${row.kind}`}>{icon(row.kind)}</span>
                <span className="palette-label">{row.label}</span>
                <span className="search-detail">{row.detail}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
