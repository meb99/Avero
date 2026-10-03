import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import { netsCsv, partsCsv, readingsCsv } from "./csvExport";
import { emptyNotes } from "./notes";

const text = (b: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);

describe("CSV export", () => {
  const model = new BoardModel(testBoard());
  it("lists parts and nets with a header, semicolons and a BOM", () => {
    const parts = text(partsCsv(model, null));
    expect(parts.startsWith("﻿Part;Device;Value")).toBe(true);
    expect(parts.split("\r\n").length).toBe(model.parts.length + 2);
    expect(text(netsCsv(model))).toContain("PP3V3;");
  });

  it("writes readings with decimal commas and quotes when needed", () => {
    const notes = { ...emptyNotes("k", "x"), reference: { PP3V3: { diode: 0.452, voltage: 3.3, note: 'a; "b"' } } };
    const out = text(readingsCsv(notes));
    expect(out).toContain("PP3V3;0,452;3,3;;");
    expect(out).toContain('"a; ""b"""');
  });
});
