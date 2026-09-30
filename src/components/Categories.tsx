import { useId, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  categoryFolder,
  categoryFromFolder,
  guessCategory,
  isCategorized,
  suggestions,
  UNSORTED,
  type Category,
  type TreeNode,
} from "../workbench/catalog";
import { moveLibraryFiles, type LibraryEntry } from "../workbench/library";
import { Dialog } from "./Dialogs";

/** Brand › family › model inputs with suggestions. */
export function CategoryFields({
  value,
  onChange,
  tree,
}: {
  value: Category;
  onChange(c: Category): void;
  tree: TreeNode[];
}) {
  const { t } = useI18n();
  const id = useId();
  const s = useMemo(
    () => suggestions(tree, value.brand, value.family),
    [tree, value.brand, value.family],
  );
  const field = (
    key: keyof Category,
    label: string,
    options: string[],
    placeholder: string,
  ) => (
    <label className="category-field">
      <span className="muted">{label}</span>
      <input
        list={`${id}-${key}`}
        value={value[key]}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
      <datalist id={`${id}-${key}`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </label>
  );
  return (
    <div className="category-fields">
      {field("brand", t("category.brand"), s.brands, "Sony")}
      {field("family", t("category.family"), s.families, "PlayStation")}
      {field("model", t("category.model"), s.models, "PS4")}
    </div>
  );
}

/** Sorts all files of a library entry into Brand › Family › Model. */
export function CategoryDialog({
  entry,
  tree,
  onDone,
}: {
  entry: LibraryEntry;
  tree: TreeNode[];
  onDone(changed: boolean): void;
}) {
  const { t } = useI18n();
  const files = [...entry.boards, ...entry.schematics, ...entry.unsupported];
  const [value, setValue] = useState<Category>(() =>
    isCategorized(entry.folder)
      ? categoryFromFolder(entry.folder)
      : guessCategory([entry.title, entry.folder, ...files.map((f) => f.name)]),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folder = categoryFolder(value);

  const save = async () => {
    setBusy(true);
    try {
      // Keep the board's own folder name below the category, e.g. …/PS4/CUH-1216A.
      const own = isCategorized(entry.folder) ? "" : entry.title;
      await moveLibraryFiles(
        files.map((f) => f.path),
        [folder, own].filter(Boolean).join("/"),
      );
      onDone(true);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("category.title", { name: entry.title })}
      onClose={() => onDone(false)}
      className="category-dialog"
    >
      <p className="muted">{t("category.hint")}</p>
      <CategoryFields value={value} onChange={setValue} tree={tree} />
      {error && <p className="library-warn">{error}</p>}
      <footer className="dialog-footer">
        <button onClick={() => onDone(false)}>{t("photo.cancel")}</button>
        <button
          className="primary"
          disabled={busy || !value.brand.trim()}
          onClick={() => void save()}
        >
          {t("category.save")}
        </button>
      </footer>
    </Dialog>
  );
}

/** Brand › family › model tree; picking a node filters the library. */
export function CategoryTree({
  tree,
  selected,
  total,
  unsorted,
  onSelect,
}: {
  tree: TreeNode[];
  selected: string;
  total: number;
  /** Entries without a category yet. */
  unsorted: number;
  onSelect(path: string): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        selected.split("/").map((_, i, a) => a.slice(0, i + 1).join("/")),
      ),
  );
  const toggle = (path: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => (
      <li key={node.path}>
        <div
          className={`tree-row${selected === node.path ? " active" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {node.children.length > 0 ? (
            <button
              className="tree-twisty"
              onClick={() => toggle(node.path)}
              aria-label={node.name}
            >
              {open.has(node.path) ? "▾" : "▸"}
            </button>
          ) : (
            <span className="tree-twisty" />
          )}
          <button className="tree-name" onClick={() => onSelect(node.path)}>
            {node.name}
          </button>
          <span className="muted tree-count">{node.count}</span>
        </div>
        {open.has(node.path) && node.children.length > 0 && (
          <ul>{render(node.children, depth + 1)}</ul>
        )}
      </li>
    ));
  return (
    <nav className="category-tree" aria-label={t("category.tree")}>
      <ul>
        <li>
          <div className={`tree-row${selected === "" ? " active" : ""}`}>
            <span className="tree-twisty" />
            <button className="tree-name" onClick={() => onSelect("")}>
              {t("category.all")}
            </button>
            <span className="muted tree-count">{total}</span>
          </div>
        </li>
        {render(tree, 0)}
        {unsorted > 0 && (
          <li>
            <div
              className={`tree-row unsorted${selected === UNSORTED ? " active" : ""}`}
            >
              <span className="tree-twisty" />
              <button className="tree-name" onClick={() => onSelect(UNSORTED)}>
                {t("category.unsorted")}
              </button>
              <span className="muted tree-count">{unsorted}</span>
            </div>
          </li>
        )}
      </ul>
    </nav>
  );
}
