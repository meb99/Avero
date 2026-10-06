import type { CrossHit } from "./Details";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { Diagnosis } from "./Diagnosis";
import { Interfaces } from "./Interfaces";
import { PowerTree } from "./PowerTree";
import { HiddenParts } from "./HiddenParts";
import { MultiSelection } from "./MultiSelection";
import { matchesQuery, parsePartQuery, partSpecs } from "../core/partSearch";
import type { ObdData } from "../knowledge/obdata";
import type { BoardModel, ViewSide } from "../core/board";
import type { Net, NetKind, Selection } from "../core/types";
import { partRole, type PartRole } from "../core/partRole";
import { useI18n } from "../i18n";
import type { Settings } from "../settings";
import type { BoardNotes, Bookmark } from "../workbench/notes";
import { Workbench } from "./Workbench";
import { Details } from "./Details";
import { VirtualList } from "./VirtualList";
import { LayerList } from "./LayerList";
import type { Palette, RGBA } from "../render/palette";
import type { SchematicDocument } from "../schematic/document";
import type { SchematicFacts } from "../schematic/partInfo";
import type { Datasheet } from "../workbench/datasheets";
import { NOT_A_RAIL } from "../workbench/consoleGuides";
import { railVolts } from "../workbench/diagnosis";

const PART_FILTER_ROLES: PartRole[] = ["capacitor", "resistor", "inductor", "ferrite", "fuse", "jumper", "diode", "transistor", "ic", "connector", "crystal", "testpoint", "other"];

const NET_FILTER_KINDS = ["all", "power", "ground", "signal"] as const;
type NetFilterKind = (typeof NET_FILTER_KINDS)[number];

/** A supply rail: a power net, or one named like a voltage, but no enable or power-good line. */
function isRail(n: Net): boolean {
  return n.kind !== "ground" && n.kind !== "unconnected" && (n.kind === "power" || railVolts(n.name) !== undefined) && !NOT_A_RAIL.test(n.name);
}

const formatVolts = (v: number, lang: string) => `${v.toLocaleString(lang, { maximumFractionDigits: 3 })} V`;

