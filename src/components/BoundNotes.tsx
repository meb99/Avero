import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { addMarker, newMarkerId, removeMarker, setMarkerPhotos, updateMarker, type BoardNotes } from "../workbench/notes";
import { askText } from "./Ask";
import { Thumb } from "./CaseEditor";

interface Props {
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  /** What the notes belong to: a point id ("U7.21", "TP:TP3"), "part:U7" or "net:PP3V3". */
  target: string;
  /** Where a new note goes on the board (the object's place now). */
  at: { x: number; y: number; side: "top" | "bottom" };
  onMessage?(text: string): void;
}

/**
 * Notes and photos that belong to a part, pin or net: they go with it on
 * the board whatever the view, and are listed here with it.
 */
export function BoundNotes({ notes, update, target, at, onMessage }: Props) {
  const { t } = useI18n();
  const mine = (notes.markers ?? []).filter((m) => m.target === target);
  const key = notes.key;
  const change = (f: (n: BoardNotes) => BoardNotes) => update((n) => (n.key === key ? f(n) : n));

  const add = async () => {
    const text = await askText(t("bound.ask"), "", { title: t("bound.title") });
    if (!text?.trim()) return;
    const id = newMarkerId();
    change((n) => addMarker(n, { id, x: at.x, y: at.y, side: at.side, text: text.trim(), target }));
  };

  const addPhoto = async (id: string, photos: string[]) => {
    const picked = await open({
      title: t("case.addPhotos"),
      multiple: true,
      directory: false,
      filters: [{ name: t("case.photos"), extensions: ["jpg", "jpeg", "png", "heic", "webp"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    try {
      const stored: string[] = [];
      for (const path of paths) stored.push(await invoke<string>("import_photo", { key, side: "case", path }));
      change((n) => setMarkerPhotos(n, id, [...photos, ...stored]));
    } catch (e) {
      onMessage?.(String(e));
    }
  };

  return (
    <section className="details-section bound-notes">
      <h3>
        {t("bound.title")} {mine.length > 0 && <span className="muted">{mine.length}</span>}
      </h3>
      {mine.map((m) => (
        <div key={m.id} className="bound-note">
          <input
            className="note-input"
            defaultValue={m.text}
            onBlur={(e) => e.target.value.trim() !== m.text && change((n) => updateMarker(n, m.id, e.target.value.trim()))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <div className="case-photos">
            {(m.photos ?? []).map((file) => (
              <Thumb key={file} file={file} label={t("case.removePhoto")} onRemove={() => change((n) => setMarkerPhotos(n, m.id, (m.photos ?? []).filter((p) => p !== file)))} />
            ))}
            <button className="small" onClick={() => void addPhoto(m.id, m.photos ?? [])}>
              + {t("bound.photo")}
            </button>
            <button className="tool icon-only danger" onClick={() => change((n) => removeMarker(n, m.id))} title={t("bound.delete")} aria-label={t("bound.delete")}>
              ×
            </button>
          </div>
        </div>
      ))}
      <button className="small" onClick={() => void add()}>
        {t("bound.add")}
      </button>
    </section>
  );
}
