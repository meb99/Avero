import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { safeText, wrap } from "./report";

export interface ViewPdfInput {
  /** PNG of the board view. */
  image: Uint8Array;
  title: string;
  /** Second line: side, date. */
  subtitle: string;
  /** Heading and lines of the board notes listed under the picture. */
  notesTitle: string;
  notes: string[];
  footer: string;
  /** Pinned nets with their colors (0–255). */
  legend?: { name: string; color: readonly number[] }[];
}

/** A4 landscape: the board view with a title, then the board notes. */
export async function viewPdf(input: ViewPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setProducer("Avero");
  pdf.setCreator("Avero");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.15, 0.18);
  const muted = rgb(0.42, 0.46, 0.5);
  const [width, height] = [841.89, 595.28];
  const margin = 36;

  const footer = (page: ReturnType<typeof pdf.addPage>) =>
    page.drawText(safeText(regular, input.footer), { x: margin, y: margin / 2, size: 8, font: regular, color: muted });

  const page = pdf.addPage([width, height]);
  page.drawText(safeText(bold, input.title), { x: margin, y: height - margin - 14, size: 16, font: bold, color: ink });
  page.drawText(safeText(regular, input.subtitle), { x: margin, y: height - margin - 32, size: 10, font: regular, color: muted });
  // Pinned nets, right-aligned in the title area.
  let lx = width - margin;
  for (const { name, color } of [...(input.legend ?? [])].reverse()) {
    const text = safeText(bold, name);
    const w = bold.widthOfTextAtSize(text, 9);
    lx -= w;
    page.drawText(text, { x: lx, y: height - margin - 30, size: 9, font: bold, color: ink });
    lx -= 12;
    page.drawRectangle({ x: lx, y: height - margin - 31, width: 8, height: 8, color: rgb(color[0] / 255, color[1] / 255, color[2] / 255) });
    lx -= 14;
  }
  const image = await pdf.embedPng(input.image);
  const top = height - margin - 44;
  const scale = Math.min((width - 2 * margin) / image.width, (top - margin) / image.height);
  page.drawImage(image, {
    x: (width - image.width * scale) / 2,
    y: top - image.height * scale,
    width: image.width * scale,
    height: image.height * scale,
  });
  footer(page);

  if (input.notes.length > 0) {
    let p = pdf.addPage([width, height]);
    footer(p);
    let y = height - margin;
    p.drawText(safeText(bold, input.notesTitle), { x: margin, y: y - 14, size: 14, font: bold, color: ink });
    y -= 30;
    for (const note of input.notes) {
      for (const line of wrap(safeText(regular, note), width - 2 * margin, (s) => regular.widthOfTextAtSize(s, 10))) {
        if (y - 14 < margin) {
          p = pdf.addPage([width, height]);
          footer(p);
          y = height - margin;
        }
        p.drawText(line, { x: margin, y: y - 10, size: 10, font: regular, color: ink });
        y -= 14;
      }
      y -= 4;
    }
  }
  return pdf.save();
}
