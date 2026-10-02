import { useEffect, useState } from "react";
import { useI18n, type Translate } from "../i18n";
import type { Conditions } from "../workbench/measure";

/** "aus · Akku ab · Rot an Masse · XDM1241" */
export function conditionsText(c: Conditions | undefined, t: Translate): string {
  if (!c) return "";
  return [
    c.revision,
    c.power && t(`cond.power.${c.power}`),
    c.battery !== undefined && t(c.battery ? "cond.battery.on" : "cond.battery.off"),
    c.polarity && t(`cond.polarity.${c.polarity}`),
    c.meter,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The conditions new readings of the reference or a case are taken under. */
export function ConditionsEditor({ value, onChange }: { value: Conditions | undefined; onChange(c: Conditions): void }) {
  const { t } = useI18n();
  const c = value ?? {};
  const [revision, setRevision] = useState(c.revision ?? "");
  const [meter, setMeter] = useState(c.meter ?? "");
  useEffect(() => {
    setRevision(value?.revision ?? "");
    setMeter(value?.meter ?? "");
  }, [value?.revision, value?.meter]);
  const set = (change: Partial<Conditions>) => onChange({ ...c, ...change });

  return (
    <div className="conditions" title={t("cond.hint")}>
      <label>
        <span>{t("cond.power")}</span>
        <select value={c.power ?? ""} onChange={(e) => set({ power: (e.target.value || undefined) as Conditions["power"] })}>
          <option value="">–</option>
          <option value="off">{t("cond.power.off")}</option>
          <option value="standby">{t("cond.power.standby")}</option>
          <option value="on">{t("cond.power.on")}</option>
        </select>
      </label>
      <label>
        <span>{t("cond.battery")}</span>
        <select
          value={c.battery === undefined ? "" : c.battery ? "yes" : "no"}
          onChange={(e) => set({ battery: e.target.value === "" ? undefined : e.target.value === "yes" })}
        >
          <option value="">–</option>
          <option value="yes">{t("cond.battery.on")}</option>
          <option value="no">{t("cond.battery.off")}</option>
        </select>
      </label>
      <label>
        <span>{t("cond.polarity")}</span>
        <select value={c.polarity ?? ""} onChange={(e) => set({ polarity: (e.target.value || undefined) as Conditions["polarity"] })}>
          <option value="">–</option>
          <option value="red-gnd">{t("cond.polarity.red-gnd")}</option>
          <option value="black-gnd">{t("cond.polarity.black-gnd")}</option>
        </select>
      </label>
      <label>
        <span>{t("cond.revision")}</span>
        <input value={revision} placeholder="Rev 2.0" onChange={(e) => setRevision(e.target.value)} onBlur={() => revision !== (c.revision ?? "") && set({ revision: revision.trim() || undefined })} />
      </label>
      <label>
        <span>{t("cond.meter")}</span>
        <input value={meter} placeholder="Owon XDM1241" onChange={(e) => setMeter(e.target.value)} onBlur={() => meter !== (c.meter ?? "") && set({ meter: meter.trim() || undefined })} />
      </label>
    </div>
  );
}
