/**
 * Manufacturer datasheets kept in Avero's data folder, assigned to chips by
 * part number, with remembered pages (pinout, electrical tables) to open
 * straight away.
 */
export interface DatasheetPage {
  label: string;
  /** 0-based page index. */
  page: number;
}

export interface Datasheet {
  id: string;
  /** Stored copy in the data folder. */
  file: string;
  title: string;
  /** Part numbers it covers, e.g. "ISL88739", "TPS2546". */
  chips: string[];
  pages: DatasheetPage[];
}

/** Part numbers in a device text, as for the donor search: "ISL88739AHRZ-T_QFN32_4X4" → ["ISL88739AHRZ-T"]. */
export function partNumbers(device: string | undefined): string[] {
  return (device ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 5 && /\d/.test(w) && (w.match(/[A-Z]/g)?.length ?? 0) >= 2)
    .filter((w) => !/^(SOT|QFN|BGA|SOIC|DFN|TSSOP|MSOP|WLCSP|LGA)/.test(w));
}

/** Datasheets for a part: a stored chip number that starts the part's number, or the other way round (ISL88739 ↔ ISL88739AHRZ-T). */
export function datasheetsFor(sheets: readonly Datasheet[], device: string | undefined): Datasheet[] {
  const numbers = partNumbers(device);
  if (numbers.length === 0) return [];
  return sheets.filter((s) =>
    s.chips.some((chip) => {
      const c = chip.trim().toUpperCase();
      return c.length >= 4 && numbers.some((n) => n.startsWith(c) || c.startsWith(n));
    }),
  );
}

export function parseDatasheets(json: string | null): Datasheet[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json) as unknown;
    if (!Array.isArray(data)) return [];
    return data.flatMap((d): Datasheet[] => {
      if (!d || typeof d.id !== "string" || typeof d.file !== "string") return [];
      return [
        {
          id: d.id,
          file: d.file,
          title: typeof d.title === "string" ? d.title : d.file.split("/").pop(),
          chips: Array.isArray(d.chips) ? d.chips.filter((c: unknown) => typeof c === "string" && c.trim()) : [],
          pages: Array.isArray(d.pages)
            ? d.pages.filter((p: { label: unknown; page: unknown }) => typeof p?.label === "string" && Number.isInteger(p?.page) && (p.page as number) >= 0)
            : [],
        },
      ];
    });
  } catch {
    return [];
  }
}

export function newDatasheetId(): string {
  return Math.random().toString(36).slice(2, 10);
}
