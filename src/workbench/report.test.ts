import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { addCase, setValue, updateCase, emptyNotes } from "./notes";
import { caseReport, wrap, type ReportTexts } from "./report";

const texts: ReportTexts = {
  title: "Reparaturbericht",
  board: "Board",
  case: "Fall",
  status: "Status",
  device: "Gerät",
  serial: "Seriennummer",
  customer: "Kunde",
  created: "Angelegt",
  notes: "Befund",
  readings: "Messwerte",
  net: "Netz",
  reference: "Referenz",
  measured: "Gemessen",
  result: "Bewertung",
  ok: "OK",
  deviation: "Abweichung",
  photos: "Fotos",
  footer: "Avero",
};

describe("wrap", () => {
  it("breaks at words and keeps line breaks", () => {
    const measure = (s: string) => s.length;
    expect(wrap("eins zwei drei\nvier", 9, measure)).toEqual(["eins zwei", "drei", "vier"]);
    expect(wrap("überlangeswort", 4, measure)).toEqual(["überlangeswort"]);
  });
});

describe("caseReport", () => {
  it("writes a PDF with readings, umlauts and units outside Latin-1", async () => {
    let n = emptyNotes("820-02100", "820-02100.brd");
    n = setValue(n, "reference", "PP3V3", "resistance", 4700);
    n = addCase(n, "Kein Bild");
    const id = n.activeCase!;
    n = updateCase(n, id, { device: "MacBook Pro A2338", customer: "Müller", notes: "Kurzschluss auf PP3V3 → C123 getauscht" });
    for (let i = 0; i < 80; i++) n = setValue(n, { caseId: id }, `NET_${i}`, "voltage", i / 10);
    n = setValue(n, { caseId: id }, "PP3V3", "resistance", 2);
    const bytes = await caseReport({
      notes: n,
      repair: n.cases[0],
      texts,
      statusText: "Repariert",
      lang: "de",
      tolerance: 0.1,
      photos: [],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    // 81 readings do not fit on one page.
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe("Reparaturbericht – Kein Bild");
  });
});
