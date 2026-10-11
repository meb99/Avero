/**
 * The board session: what the sidebar's tabs know about the active board and what they can
 * do with it – board, selection, notes, settings and the jumps (schematic, bookmarks,
 * markers). Set once by the app; the tabs read it instead of having it handed down.
 * See GLOSSARY.md: Board-Sitzung.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { BoardModel, ViewSide } from "../core/board";
import type { NetKind, Selection } from "../core/types";
import type { ObdData } from "../knowledge/obdata";
import type { Palette, RGBA } from "../render/palette";
import type { SchematicDocument } from "../schematic/document";
import type { SchematicFacts } from "../schematic/partInfo";
import type { Settings } from "../settings";
import type { Datasheet } from "../workbench/datasheets";
import type { BoardNotes, Bookmark } from "../workbench/notes";
import type { CrossHit } from "./Details";

export interface BoardSession {
  model: BoardModel;
  selection: Selection;
  side: ViewSide;
  settings: Settings;
  notes: BoardNotes | null;
  notesError: string | null;
  updateNotes(change: (n: BoardNotes) => BoardNotes): void;
  onTolerance(t: number): void;
  onSelect(selection: Selection, zoom: boolean): void;
  /** Selects and moves the view there without zooming (FlexBV's "View"). */
  onCenter(selection: Selection): void;
  /** What was selected on this board before, newest first (the selection history). */
  history: readonly Selection[];
  palette: Palette;
  hiddenLayers: ReadonlySet<number>;
  onHiddenLayers(hidden: ReadonlySet<number>): void;
  /** The board's open documents, the one shown first. */
  documents: SchematicDocument[];
  onSchematicJump(text: string, hit: number, doc: SchematicDocument): void;
  /** Gives a net its own name; returns an error message or null. */
  onRenameNet(net: number, name: string): string | null;
  /** Corrects the net's kind (undefined: back to the file's). */
  onSetNetKind?(net: number, kind: NetKind | undefined): void;
  /** Where a pin continues on another board of the device (see project.ts). */
  crossBoard?(pin: number): CrossHit[];
  onCrossBoard?(path: string, part: string, pin: string): void;
  /** Changes when net names change, so name-sorted lists refresh. */
  namesRevision: number;
  /** Nets pinned in their own colours on the board. */
  pinnedNets: ReadonlyMap<number, RGBA>;
  onTogglePin(net: number): void;
  /** Pins a set of nets in their own colours (a traced signal path). */
  onPinNets(nets: number[]): void;
  /** Parts marked on the board from the sidebar (same type, short candidates), with what they are. */
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
  /** Opens the ball map of a BGA. */
  onOpenBga(part: number): void;
  /** Looks for the part on the other boards of the library. */
  onFindDonors(part: number): void;
  /** Stored datasheets, and opening, adding or removing one. */
  datasheets: readonly Datasheet[];
  onOpenDatasheet(sheet: Datasheet, page?: number): void;
  onAddDatasheet(part: number): void;
  onRemoveDatasheet(sheet: Datasheet): void;
  /** The measuring list's point to show (next point by key). */
  listFocus?: { listId: string; index: number; n: number } | null;
}

const BoardSessionContext = createContext<BoardSession | null>(null);

export function BoardSessionProvider({ value, children }: { value: BoardSession; children: ReactNode }) {
  return <BoardSessionContext.Provider value={value}>{children}</BoardSessionContext.Provider>;
}

/** The session of the active board; only inside the provider (the sidebar's tabs). */
export function useBoardSession(): BoardSession {
  const session = useContext(BoardSessionContext);
  if (!session) throw new Error("useBoardSession outside a BoardSessionProvider");
  return session;
}
