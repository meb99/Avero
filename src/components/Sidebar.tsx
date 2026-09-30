import { useMemo, useState } from "react";
import type { BoardModel, ViewSide } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import { Details } from "./Details";
import { VirtualList } from "./VirtualList";

type Tab = "details" | "parts" | "nets";

interface Props {
  model: BoardModel;
  selection: Selection;
  side: ViewSide;
  settings: Settings;
  onSelect(selection: Selection, zoom: boolean): void;
}

export function Sidebar({ model, selection, side, settings, onSelect }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("details");
  const [partFilter, setPartFilter] = useState("");
  const [netFilter, setNetFilter] = useState("");

  const parts = useMemo(() => {
    const q = partFilter.trim().toUpperCase();
    const all = model.sortedParts;
    if (!q) return all;
    return all.filter((i) => {
      const p = model.parts[i];
      return p.name.toUpperCase().includes(q) || (p.device?.toUpperCase().includes(q) ?? false);
    });
  }, [model, partFilter]);

  const nets = useMemo(() => {
    const q = netFilter.trim().toUpperCase();
    const all = model.sortedNets;
    return q ? all.filter((i) => model.nets[i].name.toUpperCase().includes(q)) : all;
  }, [model, netFilter]);

  const selectedPart = model.selectedPart(selection);
  const selectedNet = model.selectedNet(selection);

  return (
    <aside className="sidebar">
      <nav className="tabs" role="tablist">
        {(["details", "parts", "nets"] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {t(`tab.${id}`)}
            {id === "parts" && <span className="count">{model.parts.length}</span>}
            {id === "nets" && <span className="count">{model.nets.length}</span>}
          </button>
        ))}
      </nav>

      {tab === "details" && (
        <div className="panel scroll">
          <Details model={model} selection={selection} side={side} settings={settings} onSelect={onSelect} />
        </div>
      )}

      {tab === "parts" && (
        <div className="panel list-panel">
          <input className="filter" type="search" placeholder={t("list.filter")} value={partFilter} onChange={(e) => setPartFilter(e.target.value)} />
          <div className="list-count">{t("list.count", { n: parts.length, total: model.parts.length })}</div>
          <VirtualList
            items={parts}
            rowHeight={30}
            scrollTo={selectedPart === undefined ? undefined : parts.indexOf(selectedPart)}
            render={(i) => {
              const p = model.parts[i];
              return (
                <button className={`list-row${i === selectedPart ? " selected" : ""}`} onClick={() => onSelect({ kind: "part", part: i }, true)}>
                  <span className="list-name">{p.name}</span>
                  <span className="list-meta">{p.device ?? ""}</span>
                  <span className={`side-dot side-${p.side}`} title={p.side} />
                </button>
              );
            }}
          />
        </div>
      )}

      {tab === "nets" && (
        <div className="panel list-panel">
          <input className="filter" type="search" placeholder={t("list.filter")} value={netFilter} onChange={(e) => setNetFilter(e.target.value)} />
          <div className="list-count">{t("list.count", { n: nets.length, total: model.nets.length })}</div>
          <VirtualList
            items={nets}
            rowHeight={30}
            scrollTo={selectedNet === undefined ? undefined : nets.indexOf(selectedNet)}
            render={(i) => {
              const n = model.nets[i];
              return (
                <button className={`list-row${i === selectedNet ? " selected" : ""}`} onClick={() => onSelect({ kind: "net", net: i }, true)}>
                  <span className={`kind-bar kind-${n.kind}`} />
                  <span className="list-name">{n.name}</span>
                  <span className="list-meta">{n.pins.length}</span>
                </button>
              );
            }}
          />
        </div>
      )}
    </aside>
  );
}
