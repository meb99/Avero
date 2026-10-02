import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { compareReadings, formatValue, QUANTITIES, type Reading } from "./measure";
import type { BoardNotes, RepairCase } from "./notes";

/** Texts of the report in the user's language. */
export interface ReportTexts {
  title: string;
  board: string;
  case: string;
  status: string;
  device: string;
  serial: string;
  customer: string;
  created: string;
  notes: string;
  readings: string;
  net: string;
  reference: string;
  measured: string;
  result: string;
  ok: string;
  deviation: string;
  photos: string;
  footer: string;
}

export interface ReportInput {
  notes: BoardNotes;
  repair: RepairCase;
  texts: ReportTexts;
  /** Status in words. */
  statusText: string;
  lang: string;
  tolerance: number;
  /** Decoded photos (canvas), in the case's order; missing ones are skipped. */
  photos: HTMLCanvasElement[];
}

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.13, 0.15, 0.18);
const MUTED = rgb(0.42, 0.46, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const GREEN = rgb(0.1, 0.55, 0.3);
const RED = rgb(0.78, 0.16, 0.16);

/** The standard PDF fonts only know Latin-1-ish text; replace the rest. */
export function safeText(font: PDFFont, text: string): string {
  const replaced = text
    .replace(/Ω/g, "Ohm")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/≈/g, "~")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[\u2009\u202f]/g, " ");
  let out = "";
  for (const ch of replaced) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Lines of `text` that fit `width`, keeping its own line breaks. */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function summary(r: Reading | undefined, lang: string): string {
  if (!r) return "–";
  const short = { diode: "D", voltage: "U", resistance: "R" } as const;
  const parts = QUANTITIES.filter((q) => r[q] !== undefined).map((q) => `${short[q]} ${formatValue(r[q], q, lang)}`);
  return parts.length ? parts.join("  ") : "–";
}

/** Writes pages top to bottom and starts a new page when one is full. */
class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly footer: string,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
    const n = this.pdf.getPageCount();
    const text = safeText(this.regular, `${this.footer} · ${n}`);
    this.page.drawText(text, { x: MARGIN, y: MARGIN / 2, size: 8, font: this.regular, color: MUTED });
  }

  /** Makes room for `height` points, on a new page if needed. */
  need(height: number): void {
    if (this.y - height < MARGIN) this.newPage();
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? PAGE.width - MARGIN - x;
    for (const line of wrap(safeText(font, s), width, (t) => font.widthOfTextAtSize(t, size))) {
      this.need(size * 1.4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size * 1.4;
    }
  }

  rule(): void {
    this.need(8);
    this.y -= 4;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 8;
  }

  heading(s: string): void {
    this.need(40);
    this.y -= 8;
    this.text(s, { size: 13, bold: true });
    this.y -= 2;
  }
}

async function jpegOf(canvas: HTMLCanvasElement, maxSide: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  out.getContext("2d")!.drawImage(canvas, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("photo could not be encoded"))), "image/jpeg", 0.85),
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: out.width, height: out.height };
}

/** A repair report for the customer: device, findings, readings, photos. */
export async function caseReport(input: ReportInput): Promise<Uint8Array> {
  const { notes, repair, texts, lang } = input;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${texts.title} – ${repair.title}`);
  pdf.setProducer("Avero");
  pdf.setCreator("Avero");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const date = (iso: string) => new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(iso));
  const w = new Writer(pdf, regular, bold, `${texts.footer} · ${date(new Date().toISOString())}`);

  w.text(texts.title, { size: 20, bold: true });
  w.text(repair.title, { size: 12, color: MUTED });
  w.rule();

  const facts: [string, string | undefined][] = [
    [texts.board, notes.name !== notes.key ? `${notes.name} (${notes.key})` : notes.key],
    [texts.device, repair.device],
    [texts.serial, repair.serial],
    [texts.customer, repair.customer],
    [texts.status, input.statusText],
    [texts.created, date(repair.created)],
  ];
  for (const [label, value] of facts) {
    if (!value) continue;
    const top = w.y;
    w.text(label, { size: 10, color: MUTED, width: 110 });
    const after = w.y;
    w.y = top;
    w.text(value, { size: 10, x: MARGIN + 120 });
    w.y = Math.min(w.y, after);
  }

  if (repair.notes.trim()) {
    w.heading(texts.notes);
    w.text(repair.notes, { size: 10 });
  }

  const nets = Object.keys(repair.readings)
    .filter((n) => QUANTITIES.some((q) => repair.readings[n][q] !== undefined))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (nets.length > 0) {
    w.heading(texts.readings);
    const cols = [MARGIN, MARGIN + 150, MARGIN + 290, MARGIN + 430];
    const header = () => {
      w.need(18);
      [texts.net, texts.reference, texts.measured, texts.result].forEach((h, i) =>
        w.page.drawText(safeText(bold, h), { x: cols[i], y: w.y - 9, size: 9, font: bold, color: MUTED }),
      );
      w.y -= 16;
    };
    header();
    for (const net of nets) {
      if (w.y - 14 < MARGIN) {
        w.newPage();
        header();
      }
      const measured = repair.readings[net];
      const reference = notes.reference[net];
      const result = compareReadings(reference, measured, input.tolerance);
      const cells = [net, summary(reference, lang), summary(measured, lang)];
      cells.forEach((c, i) => {
        const font = i === 0 ? bold : regular;
        let s = safeText(font, c);
        const max = cols[i + 1] - cols[i] - 8;
        while (s.length > 1 && font.widthOfTextAtSize(s, 9) > max) s = s.slice(0, -2) + "…";
        w.page.drawText(s, { x: cols[i], y: w.y - 9, size: 9, font, color: INK });
      });
      // Readings under different conditions are not judged.
      if (result === "ok" || result === "deviation") {
        w.page.drawText(safeText(bold, result === "ok" ? texts.ok : texts.deviation), {
          x: cols[3],
          y: w.y - 9,
          size: 9,
          font: bold,
          color: result === "ok" ? GREEN : RED,
        });
      }
      w.y -= 14;
      w.page.drawLine({ start: { x: MARGIN, y: w.y + 1 }, end: { x: PAGE.width - MARGIN, y: w.y + 1 }, thickness: 0.3, color: RULE });
    }
  }

  if (input.photos.length > 0) {
    w.heading(texts.photos);
    const width = PAGE.width - 2 * MARGIN;
    for (const canvas of input.photos) {
      const jpeg = await jpegOf(canvas, 1600);
      const image = await pdf.embedJpg(jpeg.bytes);
      const scale = Math.min(width / jpeg.width, 360 / jpeg.height);
      const h = jpeg.height * scale;
      w.need(h + 10);
      w.page.drawImage(image, { x: MARGIN, y: w.y - h, width: jpeg.width * scale, height: h });
      w.y -= h + 10;
    }
  }

  return pdf.save();
}
