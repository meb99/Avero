import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { findDuplicates, revealInFinder, trashLibraryFiles, type DuplicateGroup } from "../workbench/library";
import { Dialog } from "./Dialogs";
import { OpenIcon } from "./Icons";

interface Props {
  /** Avero's own library folder; only files in it can be removed. */
  root: string;
  folders: string[];
  onDone(changed: boolean): void;
}

function formatSize(bytes: number, lang: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: u === 0 ? 0 : 1 }).format(v)} ${units[u]}`;
}

/**
 * Finds files that are in the library more than once with the same content
 * and moves the extra copies to the Trash. The oldest copy stays by default;
 * files in folders that are only linked into the library are never touched.
 */
export function DuplicatesDialog({ root, folders, onDone }: Props) {
  const { t, lang } = useI18n();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const own = (path: string) => path.startsWith(`${root}/`);

  useEffect(() => {
    let alive = true;
    findDuplicates([root, ...folders])
      .then((found) => {
        if (!alive) return;
        setGroups(found);
        // Keep the oldest copy, preferably one in the own library; select the rest.
        const pick = new Set<string>();
        for (const g of found) {
          const keep = g.files.find((f) => own(f.path)) ?? g.files[0];
          for (const f of g.files) if (f !== keep && own(f.path)) pick.add(f.path);
        }
        setSelected(pick);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [root, folders]);

  const wasted = useMemo(
    () => (groups ?? []).reduce((sum, g) => sum + g.size * g.files.filter((f) => selected.has(f.path)).length, 0),
    [groups, selected],
  );

  const toggle = (path: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const remove = async () => {
    const paths = [...selected];
    // Never all copies of one file.
    const emptied = (groups ?? []).find((g) => g.files.every((f) => selected.has(f.path)));
    if (emptied) {
      setError(t("dupes.keepOne", { name: emptied.files[0].name }));
      return;
    }
    if (!(await ask(t("dupes.confirm", { n: paths.length }), { title: "Avero", kind: "warning" }))) return;
    setBusy(true);
    try {
      await trashLibraryFiles(paths);
      onDone(true);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("dupes.title")} onClose={() => onDone(false)} className="dupes-dialog">
      {error && <p className="library-warn">{error}</p>}
      {groups === null && !error && <p className="muted">{t("dupes.searching")}</p>}
      {groups && groups.length === 0 && <p className="library-empty">{t("dupes.none")}</p>}
      {groups && groups.length > 0 && (
        <>
          <p className="muted">{t("dupes.summary", { groups: groups.length, size: formatSize(wasted, lang) })}</p>
          <div className="dupes-list">
            {groups.map((g) => (
              <section key={g.files[0].path} className="dupes-group">
                <h3>
                  {g.files[0].name} <span className="muted">{formatSize(g.size, lang)}</span>
                </h3>
                <ul>
                  {g.files.map((f) => (
                    <li key={f.path} className={selected.has(f.path) ? "remove" : undefined}>
                      <label className="check" title={own(f.path) ? undefined : t("dupes.linked")}>
                        <input
                          type="checkbox"
                          disabled={!own(f.path)}
                          checked={selected.has(f.path)}
                          onChange={() => toggle(f.path)}
                        />
                        <span className="dupes-path">{own(f.path) ? f.path.slice(root.length + 1) : f.path}</span>
                      </label>
                      <span className="muted">
                        {new Intl.DateTimeFormat(lang, { dateStyle: "short" }).format(new Date(f.modified * 1000))}
                      </span>
                      <button
                        className="tool icon-only"
                        onClick={() => void revealInFinder(f.path)}
                        aria-label={t("library.reveal")}
                        title={t("library.reveal")}
                      >
                        <OpenIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <footer className="dialog-footer">
            <span className="muted">{t("dupes.hint")}</span>
            <button onClick={() => onDone(false)}>{t("photo.cancel")}</button>
            <button className="primary" disabled={busy || selected.size === 0} onClick={() => void remove()}>
              {t("dupes.remove", { n: selected.size })}
            </button>
          </footer>
        </>
      )}
    </Dialog>
  );
}
