import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useI18n } from "../i18n";
import { parseNotes, type BoardNotes } from "../workbench/notes";

/** Earlier states of a board's notes (a snapshot at most every 10 minutes), to look at and bring back. */
export function Versions({ notes, update }: { notes: BoardNotes; update(change: (n: BoardNotes) => BoardNotes): void }) {
  const { t, lang } = useI18n();
  const [stamps, setStamps] = useState<number[] | null>(null);
  const [shown, setShown] = useState<{ stamp: number; notes: BoardNotes } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const when = (s: number) => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(s * 1000));
  const count = (n: BoardNotes) => ({
    cases: n.cases.length,
    readings: Object.keys(n.reference).length + n.cases.reduce((s, c) => s + Object.keys(c.readings).length, 0),
    markers: n.markers?.length ?? 0,
  });

  return (
    <details
      className="wb-section versions"
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open) return;
        invoke<number[]>("note_versions", { key: notes.key }).then(setStamps, (err) => setError(String(err)));
      }}
    >
      <summary>{t("versions.title")}</summary>
      <p className="muted">{t("versions.hint")}</p>
      {error && <p className="wb-error">{error}</p>}
      {stamps?.length === 0 && <p className="muted">{t("versions.none")}</p>}
      <ul className="versions-list">
        {stamps?.map((s) => (
          <li key={s}>
            <button
              className={shown?.stamp === s ? "link on" : "link"}
              onClick={() =>
                invoke<string>("load_note_version", { key: notes.key, stamp: s }).then((json) => {
                  const parsed = parseNotes(json);
                  if (parsed) setShown({ stamp: s, notes: parsed });
                  else setError(t("versions.broken"));
                }, (err) => setError(String(err)))
              }
            >
              {when(s)}
            </button>
            {shown?.stamp === s && (
              <div className="versions-detail">
                <span className="muted">{t("versions.summary", count(shown.notes))}</span>
                <button
                  className="small"
                  onClick={() => {
                    if (!window.confirm(t("versions.restoreAsk", { when: when(s) }))) return;
                    update(() => ({ ...shown.notes, key: notes.key, updated: new Date().toISOString() }));
                  }}
                >
                  {t("versions.restore")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
