import { useState } from "react";
import { useI18n } from "../i18n";
import { renameLibraryFile } from "../workbench/library";
import { Dialog } from "./Dialogs";

export interface RenameTarget {
  title: string;
  /** Full paths of the files to offer for renaming. */
  paths: string[];
}

const baseName = (path: string) => path.split("/").pop() ?? path;

/**
 * Renames library files, e.g. downloads called "download (3).pdf". Only
 * changed names are renamed; the extension stays when it is left out.
 */
export function RenameFiles({ target, onDone }: { target: RenameTarget; onDone(changed: boolean): void }) {
  const { t } = useI18n();
  const [names, setNames] = useState(() => target.paths.map(baseName));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    setBusy(true);
    const failed: string[] = [];
    let changed = false;
    for (const [i, path] of target.paths.entries()) {
      const name = names[i].trim();
      if (!name || name === baseName(path)) continue;
      try {
        await renameLibraryFile(path, name);
        changed = true;
      } catch (e) {
        failed.push(`${baseName(path)}: ${String(e)}`);
      }
    }
    setBusy(false);
    if (failed.length) {
      setErrors(failed);
      if (changed) onDone(true);
      return;
    }
    onDone(changed);
  };

  return (
    <Dialog title={t("rename.title", { name: target.title })} onClose={() => onDone(false)} className="rename-dialog">
      <p className="muted">{t("rename.hint")}</p>
      <div className="rename-list">
        {target.paths.map((path, i) => (
          <label key={path} className="rename-row" title={path}>
            <span className="muted rename-old">{baseName(path)}</span>
            <input
              value={names[i]}
              spellCheck={false}
              autoFocus={i === 0}
              onChange={(e) => setNames((n) => n.map((v, k) => (k === i ? e.target.value : v)))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
          </label>
        ))}
      </div>
      {errors.map((e) => (
        <p key={e} className="library-warn">
          {e}
        </p>
      ))}
      <footer className="dialog-footer">
        <button onClick={() => onDone(false)}>{t("photo.cancel")}</button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {t("rename.save")}
        </button>
      </footer>
    </Dialog>
  );
}
