import { useI18n } from "../i18n";

interface Props {
  /** Pinned files first. */
  recent: string[];
  pinned: string[];
  onTogglePin(path: string): void;
  onOpen(): void;
  onDemo(): void;
  onLibrary(): void;
  onOpenRecent(path: string): void;
  onClearRecent(): void;
}

const FORMATS = ["BRD", "BRD2", "BDV", "ASC", "BVR", "BVR3", "GenCAD", "CAD", "CST", "XZZ", "FZ", "KiCad", "EAGLE", "Altium", "GR", "PDF"];

export function Welcome({ recent, pinned, onTogglePin, onOpen, onDemo, onLibrary, onOpenRecent, onClearRecent }: Props) {
  const { t } = useI18n();
  return (
    <div className="welcome">
      <div className="welcome-card">
        <img className="welcome-logo" src={`${import.meta.env.BASE_URL}avero.svg`} alt="" width={72} height={72} />
        <h1>Avero</h1>
        <p className="welcome-tagline">{t("app.tagline")}</p>
        <div className="welcome-actions">
          <button className="primary" onClick={onOpen}>
            {t("welcome.open")}
          </button>
          <button onClick={onLibrary}>{t("welcome.library")}</button>
          <button onClick={onDemo}>{t("welcome.demo")}</button>
        </div>
        <p className="muted">{t("welcome.drop")}</p>

        {recent.length > 0 && (
          <section className="welcome-recent">
            <header>
              <h2>{t("welcome.recent")}</h2>
              {/* Clearing keeps the pinned files. */}
              {recent.some((p) => !pinned.includes(p)) && (
                <button className="link" onClick={onClearRecent}>
                  {t("welcome.clearRecent")}
                </button>
              )}
            </header>
            <ul>
              {recent.map((path) => {
                const isPinned = pinned.includes(path);
                return (
                  <li key={path} className={isPinned ? "pinned" : undefined}>
                    <button className="recent-item" onClick={() => onOpenRecent(path)} title={path}>
                      <span className="recent-name">{path.split(/[\\/]/).pop()}</span>
                      <span className="recent-path">{path}</span>
                    </button>
                    <button className="link recent-pin" onClick={() => onTogglePin(path)} aria-pressed={isPinned} title={t("welcome.pinHint")}>
                      {t(isPinned ? "welcome.unpin" : "welcome.pin")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <footer className="welcome-footer">
          <p>
            <span className="muted">{t("welcome.formats")}:</span> {FORMATS.join(" · ")}
          </p>
          <p className="muted">{t("welcome.schematicHint")}</p>
          <p className="muted">{t("welcome.privacy")}</p>
        </footer>
      </div>
    </div>
  );
}
