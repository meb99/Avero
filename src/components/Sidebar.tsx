import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { HistoryList, NetSection, PartsSection, partsSelected } from "./InfoSections";
import { Diagnosis } from "./Diagnosis";
import { Interfaces } from "./Interfaces";
import { PowerTree } from "./PowerTree";
import { HiddenParts } from "./HiddenParts";
import { MultiSelection } from "./MultiSelection";
import { matchesQuery, parsePartQuery, partSpecs } from "../core/partSearch";
import type { Net } from "../core/types";
import { partRole, type PartRole } from "../core/partRole";
import { useI18n } from "../i18n";
import { showsExtra } from "../settings";
import { Workbench } from "./Workbench";
import { Details } from "./Details";
import { useBoardSession } from "./BoardSession";
import { VirtualList } from "./VirtualList";
import { LayerList } from "./LayerList";
import { NOT_A_RAIL } from "../workbench/consoleGuides";
import { railVolts } from "../workbench/diagnosis";

/** Sections open when first shown, as in FlexBV: the net and the parts selected. */
const OPEN_FIRST = new Set(["net", "parts"]);
const OPEN_KEY = "avero.sections.v1";

/** Which sections were opened or closed, kept per Mac (a convenience; may be unavailable). */
function loadOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function saveOpen(open: Record<string, boolean>): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  } catch {
    // Not kept then.
  }
}

/** The section a former sidebar tab lives in now. */
const SECTION_OF: Record<SidebarTab, string> = {
  details: "details",
  parts: "partsList",
  nets: "netsList",
  layers: "layers",
  knowledge: "knowledge",
  measure: "measure",
  diagnose: "diagnose",
};

const PART_FILTER_ROLES: PartRole[] = ["capacitor", "resistor", "inductor", "ferrite", "fuse", "jumper", "diode", "transistor", "ic", "connector", "crystal", "testpoint", "other"];

const NET_FILTER_KINDS = ["all", "power", "ground", "signal"] as const;
type NetFilterKind = (typeof NET_FILTER_KINDS)[number];

/** A supply rail: a power net, or one named like a voltage, but no enable or power-good line. */
function isRail(n: Net): boolean {
  return n.kind !== "ground" && n.kind !== "unconnected" && (n.kind === "power" || railVolts(n.name) !== undefined) && !NOT_A_RAIL.test(n.name);
}

const formatVolts = (v: number, lang: string) => `${v.toLocaleString(lang, { maximumFractionDigits: 3 })} V`;

export type SidebarTab = "details" | "parts" | "nets" | "layers" | "knowledge" | "measure" | "diagnose";
export const SIDEBAR_TABS: readonly SidebarTab[] = ["details", "parts", "nets", "layers", "knowledge", "measure", "diagnose"];

