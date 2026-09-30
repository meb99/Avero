import { useI18n } from "../i18n";

interface Props {
  recent: string[];
  onOpen(): void;
  onDemo(): void;
  onOpenRecent(path: string): void;
  onClearRecent(): void;
}

const FORMATS = ["BRD", "BRD2", "BDV", "ASC", "BVR", "BVR3", "GenCAD", "CAD", "CST", "PDF"];

export function Welcome({ recent, onOpen, onDemo, onOpenRecent, onClearRecent }: Props) {
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
          <button onClick={onDemo}>{t("welcome.demo")}</button>
        </div>
        <p className="muted">{t("welcome.drop")}</p>

        {recent.length > 0 && (
          <section className="welcome-recent">
            <header>
              <h2>{t("welcome.recent")}</h2>
              <button className="link" onClick={onClearRecent}>
                {t("welcome.clearRecent")}
              </button>
            </header>
            <ul>
              {recent.map((path) => (
                <li key={path}>
                  <button className="recent-item" onClick={() => onOpenRecent(path)} title={path}>
                    <span className="recent-name">{path.split(/[\\/]/).pop()}</span>
                    <span className="recent-path">{path}</span>
                  </button>
                </li>
              ))}
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