export type SidebarTab = "details" | "parts" | "nets" | "layers" | "knowledge" | "measure" | "diagnose";
type Tab = SidebarTab;
export const SIDEBAR_TABS: readonly SidebarTab[] = ["details", "parts", "nets", "layers", "knowledge", "measure", "diagnose"];

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
  /** The board's open documents, the one shown first. */
  documents: SchematicDocument[];
  onSchematicJump(text: string, hit: number, doc: SchematicDocument): void;
  onRenameNet(net: number, name: string): string | null;
  onSetNetKind?(net: number, kind: NetKind | undefined): void;
  /** Where a pin continues on another board of the device (see project.ts). */
  crossBoard?(pin: number): CrossHit[];
  onCrossBoard?(path: string, part: string, pin: string): void;
  /** Changes when net names change, so name-sorted lists refresh. */
  namesRevision: number;
  pinnedNets: ReadonlyMap<number, RGBA>;
  onTogglePin(net: number): void;
  onPinNets(nets: number[]): void;
  marked: { parts: number[]; label: string } | null;
  onMarkParts(parts: number[] | null, label?: string): void;
  onShowMarker(id: string): void;
  onShowDrawing(id: string): void;
  onShowBookmark(b: Bookmark): void;
  onAddBookmark(): void;
  /** Known-good values of OpenBoardData for this board, if any. */
  obdata: ObdData | null;
  /** Values, part numbers and net voltages read from the schematic. */
  schematicFacts: SchematicFacts | null;
  /** Parts chosen together (⌘/Shift-click). */
  multiParts: readonly number[];
  onMultiParts(parts: number[]): void;
  onOpenBga(part: number): void;
  onFindDonors(part: number): void;
  datasheets: readonly Datasheet[];
  onOpenDatasheet(sheet: Datasheet, page?: number): void;
  onAddDatasheet(part: number): void;
  onRemoveDatasheet(sheet: Datasheet): void;
  /** Shows a tab from outside (next measuring point by key). */
  tabRequest?: { tab: SidebarTab; n: number } | null;
  /** Told which tab is shown (layouts remember it). */
  onTabChange?(tab: SidebarTab): void;
  listFocus?: { listId: string; index: number; n: number } | null;
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
  documents,
  onSchematicJump,
  onRenameNet,
  onSetNetKind,
  crossBoard,
  onCrossBoard,
  namesRevision,
  pinnedNets,
  onTogglePin,
  onPinNets,
  marked,
  onMarkParts,
  onShowMarker,
  onShowDrawing,
  onShowBookmark,
  onAddBookmark,
  knowledge,
  knowledgeCount,
  schematicFacts,
  multiParts,
  onMultiParts,
  onOpenBga,
  onFindDonors,
  datasheets,
  onOpenDatasheet,
  onAddDatasheet,
  onRemoveDatasheet,
  tabRequest,
  onTabChange,
  listFocus,
  width,
  onWidth,
  collapsed,
  onCollapsed,
}: Props) {
  const asideRef = useRef<HTMLElement>(null);
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>("details");
  // Tabs that do not fit scroll sideways, with arrows where more are hidden.
  const tabsRef = useRef<HTMLElement>(null);
  const [scroll, setScroll] = useState({ left: false, right: false });
  const updateScroll = () => {
    const el = tabsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setScroll((old) => (old.left === left && old.right === right ? old : { left, right }));
  };
  const scrollTabs = (dir: number) => {
    const el = tabsRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(el);
    updateScroll();
    return () => observer.disconnect();
  });
  // The chosen tab always in view.
  // (Again once the arrows appear, as they take room from the bar.)
  useEffect(() => {
    const nav = tabsRef.current;
    const el = nav?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!nav || !el) return;
    const left = el.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft) nav.scrollLeft = left - 4;
    else if (left + el.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = left + el.offsetWidth - nav.clientWidth + 4;
  }, [tab, scroll.left, scroll.right]);
  useEffect(() => {
    if (tabRequest) setTab(tabRequest.tab);
  }, [tabRequest?.n]);
  useEffect(() => onTabChange?.(tab), [tab, onTabChange]);
  const [partFilter, setPartFilter] = useState("");
  const [partKind, setPartKind] = useState<PartRole | "all">("all");
  const [netFilter, setNetFilter] = useState("");
  const [netKind, setNetKind] = useState<NetFilterKind>("all");

  // A search by value, rating, package or type ("10 µF 16V 0603") or a plain name search.
  const specQuery = useMemo(() => parsePartQuery(partFilter), [partFilter]);
  const parts = useMemo(() => {
    const q = partFilter.trim().toUpperCase();
    const all = partKind === "all" ? model.sortedParts : model.sortedParts.filter((i) => partRole(model.parts[i].name, model.parts[i].device, model.parts[i].pinCount) === partKind);
    if (!q) return all;
    if (specQuery)
      return all.filter((i) => {
        const p = model.parts[i];
        const facts = schematicFacts?.parts.get(p.name.toUpperCase());
        return matchesQuery(partSpecs(p.name, p.device, facts), specQuery, p.name, p.device);
      });
    return all.filter((i) => {
      const p = model.parts[i];
      return p.name.toUpperCase().includes(q) || (p.device?.toUpperCase().includes(q) ?? false);
    });
  }, [model, partFilter, partKind, specQuery, schematicFacts]);

  const partMarkLabel = `list:${partKind}:${partFilter.trim().toUpperCase()}`;

  const nets = useMemo(() => {
    const q = netFilter.trim().toUpperCase();
    let list = model.sortedNets;
    if (q) list = list.filter((i) => model.nets[i].name.toUpperCase().includes(q));
    if (netKind === "power") {
      // Rails, highest voltage first; enable and power-good signals are no rails.
      list = list
        .filter((i) => isRail(model.nets[i]))
        .sort((a, b) => (railVolts(model.nets[b].name) ?? -1) - (railVolts(model.nets[a].name) ?? -1) || model.nets[b].pins.length - model.nets[a].pins.length);
    } else if (netKind !== "all") list = list.filter((i) => model.nets[i].kind === netKind && !(netKind === "signal" && isRail(model.nets[i])));
    return list;
    // namesRevision: own net names change the model's names in place.
  }, [model, netFilter, netKind, namesRevision]);

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
        {scroll.left && (
          <button className="tool icon-only tabs-arrow" onClick={() => scrollTabs(-1)} title={t("sidebar.moreTabs")} aria-label={t("sidebar.moreTabs")}>
            <ChevronLeftIcon />
          </button>
        )}
        <nav
          className="tabs"
          role="tablist"
          ref={tabsRef}
          onScroll={updateScroll}
          onWheel={(e) => {
            // A mouse wheel scrolls the tabs sideways.
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {tabs.map((id) => (
            <button key={id} role="tab" data-tab={id} aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {t(`tab.${id}`)}
              {id === "parts" && <span className="count">{model.parts.length}</span>}
              {id === "nets" && <span className="count">{model.nets.length}</span>}
              {id === "layers" && <span className="count">{model.layers.length}</span>}
              {id === "knowledge" && knowledgeCount > 0 && <span className="count">{knowledgeCount}</span>}
            </button>
          ))}
        </nav>
        {scroll.right && (
          <button className="tool icon-only tabs-arrow" onClick={() => scrollTabs(1)} title={t("sidebar.moreTabs")} aria-label={t("sidebar.moreTabs")}>
            <ChevronRightIcon />
          </button>
        )}
      </div>

      {tab === "knowledge" && <div className="panel scroll">{knowledge}</div>}

      {tab === "layers" && model.layers.length > 0 && (
        <div className="panel scroll">
          <LayerList model={model} palette={palette} hidden={hiddenLayers} onChange={onHiddenLayers} />
        </div>
      )}

      {tab === "details" && (
        <div className="panel scroll">
          {multiParts.length >= 2 && (
            <MultiSelection
              model={model}
              parts={multiParts}
              onSelect={onSelect}
              onRemove={(p) => onMultiParts(multiParts.filter((x) => x !== p))}
              onClear={() => onMultiParts([])}
            />
          )}
          <Details
            model={model}
            selection={selection}
            side={side}
            settings={settings}
            notes={notes}
            updateNotes={updateNotes}
            onSelect={onSelect}
            documents={documents}
            onSchematicJump={onSchematicJump}
            onRenameNet={onRenameNet}
            onSetNetKind={onSetNetKind}
            crossBoard={crossBoard}
            onCrossBoard={onCrossBoard}
            pinnedNets={pinnedNets}
            onTogglePin={onTogglePin}
            onPinNets={onPinNets}
            marked={marked}
            onMarkParts={onMarkParts}
            obdata={obdata}
            schematicFacts={schematicFacts}
            onOpenBga={onOpenBga}
            onFindDonors={onFindDonors}
            datasheets={datasheets}
            onOpenDatasheet={onOpenDatasheet}
            onAddDatasheet={onAddDatasheet}
            onRemoveDatasheet={onRemoveDatasheet}
          />
        </div>
      )}

      {tab === "diagnose" && (
        <div className="panel scroll">
          <PowerTree model={model} notes={notes} schematicFacts={schematicFacts} onSelect={onSelect} update={notes ? updateNotes : undefined} />
          <Interfaces model={model} notes={notes} update={notes ? updateNotes : undefined} onSelect={onSelect} marked={marked} onMarkParts={onMarkParts} multiParts={multiParts} />
          <Diagnosis model={model} notes={notes} update={updateNotes} onSelect={onSelect} schematicFacts={schematicFacts} selection={selection} />
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
            onShowDrawing={onShowDrawing}
            onShowBookmark={onShowBookmark}
            onAddBookmark={onAddBookmark}
            error={notesError}
            selection={selection}
            units={settings.units}
            listFocus={listFocus}
          />
        </div>
      )}

      {tab === "parts" && (
        <div className="panel list-panel">
          <input
            className="filter"
            type="search"
            placeholder={t("list.partFilter")}
            title={t("list.partFilterHint")}
            value={partFilter}
            onChange={(e) => setPartFilter(e.target.value)}
          />
          {notes && <HiddenParts model={model} notes={notes} update={updateNotes} onSelect={onSelect} />}
          <div className="part-kinds">
            <select value={partKind} aria-label={t("list.partKinds")} onChange={(e) => setPartKind(e.target.value as PartRole | "all")}>
              <option value="all">{t("list.partKind.all")}</option>
              {PART_FILTER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`list.partKind.${r}`)}
                </option>
              ))}
            </select>
            {(partKind !== "all" || partFilter.trim()) && parts.length > 0 && (
              <button
                className={`small${marked?.label === partMarkLabel ? " on" : ""}`}
                onClick={() => onMarkParts(marked?.label === partMarkLabel ? null : parts, partMarkLabel)}
              >
                {marked?.label === partMarkLabel ? t("list.unmarkParts") : t("list.markParts", { n: parts.length })}
              </button>
            )}
          </div>
          <div className="list-count">
            {t("list.count", { n: parts.length, total: model.parts.length })}
            {specQuery && <span className="muted"> · {t("list.specSearch")}</span>}
            {specQuery?.value && parts.length === 0 && !schematicFacts && <div className="muted">{t("list.specNeedsSchematic")}</div>}
          </div>
          <VirtualList
            items={parts}
            rowHeight={30}
            scrollTo={selectedPart === undefined ? undefined : parts.indexOf(selectedPart)}
            render={(i) => {
              const p = model.parts[i];
              return (
                <button className={`list-row${i === selectedPart ? " selected" : ""}`} onClick={() => onSelect({ kind: "part", part: i }, true)}>
                  <span className="list-name">{p.name}</span>
                  <span className="list-meta">{schematicFacts?.parts.get(p.name.toUpperCase())?.value ?? p.device ?? ""}</span>
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
          <div className="segmented net-kinds" role="radiogroup" aria-label={t("list.netKinds")}>
            {NET_FILTER_KINDS.map((k) => (
              <button key={k} role="radio" aria-checked={netKind === k} className={netKind === k ? "on" : ""} onClick={() => setNetKind(k)}>
                {t(`list.netKind.${k}`)}
              </button>
            ))}
          </div>
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
                  {netKind === "power" && railVolts(n.name) !== undefined && <span className="list-volts">{formatVolts(railVolts(n.name)!, lang)}</span>}
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
