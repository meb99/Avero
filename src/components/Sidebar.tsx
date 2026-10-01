import { useMemo, useState } from "react";
import type { BoardModel, ViewSide } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import type { BoardNotes } from "../workbench/notes";
import { Workbench } from "./Workbench";
import { Details } from "./Details";
import { VirtualList } from "./VirtualList";
import { LayerList } from "./LayerList";
import type { Palette } from "../render/palette";

type Tab = "details" | "parts" | "nets" | "layers" | "measure";

interface Props {
  model: BoardModel;
  selection: Selection;
  side: ViewSide;
  settings: Settings;
  notes: BoardNotes | null;
  notesError: string | null;
  updateNotes(change: (n: BoardNotes) => BoardNotes): void;
  onTolerance(t: number): void;
  onSelect(selection: Selection, zoom: boolean): void;
  palette: Palette;
  hiddenLayers: ReadonlySet<number>;
  onHiddenLayers(hidden: ReadonlySet<number>): void;
}

export function Sidebar({
  model,
  selection,
  side,
  settings,
  notes,
  notesError,
  updateNotes,
  onTolerance,
  onSelect,
  palette,
  hiddenLayers,
  onHiddenLayers,
}: Props) {
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

  const pinless = model.pins.length === 0 && model.traces.length > 0;
  const selectedPart = model.selectedPart(selection);
  const selectedNet = model.selectedNet(selection);

  return (
    <aside className="sidebar">
      <nav className="tabs" role="tablist">
        {(["details", "parts", "nets", "layers", "measure"] as const)
          .filter((id) => id !== "layers" || model.layers.length > 0)
          .map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {t(`tab.${id}`)}
            {id === "parts" && <span className="count">{model.parts.length}</span>}
            {id === "nets" && <span className="count">{model.nets.length}</span>}
            {id === "layers" && <span className="count">{model.layers.length}</span>}
          </button>
          ))}
      </nav>

      {tab === "layers" && model.layers.length > 0 && (
        <div className="panel scroll">
          <LayerList model={model} palette={palette} hidden={hiddenLayers} onChange={onHiddenLayers} />
        </div>
      )}

      {tab === "details" && (
        <div className="panel scroll">
          <Details
            model={model}
            selection={selection}
            side={side}
            settings={settings}
            notes={notes}
            updateNotes={updateNotes}
            onSelect={onSelect}
          />
        </div>
      )}

      {tab === "measure" && notes && (
        <div className="panel scroll">
          <Workbench
            model={model}
            notes={notes}
            update={updateNotes}
            tolerance={settings.tolerance}
            onTolerance={onTolerance}
            onSelect={onSelect}
            error={notesError}
          />
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
                  {/* Boards without pins connect through tracks: count those instead. */}
                  {pinless ? (
                    <span className="list-meta" title={t("list.netTraces")}>
                      {n.traces?.length ?? 0}
                    </span>
                  ) : (
                    <span className="list-meta">{n.pins.length}</span>
                  )}
                </button>
              );
            }}
          />
        </div>
      )}
    </aside>
  );
}
