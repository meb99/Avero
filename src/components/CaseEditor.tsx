import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { saveBytes } from "../core/loader";
import { useI18n } from "../i18n";
import { CASE_STATUSES, caseToReference, updateCase, type BoardNotes, type CaseStatus, type RepairCase } from "../workbench/notes";
import { loadPhotoImage } from "../workbench/photoImage";
import type { ReportTexts } from "../workbench/report";

interface Props {
  notes: BoardNotes;
  repair: RepairCase;
  update(change: (n: BoardNotes) => BoardNotes): void;
  tolerance: number;
  onMessage(message: string | null): void;
}

/** Text input that saves when it loses focus. */
function Field({ label, value, onSave }: { label: string; value: string; onSave(v: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="case-field">
      <span className="muted">{label}</span>
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onSave(text.trim())} />
    </label>
  );
}

/** Small preview of a stored photo. */
function Thumb({ file, onRemove, label }: { file: string; onRemove(): void; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPhotoImage(file)
      .then((canvas) => {
        const scale = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
        const small = document.createElement("canvas");
        small.width = Math.round(canvas.width * scale);
        small.height = Math.round(canvas.height * scale);
        small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
        if (alive) setSrc(small.toDataURL("image/jpeg", 0.8));
      })
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [file]);
  return (
    <figure className="case-photo">
      {src ? <img src={src} alt="" /> : <span className="muted">{src === "" ? "?" : "…"}</span>}
      <button className="tool icon-only" onClick={onRemove} aria-label={label} title={label}>
        ×
      </button>
    </figure>
  );
}

/** Device data, status, photos and actions of one repair case. */
export function CaseEditor({ notes, repair, update, tolerance, onMessage }: Props) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const set = (change: Parameters<typeof updateCase>[2]) => update((n) => updateCase(n, repair.id, change));

  const addPhotos = async () => {
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
      for (const path of paths) stored.push(await invoke<string>("import_photo", { key: notes.key, side: "case", path }));
      update((n) => {
        const c = n.cases.find((x) => x.id === repair.id);
        return updateCase(n, repair.id, { photos: [...(c?.photos ?? []), ...stored] });
      });
    } catch (e) {
      onMessage(String(e));
    }
  };

  const removePhoto = async (file: string) => {
    if (!(await ask(t("case.removePhotoConfirm"), { title: "Avero", kind: "warning" }))) return;
    update((n) => {
      const c = n.cases.find((x) => x.id === repair.id);
      return updateCase(n, repair.id, { photos: (c?.photos ?? []).filter((p) => p !== file) });
    });
    await invoke("remove_photo", { path: file }).catch(() => {});
  };

  const toReference = async () => {
    const count = Object.keys(repair.readings).length;
    const yes = await ask(t("case.toReferenceConfirm", { title: repair.title, n: count }), {
      title: t("case.toReference"),
      kind: "info",
    });
    if (yes) {
      update((n) => caseToReference(n, repair.id));
      onMessage(t("case.toReferenceDone", { n: count }));
    }
  };

  const exportReport = async () => {
    setBusy(true);
    onMessage(null);
    try {
      const { caseReport } = await import("../workbench/report");
      const texts: ReportTexts = {
        title: t("report.title"),
        board: t("measure.board"),
        case: t("measure.case"),
        status: t("case.status"),
        device: t("case.device"),
        serial: t("case.serial"),
        customer: t("case.customer"),
        created: t("case.created"),
        notes: t("report.findings"),
        readings: t("measure.list"),
        net: t("details.net"),
        reference: t("measure.reference"),
        measured: t("report.measured"),
        result: t("report.result"),
        ok: t("report.ok"),
        deviation: t("report.deviation"),
        photos: t("case.photos"),
        footer: t("report.footer"),
      };
      const photos = [];
      for (const file of repair.photos ?? []) {
        try {
          photos.push(await loadPhotoImage(file));
        } catch {
          // A photo that cannot be read is left out of the report.
        }
      }
      const bytes = await caseReport({
        notes,
        repair,
        texts,
        statusText: t(`case.status.${repair.status ?? "open"}`),
        lang,
        tolerance,
        photos,
      });
      const name = `${notes.key}-${repair.title}`.replace(/[/\\:*?"<>|]+/g, "-");
      const path = await saveBytes(bytes, t("case.report"), `${name}.pdf`, { name: "PDF", extensions: ["pdf"] });
      if (path) onMessage(t("case.reportSaved", { path }));
    } catch (e) {
      onMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="case-editor">
      <div className="case-grid">
        <label className="case-field">
          <span className="muted">{t("case.status")}</span>
          <select value={repair.status ?? "open"} onChange={(e) => set({ status: e.target.value as CaseStatus })}>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`case.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <Field label={t("case.device")} value={repair.device ?? ""} onSave={(v) => set({ device: v || undefined })} />
        <Field label={t("case.serial")} value={repair.serial ?? ""} onSave={(v) => set({ serial: v || undefined })} />
        <Field label={t("case.customer")} value={repair.customer ?? ""} onSave={(v) => set({ customer: v || undefined })} />
      </div>

      <div className="case-photos">
        {(repair.photos ?? []).map((file) => (
          <Thumb key={file} file={file} label={t("case.removePhoto")} onRemove={() => void removePhoto(file)} />
        ))}
        <button className="small" onClick={() => void addPhotos()}>
          + {t("case.addPhotos")}
        </button>
      </div>

      <div className="wb-row case-actions">
        <button className="small" onClick={() => void toReference()} title={t("case.toReferenceHint")}>
          {t("case.toReference")}
        </button>
        <button className="small primary" disabled={busy} onClick={() => void exportReport()}>
          {busy ? "…" : t("case.report")}
        </button>
      </div>
    </div>
  );
}

/** All cases of the board with date and status; a click makes one active. */
export function CaseHistory({ notes, onPick }: { notes: BoardNotes; onPick(id: string): void }) {
  const { t, lang } = useI18n();
  if (notes.cases.length < 2) return null;
  const date = (iso: string) => new Intl.DateTimeFormat(lang, { dateStyle: "short" }).format(new Date(iso));
  return (
    <ul className="case-history">
      {[...notes.cases].reverse().map((c) => (
        <li key={c.id}>
          <button className={`link${c.id === notes.activeCase ? " current" : ""}`} onClick={() => onPick(c.id)}>
            {c.title}
          </button>
          <span className={`case-status status-${c.status ?? "open"}`}>{t(`case.status.${c.status ?? "open"}`)}</span>
          <span className="muted">{date(c.created)}</span>
        </li>
      ))}
    </ul>
  );
}
