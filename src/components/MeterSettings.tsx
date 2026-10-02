import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { Quantity } from "../workbench/measure";
import {
  connectMeter,
  disconnectMeter,
  METER_PROFILES,
  meterPorts,
  profileOf,
  readMeter,
  useMeter,
  type MeterSettings as Config,
  type PortInfo,
} from "../workbench/meter";
import { formatValue, QUANTITIES } from "../workbench/measure";

const DEFAULT: Config = { port: "", baud: METER_PROFILES[0].baud, profile: METER_PROFILES[0].id, autoConnect: true };

/** Choosing, connecting and testing the multimeter, in the settings. */
export function MeterSettings({ value, onChange }: { value: Config | undefined; onChange(v: Config): void }) {
  const { t, lang } = useI18n();
  const meter = useMeter();
  const config = { ...DEFAULT, ...value };
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [own, setOwn] = useState(!!(value?.read || value?.modes));
  const profile = profileOf(config);

  const refresh = () =>
    meterPorts().then(
      (p) => setPorts(p),
      () => setPorts([]),
    );
  useEffect(() => {
    void refresh();
  }, []);

  const set = (change: Partial<Config>) => onChange({ ...config, ...change });

  return (
    <div className="meter-settings">
      <div className="settings-row">
        <label>
          {t("meter.port")}
          <select value={config.port} onChange={(e) => set({ port: e.target.value })}>
            <option value="">{ports === null ? "…" : ports.length ? t("meter.pickPort") : t("meter.noPorts")}</option>
            {(ports ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name.replace(/^\/dev\//, "")}
                {p.description ? ` · ${p.description}` : ""}
              </option>
            ))}
            {config.port && !ports?.some((p) => p.name === config.port) && <option value={config.port}>{config.port}</option>}
          </select>
        </label>
        <button className="small" onClick={() => void refresh()}>
          {t("meter.refresh")}
        </button>
      </div>
      <div className="settings-row">
        <label>
          {t("meter.profile")}
          <select
            value={config.profile}
            onChange={(e) => {
              const p = METER_PROFILES.find((x) => x.id === e.target.value) ?? METER_PROFILES[0];
              set({ profile: p.id, baud: p.baud });
            }}
          >
            {METER_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("meter.baud")}
          <select value={config.baud} onChange={(e) => set({ baud: Number(e.target.value) })}>
            {[9600, 19200, 38400, 57600, 115200].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check small-check">
        <input
          type="checkbox"
          checked={own}
          onChange={(e) => {
            setOwn(e.target.checked);
            if (!e.target.checked) set({ read: undefined, modes: undefined });
          }}
        />
        {t("meter.own")}
      </label>
      {own && (
        <div className="meter-commands">
          {QUANTITIES.map((q: Quantity) => (
            <label key={q}>
              {t(`measure.${q}`)}
              <input
                className="mono"
                spellCheck={false}
                value={profile.modes[q]}
                onChange={(e) => set({ modes: { ...profile.modes, [q]: e.target.value } })}
              />
            </label>
          ))}
          <label>
            {t("meter.readCommand")}
            <input className="mono" spellCheck={false} value={profile.read} onChange={(e) => set({ read: e.target.value })} />
          </label>
        </div>
      )}
      <div className="settings-row">
        {meter.connected ? (
          <button className="small" onClick={() => void disconnectMeter()}>
            {t("meter.disconnect")}
          </button>
        ) : (
          <button className="small primary" disabled={!config.port || meter.busy} onClick={() => void connectMeter(config).catch(() => {})}>
            {meter.busy ? "…" : t("meter.connect")}
          </button>
        )}
        {meter.connected &&
          QUANTITIES.map((q) => (
            <button
              key={q}
              className="small"
              disabled={meter.busy}
              onClick={() =>
                void readMeter(q).then(
                  (v) => setTest(`${t(`measure.${q}`)}: ${formatValue(v, q, lang)}`),
                  () => setTest(null),
                )
              }
            >
              {t("meter.test", { what: t(`measure.${q}`) })}
            </button>
          ))}
        <label className="check small-check">
          <input type="checkbox" checked={config.autoConnect} onChange={(e) => set({ autoConnect: e.target.checked })} />
          {t("meter.auto")}
        </label>
      </div>
      <p className="muted setting-hint">
        {meter.connected ? t("meter.connected", { id: meter.id || meter.port || "" }) : t("meter.hint")}
        {test && <strong> · {test}</strong>}
      </p>
      {meter.error && <p className="wb-error">{meter.error}</p>}
    </div>
  );
}
