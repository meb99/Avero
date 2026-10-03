import { createBackup, formatBytes, pickAndRestoreBackup } from "../workbench/backup";
import { bindings, isModifierOnly, keyLabel, keyName, rebind, SHORTCUT_ACTIONS, type ShortcutAction, type Shortcuts } from "../shortcuts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import { CloseIcon } from "./Icons";
import { MeterSettings } from "./MeterSettings";
import { ColorEditor } from "./ColorEditor";

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
  onCheckUpdates(): void;
  onClose(): void;
}

export function SettingsDialog({ settings, onChange, onCheckUpdates, onClose }: SettingsProps) {
  const { t } = useI18n();
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  type Toggle =
    | "ghostOtherSide"
    | "dimUnselected"
    | "showVias"
    | "showTraces"
    | "partNames"
    | "pinNumbers"
    | "netNames"
    | "ratsnest"
    | "overview"
    | "autoSchematic"
    | "restoreWorkspace"
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
        {check("showTraces", t("settings.traces"))}
        {check("ratsnest", t("settings.ratsnest"))}
        {check("overview", t("settings.overview"))}
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
      <div className="form-grid">
        <label htmlFor="set-fz">{t("settings.fzKey")}</label>
        <textarea
          id="set-fz"
          className="key-input"
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="0x… 0x… (44)"
          value={settings.fzKey}
          onChange={(e) => set("fzKey", e.target.value)}
          aria-invalid={settings.fzKey.trim() !== "" && fzWords(settings.fzKey) !== 44 && fzWords(settings.fzKey) !== 88}
        />
      </div>
      <p className="muted setting-hint">{t("settings.fzKeyHint", { n: fzWords(settings.fzKey) })}</p>
      <h3>{t("schematic.title")}</h3>
      <div className="checks">{check("autoSchematic", t("settings.autoSchematic"))}</div>
      <h3>{t("colors.title")}</h3>
      <p className="muted setting-hint">{t("colors.hint")}</p>
      <ColorEditor colors={settings.colors} onChange={(colors) => set("colors", colors)} />
      <h3>{t("keys.title")}</h3>
      <p className="muted setting-hint">{t("keys.hint")}</p>
      <ShortcutEditor value={settings.shortcuts} onChange={(shortcuts) => set("shortcuts", shortcuts)} />
      <h3>{t("meter.title")}</h3>
      <MeterSettings value={settings.meter} onChange={(meter) => set("meter", meter)} />
      <h3>{t("backup.title")}</h3>
      <p className="muted setting-hint">{t("backup.hint")}</p>
      <BackupButtons />
      <h3>Avero</h3>
      <div className="checks">
        {check("updateCheck", t("settings.updateCheck"))}
        {check("restoreWorkspace", t("settings.restoreWorkspace"))}
      </div>
      <div className="version-row">
        <span className="muted">{t("settings.version", { version: __APP_VERSION__ })}</span>
        <button className="small" onClick={onCheckUpdates}>
          {t("menu.checkUpdates")}
        </button>
      </div>
      <footer className="dialog-footer">
        <button className="primary" onClick={onClose}>
          {t("settings.done")}
        </button>
      </footer>
    </Dialog>
  );
}

/** The bench keys: click an action, press the key (or the pedal). */
function ShortcutEditor({ value, onChange }: { value: Shortcuts; onChange(s: Shortcuts): void }) {
  const { t, lang } = useI18n();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const all = bindings(value);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (isModifierOnly(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== "Escape") onChange(rebind(value, recording, keyName(e)));
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, value, onChange]);
  return (
    <table className="shortcut-table">
      <tbody>
        {SHORTCUT_ACTIONS.map((a) => (
          <tr key={a}>
            <td>{t(`keys.${a}`)}</td>
            <td>
              <button className={recording === a ? "small primary" : "small"} onClick={() => setRecording(recording === a ? null : a)}>
                {recording === a ? t("keys.press") : all[a].map((k) => keyLabel(k, lang)).join(" / ") || t("keys.none")}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>
            <button className="small" onClick={() => onChange({})}>
              {t("keys.reset")}
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Full backup and restore of library, data and settings. */
function BackupButtons() {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(t("backup.working"));
    try {
      setMessage(await task());
    } catch (e) {
      setMessage(t("backup.failed", { message: String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="backup-row">
      <button
        className="small"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r = await createBackup(t("backup.create"));
            return r ? t("backup.done", { n: r.files, size: formatBytes(r.bytes, lang) }) : null;
          })
        }
      >
        {t("backup.create")}
      </button>
      <button
        className="small"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const { ask } = await import("@tauri-apps/plugin-dialog");
            const r = await pickAndRestoreBackup(t("backup.restore"), (path) =>
              ask(t("backup.restoreAsk", { path }), { title: t("backup.restore"), kind: "warning", okLabel: t("backup.restoreOk") }),
            );
            if (!r) return null;
            // Everything in memory is stale now: start over with the restored data.
            window.setTimeout(() => window.location.reload(), 1500);
            return t("backup.restored", { n: r.files, created: new Date(r.created).toLocaleString(lang) });
          })
        }
      >
        {t("backup.restore")}
      </button>
      {message && <span className="muted backup-message">{message}</span>}
    </div>
  );
}

/** Number of hexadecimal words in a typed FZ key. */
function fzWords(text: string): number {
  const words = text.split(/[\s,;]+/).filter(Boolean);
  return words.every((w) => /^(0x)?[0-9a-f]{1,8}$/i.test(w)) ? words.length : -1;
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
    ["help.marker", "help.markerLabel"],
    ["help.pin", "help.pinLabel"],
    ["help.exportPdf", "help.exportPdfLabel"],
    ["help.open", "help.openLabel"],
    ["help.schematic", "help.schematicLabel"],
    ["help.library", "help.libraryLabel"],
    ["help.pages", "help.pagesLabel"],
    ["help.hits", "help.hitsLabel"],
    ["help.schematicSearch", "help.schematicSearchLabel"],
    ["help.multi", "help.multiLabel"],
    ["help.both", "help.bothLabel"],
    ["help.next", "help.nextLabel"],
    ["help.commitNext", "help.commitNextLabel"],
    ["help.undo", "help.undoLabel"],
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
      <p className="muted setting-hint">{t("help.ownKeys")}</p>
    </Dialog>
  );
}
