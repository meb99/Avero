import { describe, expect, it } from "vitest";
import { BoardModel } from "../core/board";
import { testBoard } from "../core/testBoard";
import { translator } from "../i18n";
import { hoverDetails } from "./tooltip";

const model = new BoardModel(testBoard());
const t = translator("de");
const rows = (c: ReturnType<typeof hoverDetails>) => Object.fromEntries((c?.rows ?? []).flat());

describe("tooltip as a table", () => {
  it("shows a pin with its net, side, mount and position, then its part", () => {
    const pin = model.pins.findIndex((p) => p.number === "A3");
    const c = hoverDetails(model, { kind: "pin", pin }, { t, lang: "de", units: "mm" });
    expect(c?.rows).toHaveLength(2);
    const r = rows(c);
    expect(r.Pin).toBe("A3");
    expect(r.Netz).toBe("I2C_SDA");
    expect(r.Seite).toBe("Unterseite");
    expect(r.Bestückung).toBe("SMD");
    expect(r.Position).toMatch(/mm/);
    expect(r.Bauteil).toBe("U10");
  });

  it("adds the reference readings of the net and OBData's", () => {
    const pin = model.pins.findIndex((p) => p.number === "A3");
    const c = hoverDetails(model, { kind: "pin", pin }, {
      t,
      lang: "de",
      units: "mm",
      reference: { I2C_SDA: { diode: 0.45, voltage: 3.3 } },
      obdata: { nets: [{ net: "I2C_SDA", kind: "d", value: "0.440", condition: "Default", comment: "" }] } as never,
    });
    expect(c?.readings[0]).toMatchObject({ condition: "Referenz" });
    expect(c?.readings[0].v).toMatch(/3,30/);
    expect(c?.readings[1]).toMatchObject({ condition: "Default", d: "0.440" });
  });

  it("shows a part with its value and pin count", () => {
    const c = hoverDetails(model, { kind: "part", part: 0 }, { t, lang: "de", units: "mm" });
    const r = rows(c);
    expect(r.Bauteil).toBe("R1");
    expect(r.Wert).toBe("10k");
    expect(r.Pins).toBe("2");
    expect(c?.readings).toEqual([]);
  });

  it("has nothing for no hit", () => {
    expect(hoverDetails(model, undefined, { t, lang: "de", units: "mm" })).toBeNull();
  });
});
