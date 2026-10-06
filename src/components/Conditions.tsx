import { useEffect, useState } from "react";
import { useI18n, type Translate } from "../i18n";
import type { Conditions } from "../workbench/measure";
import { askText } from "./Ask";

/** "aus · Akku ab · Rot an Masse · U7000 ab · 24 °C · XDM1241" */
export function conditionsText(c: Conditions | undefined, t: Translate): string {
  if (!c) return "";
  return [
    c.revision,
    c.power && t(`cond.power.${c.power}`),
    c.battery !== undefined && t(c.battery ? "cond.battery.on" : "cond.battery.off"),
    c.polarity && t(`cond.polarity.${c.polarity}`),
    c.assembly && (c.assembly !== "complete" && c.removed ? t("cond.removedParts", { parts: c.removed }) : t(`cond.assembly.${c.assembly}`)),
    c.temperature !== undefined && `${c.temperature} °C`,
    c.modules && t("cond.modulesText", { modules: c.modules }),
    c.range && t("cond.rangeText", { range: c.range }),
    c.leadsNulled !== undefined && t(c.leadsNulled ? "cond.leads.nulled" : "cond.leads.raw"),
    c.meter,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A personal measuring setup, saved by name (meter, polarity, range …). */
export interface ConditionProfile {
  name: string;
  conditions: Conditions;
}

const PROFILES_KEY = "avero.conditionProfiles.v1";

export function loadProfiles(): ConditionProfile[] {
  try {
    const v = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? "[]") as unknown;
    return Array.isArray(v)
      ? v.filter((p): p is ConditionProfile => !!p && typeof p.name === "string" && !!p.conditions && typeof p.conditions === "object")
      : [];
  } catch {
    return [];
  }
}

function saveProfiles(list: ConditionProfile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  } catch {
    // Only a convenience.
  }
}

/** A field typed in full before it is stored (not on every key). */
function TextField({ label, value, placeholder, onDone }: { label: string; value: string | undefined; placeholder: string; onDone(v: string | undefined): void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  return (
    <label>
      <span>{label}</span>
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== (value ?? "") && onDone(text.trim() || undefined)} />
    </label>
  );
}

/** The conditions new readings of the reference or a case are taken under. Empty fields stay unknown. */
export function ConditionsEditor({ value, onChange }: { value: Conditions | undefined; onChange(c: Conditions): void }) {
  const { t } = useI18n();
  const c = value ?? {};
  const set = (change: Partial<Conditions>) => {
    const next: Conditions = { ...c, ...change };
    for (const k of Object.keys(next) as (keyof Conditions)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const [profiles, setProfiles] = useState(loadProfiles);
  const [temperature, setTemperature] = useState(c.temperature === undefined ? "" : String(c.temperature));
  useEffect(() => setTemperature(value?.temperature === undefined ? "" : String(value.temperature)), [value?.temperature]);

  const saveProfile = async () => {
    const name = await askText(t("cond.profileAsk"), "", { title: t("cond.profileSave") });
    if (!name?.trim()) return;
    // A setup, not a board state: revision, parts taken off and temperature stay out.
    const { revision: _r, assembly: _a, removed: _p, temperature: _t, ...setup } = c;
    const next = [...profiles.filter((p) => p.name.toLowerCase() !== name.trim().toLowerCase()), { name: name.trim(), conditions: setup }];
    saveProfiles(next);
    setProfiles(next);
  };

  return (
    <div className="conditions" title={t("cond.hint")}>
      {profiles.length > 0 && (
        <label>
          <span>{t("cond.profile")}</span>
          <select
            value=""
            onChange={(e) => {
              const p = profiles.find((x) => x.name === e.target.value);
              if (p) set(p.conditions);
            }}
          >
            <option value="">{t("cond.profilePick")}</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
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
        <span>{t("cond.assembly")}</span>
        <select
          value={c.assembly ?? ""}
          onChange={(e) => {
            const assembly = (e.target.value || undefined) as Conditions["assembly"];
            set({ assembly, ...(assembly === "complete" || !assembly ? { removed: undefined } : {}) });
          }}
        >
          <option value="">–</option>
          <option value="complete">{t("cond.assembly.complete")}</option>
          <option value="ic-removed">{t("cond.assembly.ic-removed")}</option>
          <option value="parts-removed">{t("cond.assembly.parts-removed")}</option>
        </select>
      </label>
      {(c.assembly === "ic-removed" || c.assembly === "parts-removed") && (
        <TextField label={t("cond.removed")} value={c.removed} placeholder="U7000" onDone={(removed) => set({ removed })} />
      )}
      <label>
        <span>{t("cond.temperature")}</span>
        <input
          inputMode="decimal"
          value={temperature}
          placeholder="°C"
          onChange={(e) => setTemperature(e.target.value)}
          onBlur={() => {
            const n = Number.parseFloat(temperature.replace(",", "."));
            const next = temperature.trim() && Number.isFinite(n) ? Math.round(n) : undefined;
            if (next !== c.temperature) set({ temperature: next });
          }}
        />
      </label>
      <TextField label={t("cond.modules")} value={c.modules} placeholder={t("cond.modulesPlaceholder")} onDone={(modules) => set({ modules })} />
      <TextField label={t("cond.range")} value={c.range} placeholder="Auto" onDone={(range) => set({ range })} />
      <label>
        <span>{t("cond.leads")}</span>
        <select
          value={c.leadsNulled === undefined ? "" : c.leadsNulled ? "yes" : "no"}
          onChange={(e) => set({ leadsNulled: e.target.value === "" ? undefined : e.target.value === "yes" })}
        >
          <option value="">–</option>
          <option value="yes">{t("cond.leads.nulled")}</option>
          <option value="no">{t("cond.leads.raw")}</option>
        </select>
      </label>
      <TextField label={t("cond.revision")} value={c.revision} placeholder="Rev 2.0" onDone={(revision) => set({ revision })} />
      <TextField label={t("cond.meter")} value={c.meter} placeholder="Owon XDM1241" onDone={(meter) => set({ meter })} />
      <button className="small cond-profile-save" onClick={() => void saveProfile()} title={t("cond.profileHint")}>
        {t("cond.profileSave")}
      </button>
    </div>
  );
}
