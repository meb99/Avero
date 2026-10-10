/**
 * The tab collection: every open tab, the active one included, behind one interface.
 * Pure: React drives it through `useReducer`; what has side effects (freeing a
 * closed tab's documents, asking the board view where it stands) stays with the caller.
 * See GLOSSARY.md: Reiter, Reiter-Sammlung.
 */
import type { BoardModel, ViewSide } from "./core/board";
import type { BoardSource } from "./core/loader";
import type { Selection } from "./core/types";
import type { ViewState } from "./components/BoardView";
import type { SchematicDocument } from "./schematic/document";

/** Everything that belongs to one tab. */
export interface Tab {
  id: number;
  model: BoardModel | null;
  source: BoardSource | null;
  side: ViewSide;
  rotation: number;
  selection: Selection;
  /** Schematics, datasheets, layouts and revisions open for this board. */
  docs: SchematicDocument[];
  /** The document shown (the others keep their page, zoom and search). */
  docIndex: number;
  schematicVisible: boolean;
  /** Where the board view stood when the tab was left. */
  view?: ViewState;
}

export interface Tabs {
  /** In the order shown, the active one among them. */
  list: Tab[];
  active: number;
  nextId: number;
}

type Change = Partial<Omit<Tab, "id">>;

export type TabsAction =
  /** A new empty tab, made active; `view` is where the tab being left stood. */
  | { type: "new"; view?: ViewState }
  | { type: "switch"; id: number; view?: ViewState }
  /** The next (1) or previous (-1) tab, round the end. */
  | { type: "cycle"; step: number; view?: ViewState }
  /** Closing the active tab makes its neighbour active; closing the last leaves an empty one. */
  | { type: "close"; id: number }
  /** Changes a tab, the active one when no id is given. */
  | { type: "update"; id?: number; change: Change | ((tab: Tab) => Change) };

export const emptyTab = (id: number): Tab => ({
  id,
  model: null,
  source: null,
  side: "top",
  rotation: 0,
  selection: { kind: "none" },
  docs: [],
  docIndex: 0,
  schematicVisible: true,
});

export const initialTabs = (): Tabs => ({ list: [emptyTab(0)], active: 0, nextId: 1 });

export function activeTab(s: Tabs): Tab {
  return s.list.find((t) => t.id === s.active) ?? s.list[0];
}

export function findTab(s: Tabs, test: (tab: Tab) => boolean): Tab | undefined {
  return s.list.find(test);
}

/** The tab showing a board file; `member` picks one board of a project file (none: the file's only board). */
export function tabOfFile(s: Tabs, path: string, member?: string): Tab | undefined {
  return s.list.find((t) => t.source?.path === path && (member ? t.source.projectMember === member : !t.source.projectMember));
}

/** The documents a tab holds, freed by the caller when the tab closes. */
export function releasedOnClose(s: Tabs, id: number): SchematicDocument[] {
  return s.list.find((t) => t.id === id)?.docs ?? [];
}

/** The tab being left keeps where its view stood. */
const leave = (list: Tab[], id: number, view: ViewState | undefined): Tab[] =>
  view === undefined ? list : list.map((t) => (t.id === id ? { ...t, view } : t));

export function tabsReducer(s: Tabs, a: TabsAction): Tabs {
  switch (a.type) {
    case "new": {
      const tab = emptyTab(s.nextId);
      return { list: [...leave(s.list, s.active, a.view), tab], active: tab.id, nextId: s.nextId + 1 };
    }
    case "switch":
      if (a.id === s.active || !s.list.some((t) => t.id === a.id)) return s;
      return { ...s, list: leave(s.list, s.active, a.view), active: a.id };
    case "cycle": {
      if (s.list.length < 2) return s;
      const i = s.list.findIndex((t) => t.id === s.active);
      const next = s.list[(i + a.step + s.list.length) % s.list.length];
      return { ...s, list: leave(s.list, s.active, a.view), active: next.id };
    }
    case "close": {
      const index = s.list.findIndex((t) => t.id === a.id);
      if (index < 0) return s;
      const rest = s.list.filter((t) => t.id !== a.id);
      if (a.id !== s.active) return { ...s, list: rest };
      if (rest.length === 0) {
        const tab = emptyTab(s.nextId);
        return { list: [tab], active: tab.id, nextId: s.nextId + 1 };
      }
      return { ...s, list: rest, active: rest[Math.min(index, rest.length - 1)].id };
    }
    case "update": {
      const id = a.id ?? s.active;
      let changed = false;
      const list = s.list.map((t) => {
        if (t.id !== id) return t;
        const change = typeof a.change === "function" ? a.change(t) : a.change;
        if ((Object.keys(change) as (keyof Change)[]).every((k) => t[k] === change[k])) return t;
        changed = true;
        return { ...t, ...change };
      });
      return changed ? { ...s, list } : s;
    }
  }
}
