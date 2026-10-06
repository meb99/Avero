import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { OwnPart, OwnPin } from "../workbench/notes";

interface Field<T> {
  key: keyof T & string;
  label: MessageKey;
  placeholder?: string;
}

const PART_FIELDS: Field<OwnPart>[] = [
  { key: "value", label: "own.value", placeholder: "10µF 6.3V" },
  { key: "package", label: "own.package", placeholder: "0402" },
  { key: "function", label: "own.function", placeholder: "VCORE buck" },
  { key: "note", label: "own.note" },
  { key: "source", label: "own.source", placeholder: "Schaltplan S. 34" },
];

const PIN_FIELDS: Field<OwnPin>[] = [
  { key: "label", label: "own.pinLabel", placeholder: "VIN, EN, PGOOD" },
  { key: "note", label: "own.note" },
  { key: "source", label: "own.source", placeholder: "Datenblatt S. 3" },
];

/**
 * Own facts laid over the file's: shown as such ("own entry", with the
 * source), edited in place, and removed with one click so the file's
 * data shows again. The file's data itself is never changed.
 */
function OwnInfo<T extends object>({
  fields,
  info,
  onSave,
  title,
}: {
  fields: Field<T>[];
  info: T | undefined;
  onSave(info: T | undefined): void;
  title: string;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setEditing(false);
  }, [info]);
  const start = () => {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, ((info as Record<string, string> | undefined)?.[f.key] ?? "") as string])));
    setEditing(true);
  };
  const shown = fields.filter((f) => (info as Record<string, string> | undefined)?.[f.key]);

  return (
    <section className="details-section own-info">
      <h3>
        {title} {shown.length > 0 && <span className="src-tag src-own">{t("own.tag")}</span>}
      </h3>
      {!editing && shown.length > 0 && (
        <dl className="props">
          {shown.map((f) => (
            <div key={f.key} className="own-row">
              <dt>{t(f.label)}</dt>
              <dd>{(info as Record<string, string>)[f.key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {editing ? (
        <form
          className="own-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft as T);
            setEditing(false);
          }}
        >
          {fields.map((f) => (
            <label key={f.key}>
              <span>{t(f.label)}</span>
              <input value={draft[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
            </label>
          ))}
          <div className="wb-row">
            <button type="submit" className="small primary">
              {t("own.save")}
            </button>
            <button type="button" className="small" onClick={() => setEditing(false)}>
              {t("own.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="wb-row">
          <button className="small" onClick={start}>
            {shown.length ? t("own.edit") : t("own.add")}
          </button>
          {shown.length > 0 && (
            <button className="small" onClick={() => onSave(undefined)} title={t("own.resetHint")}>
              {t("own.reset")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function OwnPartInfo({ info, onSave }: { info: OwnPart | undefined; onSave(info: OwnPart | undefined): void }) {
  const { t } = useI18n();
  return <OwnInfo fields={PART_FIELDS} info={info} onSave={onSave} title={t("own.partTitle")} />;
}

export function OwnPinInfo({ info, onSave }: { info: OwnPin | undefined; onSave(info: OwnPin | undefined): void }) {
  const { t } = useI18n();
  return <OwnInfo fields={PIN_FIELDS} info={info} onSave={onSave} title={t("own.pinTitle")} />;
}
