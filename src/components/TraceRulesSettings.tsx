import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { readFileBytes, saveBytes } from "../core/loader";
import { parseTraceRules, serializeTraceRules, TRACE_RULE_HEADER } from "../core/traceRules";
import { useI18n } from "../i18n";

/** Own trace rules as NexusBV's CSV: edit in place, import (appended) and export as a file. */
export function TraceRulesSettings({ value, onChange }: { value: string | undefined; onChange(v: string | undefined): void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<string | null>(null);
  const text = value ?? "";
  const { rules, skipped } = parseTraceRules(text);

  const importFile = async () => {
    const path = await open({ title: t("traceRules.import"), multiple: false, directory: false, filters: [{ name: "Trace rules", extensions: ["txt", "csv"] }] });
    if (typeof path !== "string") return;
    try {
      const read = parseTraceRules(new TextDecoder().decode(await readFileBytes(path)));
      onChange(serializeTraceRules([...rules, ...read.rules]));
      setStatus(t("traceRules.imported", { n: read.rules.length, skipped: read.skipped.length }));
    } catch (e) {
      setStatus(String(e));
    }
  };

  const exportFile = async () => {
    const saved = await saveBytes(new TextEncoder().encode(serializeTraceRules(rules)), t("traceRules.export"), "tracedef.txt", { name: "Trace rules", extensions: ["txt", "csv"] });
    if (saved) setStatus(t("traceRules.exported", { path: saved }));
  };

  return (
    <div className="trace-rules-settings">
      <textarea
        className="key-input"
        rows={6}
        spellCheck={false}
        placeholder={`${TRACE_RULE_HEADER}\n1,PU,DrMOS,33,NCP302155,8-11,16-26,PQFN33`}
        value={text}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : undefined)}
        aria-invalid={skipped.length > 0}
      />
      <p className="muted setting-hint">
        {t("traceRules.count", { n: rules.filter((r) => r.enabled).length, all: rules.length })}
        {skipped.length > 0 && ` · ${t("traceRules.skipped", { lines: skipped.join(", ") })}`}
      </p>
      <div className="settings-row">
        <button className="small" onClick={() => void importFile()}>
          {t("traceRules.import")}
        </button>
        <button className="small" disabled={rules.length === 0} onClick={() => void exportFile()}>
          {t("traceRules.export")}
        </button>
        <button className="small" disabled={!text} onClick={() => onChange(undefined)}>
          {t("traceRules.clear")}
        </button>
      </div>
      {status && <p className="muted setting-hint">{status}</p>}
    </div>
  );
}