interface Props {
  /** Shows a tab from outside (next measuring point by key). */
  tabRequest?: { tab: SidebarTab; n: number } | null;
  /** Told which tab is shown (layouts remember it). */
  onTabChange?(tab: SidebarTab): void;
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

export function Sidebar({ tabRequest, onTabChange, knowledge, knowledgeCount, width, onWidth, collapsed, onCollapsed }: Props) {
  const {
    model,
    selection,
    settings,
    notes,
    updateNotes,
    onSelect,
    palette,
    hiddenLayers,
    onHiddenLayers,
    namesRevision,
    marked,
    onMarkParts,
    schematicFacts,
    multiParts,
    onMultiParts,
    history,
    onShowBookmark,
    onAddBookmark,
  } = useBoardSession();
  const asideRef = useRef<HTMLElement>(null);
  const { t, lang } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);
  const isOpen = (id: string) => open[id] ?? OPEN_FIRST.has(id);
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = { ...o, [id]: !(o[id] ?? OPEN_FIRST.has(id)) };
      saveOpen(next);
      return next;
    });
  // A former tab asked for from outside (next measuring point, value field, layout): its section opens and comes into view.
  useEffect(() => {
    if (!tabRequest) return;
    const id = SECTION_OF[tabRequest.tab];
    setOpen((o) => ({ ...o, [id]: true }));
    onTabChange?.(tabRequest.tab);
    requestAnimationFrame(() => bodyRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: "start" }));
  }, [tabRequest?.n]);
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

  // What is on screen: the FlexBV sections for what is selected, then Avero's tools; the
  // workshop's only at the workshop level or where they have something (knowledge about the
  // board, readings or a case).
  const hasReadings = !!notes && (Object.keys(notes.reference).length > 0 || notes.cases.length > 0 || Object.keys(notes.referencePoints ?? {}).length > 0);
  const chosen = partsSelected(model, selection, multiParts);
  const bookmarks = notes?.bookmarks ?? [];

  // Folded: a narrow strip; a click opens the panel again.
  if (collapsed)
    return (
      <aside className="sidebar collapsed" aria-label={t("sidebar.label")}>
        <button className="tool icon-only sidebar-fold" onClick={() => onCollapsed(false)} title={t("sidebar.expand")} aria-label={t("sidebar.expand")}>
          <ChevronLeftIcon />
        </button>
        <button className="sidebar-strip" onClick={() => onCollapsed(false)}>
          {t("info.title")}
        </button>
      </aside>
    );

  const widthAt = (clientX: number) => {
    const right = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, right - clientX)));
  };

  const section = (id: string, title: ReactNode, body: () => ReactNode, className = "") => (
    <section className={`info-section ${className}`} data-section={id} key={id}>
      <button className="section-head" aria-expanded={isOpen(id)} onClick={() => toggle(id)}>
        {title}
      </button>
      {isOpen(id) && <div className="section-body">{body()}</div>}
    </section>
  );

  return (
    <aside className="sidebar info-panel" ref={asideRef} style={{ width }}>
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
      <button className="tool icon-only sidebar-fold info-fold" onClick={() => onCollapsed(true)} title={t("sidebar.collapse")} aria-label={t("sidebar.collapse")}>
        <ChevronRightIcon />
      </button>
      <div className="panel scroll info-sections" ref={bodyRef}>
        {section("history", t("info.history", { n: history.length }), () => <HistoryList />)}
        {selectedNet !== undefined &&
          section(
            "net",
            <>
              {t("info.net")} <span className="section-pill">{model.nets[selectedNet].name}</span>
            </>,
            () => <NetSection net={selectedNet} />,
          )}
        {notes &&
          section("bookmarks", t("info.bookmarks", { n: bookmarks.length }), () => (
            <div className="info-bookmarks">
              <ul className="info-list">
                {bookmarks.map((b) => (
                  <li key={b.id}>
                    <button className="link" onClick={() => onShowBookmark(b)}>
                      {b.name}
                    </button>
                  </li>
                ))}
              </ul>
              <button className="small" onClick={onAddBookmark}>
                {t("bookmark.add")}
              </button>
            </div>
          ))}
        {(showsExtra(settings, "knowledge") || knowledgeCount > 0) && section("knowledge", t("info.knowledge", { n: knowledgeCount }), () => knowledge)}
        {chosen.length > 0 && section("parts", t("info.parts", { n: chosen.length }), () => <PartsSection parts={chosen} />)}
        {(selection.kind !== "none" || multiParts.length >= 2) &&
          section("details", t("info.details"), () => (
            <>
              {multiParts.length >= 2 && (
                <MultiSelection
                  model={model}
                  parts={multiParts}
                  onSelect={onSelect}
                  onRemove={(p) => onMultiParts(multiParts.filter((x) => x !== p))}
                  onClear={() => onMultiParts([])}
                />
              )}
              <Details />
            </>
          ))}
        {section("partsList", t("info.partsList", { n: model.parts.length }), () => (
          <div className="list-panel section-list">
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
              rowHeight={26}
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
        ))}
        {section("netsList", t("info.netsList", { n: model.nets.length }), () => (
          <div className="list-panel section-list">
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
              rowHeight={26}
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
        ))}
        {model.layers.length > 0 &&
          section("layers", t("info.layers", { n: model.layers.length }), () => <LayerList model={model} palette={palette} hidden={hiddenLayers} onChange={onHiddenLayers} />)}
        {notes && (showsExtra(settings, "measure") || hasReadings) && section("measure", t("tab.measure"), () => <Workbench notes={notes} />)}
        {showsExtra(settings, "diagnose") &&
          section("diagnose", t("tab.diagnose"), () => (
            <>
              <PowerTree model={model} notes={notes} schematicFacts={schematicFacts} onSelect={onSelect} update={notes ? updateNotes : undefined} />
              <Interfaces model={model} notes={notes} update={notes ? updateNotes : undefined} onSelect={onSelect} marked={marked} onMarkParts={onMarkParts} multiParts={multiParts} />
              <Diagnosis model={model} notes={notes} update={updateNotes} onSelect={onSelect} schematicFacts={schematicFacts} selection={selection} tolerance={settings.tolerance} />
            </>
          ))}
      </div>
    </aside>
  );
}
