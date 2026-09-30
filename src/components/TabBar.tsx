import { useI18n } from "../i18n";
import { CloseIcon } from "./Icons";

export interface TabInfo {
  id: number;
  title: string;
  /** Full path, shown as tooltip. */
  detail?: string;
}

interface Props {
  tabs: TabInfo[];
  active: number;
  onSwitch(id: number): void;
  onClose(id: number): void;
  onNew(): void;
}

export function TabBar({ tabs, active, onSwitch, onClose, onNew }: Props) {
  const { t } = useI18n();
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          className={`tab${tab.id === active ? " active" : ""}`}
          title={tab.detail ?? tab.title}
          onClick={() => onSwitch(tab.id)}
          onAuxClick={(e) => {
            // Middle click closes, as in browsers.
            if (e.button === 1) onClose(tab.id);
          }}
        >
          <span className="tab-title">{tab.title}</span>
          <button
            className="tab-close"
            aria-label={t("tabs.close")}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            <CloseIcon size={11} />
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} aria-label={t("tabs.new")} title={`${t("tabs.new")} (⌘T)`}>
        +
      </button>
    </div>
  );
}
