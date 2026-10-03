import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { copyText } from "../core/clipboard";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import { claudeCodeCommand, claudeDesktopConfig, MCP_DEFAULT_PORT, mcpUrl } from "../workbench/mcp";
import { MCP_TOOLS } from "../workbench/mcpTools";

/** Switching the AI connection on, and how to connect Claude to it. */
export function McpSettings({ value, onChange }: { value: Settings["mcp"]; onChange(v: Settings["mcp"]): void }) {
  const { t } = useI18n();
  const enabled = !!value?.enabled;
  const port = value?.port ?? MCP_DEFAULT_PORT;
  const [running, setRunning] = useState<number | null>(null);
  const [exe, setExe] = useState("/Applications/Avero.app/Contents/MacOS/avero");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("app_executable").then(setExe, () => {});
  }, []);
  useEffect(() => {
    // The server starts in the app; check a moment later.
    const timer = window.setTimeout(() => invoke<number | null>("mcp_status").then(setRunning, () => setRunning(null)), 400);
    return () => window.clearTimeout(timer);
  }, [enabled, port]);

  const copy = (text: string, what: string) => {
    void copyText(text).then((ok) => ok && setCopied(what));
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="mcp-settings">
      <div className="settings-row">
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked, port })} />
          {t("mcp.enable")}
        </label>
        <label className="mcp-port">
          {t("mcp.port")}
          <input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => {
              const p = Number(e.target.value);
              if (Number.isInteger(p) && p >= 1024 && p <= 65535) onChange({ enabled, port: p });
            }}
          />
        </label>
        <span className={running ? "mcp-on" : "muted"}>{running ? t("mcp.running", { url: mcpUrl(running) }) : t("mcp.off")}</span>
      </div>
      <p className="muted setting-hint">{t("mcp.hint")}</p>
      {enabled && (
        <>
          <h4>{t("mcp.claudeCode")}</h4>
          <div className="mcp-snippet">
            <code>{claudeCodeCommand(port)}</code>
            <button className="small" onClick={() => copy(claudeCodeCommand(port), "code")}>
              {copied === "code" ? t("mcp.copied") : t("mcp.copy")}
            </button>
          </div>
          <h4>{t("mcp.claudeDesktop")}</h4>
          <p className="muted setting-hint">{t("mcp.desktopHint")}</p>
          <div className="mcp-snippet">
            <pre>{claudeDesktopConfig(exe, port)}</pre>
            <button className="small" onClick={() => copy(claudeDesktopConfig(exe, port), "desktop")}>
              {copied === "desktop" ? t("mcp.copied") : t("mcp.copy")}
            </button>
          </div>
          <details className="mcp-tools">
            <summary>{t("mcp.tools", { n: MCP_TOOLS.length })}</summary>
            <ul>
              {MCP_TOOLS.map((tool) => (
                <li key={tool.name}>
                  <code>{tool.name}</code> – {tool.description}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
