/**
 * Readings a board file carries itself (XZZ keeps diode values per pin),
 * found on the board and taken into the reference with their source.
 */
import type { BoardModel } from "../core/board";
import { pinKey } from "../core/points";
import { takeFileReadings, type BoardNotes, type FileImport, type FilePointReading } from "./notes";

/** Where values of the file's list come from, as shown with each value. */
export const fileSource = (format: string, list: string) => `${format} ${list}`.trim();

/** The file's readings at their pins, by source; readings whose pin is not on the board are left out. */
export function fileReadingsOf(model: BoardModel): Map<string, FilePointReading[]> {
  const out = new Map<string, FilePointReading[]>();
  const format = model.board.format === "xzz" ? "XZZ" : model.board.formatName;
  for (const r of model.board.readings ?? []) {
    const part = model.findPart(r.part);
    const pin = part === undefined ? undefined : model.findPin(part, r.pin);
    if (pin === undefined) continue;
    const source = fileSource(format, r.list);
    const list = out.get(source) ?? [];
    list.push({ point: pinKey(model, pin), net: model.fileNetName(model.pins[pin].net), quantity: r.quantity, value: r.value === null ? "OL" : r.value });
    out.set(source, list);
  }
  return out;
}

/** Takes every list of the file into the notes; the counts add up over the lists. */
export function takeAllFileReadings(notes: BoardNotes, model: BoardModel): Omit<FileImport, "already"> & { sources: string[]; total: number } {
  let result = { notes, added: 0, updated: 0, kept: 0, differ: 0, sources: [] as string[], total: 0 };
  for (const [source, entries] of fileReadingsOf(model)) {
    const r = takeFileReadings(result.notes, entries, source);
    result = { notes: r.notes, added: result.added + r.added, updated: result.updated + r.updated, kept: result.kept + r.kept, differ: result.differ + r.differ, sources: [...result.sources, source], total: result.total + entries.length };
  }
  return result;
}
