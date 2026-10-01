import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { viewPdf } from "./viewPdf";

// 1×1 transparent PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

describe("viewPdf", () => {
  it("puts the view on a landscape page and the notes after it", async () => {
    const bytes = await viewPdf({
      image: PNG,
      title: "820-02100.brd",
      subtitle: "Oberseite",
      notesTitle: "Markierungen",
      notes: ["Oberseite: Kurzschluss gegen Masse → C123"],
      footer: "Avero",
      legend: [{ name: "PP3V3", color: [236, 72, 153] }],
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });
});
