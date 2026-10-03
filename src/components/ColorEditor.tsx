import { useI18n, type MessageKey } from "../i18n";
import { COLOR_PRESETS, colorHex, DARK, EDITABLE_COLORS, LIGHT, withColors, type EditableColor, type OwnColors } from "../render/palette";
import type { Settings } from "../settings";

/** Board colours, for the dark and the light look each; changes show at once. */
export function ColorEditor({ colors, onChange }: { colors: Settings["colors"]; onChange(c: Settings["colors"]): void }) {
  const { t } = useI18n();
  const column = (theme: "dark" | "light") => {
    const own: OwnColors = colors?.[theme] ?? {};
    const shown = withColors(theme === "dark" ? DARK : LIGHT, own);
    const set = (key: EditableColor, hex: string | undefined) => {
      const next = { ...own };
      if (hex) next[key] = hex;
      else delete next[key];
      onChange({ ...colors, [theme]: next });
    };
    return (
      <div className="color-column">
        <h4>{t(theme === "dark" ? "colors.dark" : "colors.light")}</h4>
        {EDITABLE_COLORS.map((key) => (
          <label key={key} className={`color-row${own[key] ? " changed" : ""}`}>
            <input type="color" value={colorHex(shown, key)} onChange={(e) => set(key, e.target.value)} />
            <span>{t(`colors.${key}` as MessageKey)}</span>
            {own[key] && (
              <button type="button" className="tool icon-only" title={t("colors.resetOne")} aria-label={t("colors.resetOne")} onClick={() => set(key, undefined)}>
                ↺
              </button>
            )}
          </label>
        ))}
      </div>
    );
  };
  return (
    <div className="color-editor">
      <div className="color-actions">
        <button className="small" onClick={() => onChange(undefined)} disabled={!colors}>
          {t("colors.reset")}
        </button>
        <button className="small" onClick={() => onChange({ dark: { ...COLOR_PRESETS.contrast.dark }, light: { ...COLOR_PRESETS.contrast.light } })}>
          {t("colors.contrast")}
        </button>
      </div>
      <div className="color-columns">
        {column("dark")}
        {column("light")}
      </div>
    </div>
  );
}
