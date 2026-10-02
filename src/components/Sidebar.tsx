import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { Diagnosis } from "./Diagnosis";
import type { ObdData } from "../knowledge/obdata";
import type { BoardModel, ViewSide } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import type { BoardNotes } from "../workbench/notes";
import { Workbench } from "./Workbench";
import { Details } from "./Details";
import { VirtualList } from "./VirtualList";
import { LayerList } from "./LayerList";
import type { Palette, RGBA } from "../render/palette";
import type { SchematicDocument } from "../schematic/document";

type Tab = "details" | "parts" | "nets" | "layers" | "knowledge" | "measure" | "diagnose";

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
  schematic: SchematicDocument | null;
  onSchematicJump(text: string, hit: number): void;
  onRenameNet(net: number, name: string): string | null;
  /** Changes when net names change, so name-sorted lists refresh. */
  namesRevision: number;
  pinnedNets: ReadonlyMap<number, RGBA>;
  onTogglePin(net: number): void;
  onShowMarker(id: string): void;
  /** Known-good values of OpenBoardData for this board, if any. */
  obdata: ObdData | null;
  /** Contents of the "Knowledge" tab. */
  knowledge: ReactNode;
  knowledgeCount: number;
  /** Width in CSS pixels; `done` once dragging ends (to store it). */
  width: number;
  onWidth(width: number, done: boolean): void;
  collapsed: boolean;
  onCollapsed(collapsed: boolean): void;
}

export const SIDEBAR_MIN = 260;
export const SIDEBAR_MAX = 760;
export const SIDEBAR_DEFAULT = 340;

export function Sidebar({
  obdata,
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
  schematic,
  onSchematicJump,
  onRenameNet,
  namesRevision,
  pinnedNets,
  onTogglePin,
  onShowMarker,
  knowledge,
  knowledgeCount,
  width,
  onWidth,
  collapsed,
  onCollapsed,
}: Props) {
  const asideRef = useRef<HTMLElement>(null);
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
    // namesRevision: own net names change the model's names in place.
  }, [model, netFilter, namesRevision]);

  const pinless = model.pins.length === 0 && model.traces.length > 0;
  const selectedPart = model.selectedPart(selection);
  const selectedNet = model.selectedNet(selection);

  const tabs = (["details", "parts", "nets", "layers", "knowledge", "measure", "diagnose"] as const).filter(
    (id) => id !== "layers" || model.layers.length > 0,
  );

  // Folded: a narrow strip of upright tab names; a click opens that tab.
  if (collapsed)
    return (
      <aside className="sidebar collapsed" aria-label={t("sidebar.label")}>
        <button className="tool icon-only sidebar-fold" onClick={() => onCollapsed(false)} title={t("sidebar.expand")} aria-label={t("sidebar.expand")}>
          <ChevronLeftIcon />
        </button>
        <nav className="tabs vertical" role="tablist" aria-orientation="vertical">
          {tabs.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "on" : ""}
              onClick={() => {
                setTab(id);
                onCollapsed(false);
              }}
            >
              {t(`tab.${id}`)}
            </button>
          ))}
        </nav>
      </aside>
    );

  const widthAt = (clientX: number) => {
    const right = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, right - clientX)));
  };

  return (
    <aside className="sidebar" ref={asideRef} style={{ width }}>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        title={t("sidebar.resize")}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          document.body.classList.add("resizing");
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onWidth(widthAt(e.clientX), false);
        }}
        onPointerUp={(e) => {
          document.body.classList.remove("resizing");
          e.currentTarget.releasePointerCapture(e.pointerId);
          onWidth(widthAt(e.clientX), true);
        }}
        onDoubleClick={() => onWidth(SIDEBAR_DEFAULT, true)}
      />
      <div className="tabs-row">
        <button className="tool icon-only sidebar-fold" onClick={() => onCollapsed(true)} title={t("sidebar.collapse")} aria-label={t("sidebar.collapse")}>
          <ChevronRightIcon />
        </button>
        <nav className="tabs" role="tablist">
          {tabs.map((id) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {t(`tab.${id}`)}
              {id === "parts" && <span className="count">{model.parts.length}</span>}
              {id === "nets" && <span className="count">{model.nets.length}</span>}
              {id === "layers" && <span className="count">{model.layers.length}</span>}
              {id === "knowledge" && knowledgeCount > 0 && <span className="count">{knowledgeCount}</span>}
            </button>
          ))}
        </nav>
      </div>

      {tab === "knowledge" && <div className="panel scroll">{knowledge}</div>}

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
            schematic={schematic}
            onSchematicJump={onSchematicJump}
            onRenameNet={onRenameNet}
            pinnedNets={pinnedNets}
            onTogglePin={onTogglePin}
            obdata={obdata}
          />
        </div>
      )}

      {tab === "diagnose" && (
        <div className="panel scroll">
          <Diagnosis model={model} notes={notes} update={updateNotes} onSelect={onSelect} />
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
            onShowMarker={onShowMarker}
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
                  {n.assumedGround && <span className="muted">{t("list.assumedGround")}</span>}
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
