import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import { CloseIcon } from "./Icons";

export function Dialog({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog${className ? ` ${className}` : ""}`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="tool icon-only" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

interface SettingsProps {
  settings: Settings;
  onChange(s: Settings): void;
  onClose(): void;
}

export function SettingsDialog({ settings, onChange, onClose }: SettingsProps) {
  const { t } = useI18n();
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  type Toggle =
    | "ghostOtherSide"
    | "dimUnselected"
    | "showVias"
    | "partNames"
    | "pinNumbers"
    | "netNames"
    | "ratsnest"
    | "autoSchematic"
    | "updateCheck";
  const check = (key: Toggle, label: string) => (
    <label className="check">
      <input type="checkbox" checked={settings[key]} onChange={(e) => set(key, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Dialog title={t("settings.title")} onClose={onClose}>
      <div className="form-grid">
        <label htmlFor="set-lang">{t("settings.language")}</label>
        <select id="set-lang" value={settings.language} onChange={(e) => set("language", e.target.value as Settings["language"])}>
          <option value="auto">{t("settings.language.auto")}</option>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>

        <label htmlFor="set-theme">{t("settings.theme")}</label>
        <select id="set-theme" value={settings.theme} onChange={(e) => set("theme", e.target.value as Settings["theme"])}>
          <option value="system">{t("settings.theme.system")}</option>
          <option value="dark">{t("settings.theme.dark")}</option>
          <option value="light">{t("settings.theme.light")}</option>
        </select>

        <label htmlFor="set-units">{t("settings.units")}</label>
        <select id="set-units" value={settings.units} onChange={(e) => set("units", e.target.value as Settings["units"])}>
          <option value="mm">{t("settings.units.mm")}</option>
          <option value="mil">{t("settings.units.mil")}</option>
        </select>

        <label htmlFor="set-scroll">{t("settings.scroll")}</label>
        <select id="set-scroll" value={settings.scroll} onChange={(e) => set("scroll", e.target.value as Settings["scroll"])}>
          <option value="pan">{t("settings.scroll.pan")}</option>
          <option value="zoom">{t("settings.scroll.zoom")}</option>
        </select>
      </div>
      <h3>{t("settings.display")}</h3>
      <div className="checks">
        {check("partNames", t("settings.partNames"))}
        {check("pinNumbers", t("settings.pinNumbers"))}
        {check("netNames", t("settings.netNames"))}
        {check("ghostOtherSide", t("settings.ghost"))}
        {check("dimUnselected", t("settings.dim"))}
        {check("showVias", t("settings.vias"))}
        {check("ratsnest", t("settings.ratsnest"))}
      </div>
      <h3>{t("settings.formats")}</h3>
      <div className="form-grid">
        <label htmlFor="set-xzz">{t("settings.xzzKey")}</label>
        <input
          id="set-xzz"
          className="key-input"
          spellCheck={false}
          autoComplete="off"
          placeholder="0x…"
          value={settings.xzzKey}
          onChange={(e) => set("xzzKey", e.target.value.trim())}
          aria-invalid={settings.xzzKey !== "" && !/^(0x)?[0-9a-f]{1,16}$/i.test(settings.xzzKey)}
        />
      </div>
      <p className="muted setting-hint">{t("settings.xzzKeyHint")}</p>
      <h3>{t("schematic.title")}</h3>
      <div className="checks">{check("autoSchematic", t("settings.autoSchematic"))}</div>
      <h3>Avero</h3>
      <div className="checks">{check("updateCheck", t("settings.updateCheck"))}</div>
      <footer className="dialog-footer">
        <button className="primary" onClick={onClose}>
          {t("settings.done")}
        </button>
      </footer>
    </Dialog>
  );
}

export function HelpDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const rows = [
    ["help.pan", "help.panLabel"],
    ["help.zoom", "help.zoomLabel"],
    ["help.select", "help.selectLabel"],
    ["help.zoomTo", "help.zoomToLabel"],
    ["help.flip", "help.flipLabel"],
    ["help.rotate", "help.rotateLabel"],
    ["help.fit", "help.fitLabel"],
    ["help.search", "help.searchLabel"],
    ["help.palette", "help.paletteLabel"],
    ["help.tabs", "help.tabsLabel"],
    ["help.ratsnest", "help.ratsnestLabel"],
    ["help.open", "help.openLabel"],
    ["help.schematic", "help.schematicLabel"],
    ["help.library", "help.libraryLabel"],
    ["help.pages", "help.pagesLabel"],
    ["help.hits", "help.hitsLabel"],
    ["help.schematicSearch", "help.schematicSearchLabel"],
    ["help.clear", "help.clearLabel"],
  ] as const;
  return (
    <Dialog title={t("help.title")} onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={keys}>
              <td>
                <kbd>{t(keys)}</kbd>
              </td>
              <td>{t(label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
