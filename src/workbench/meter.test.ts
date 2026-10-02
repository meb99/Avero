import { describe, expect, it } from "vitest";
import { parseMeterReading, profileOf } from "./meter";

describe("multimeter answers", () => {
  it("reads SCPI numbers with or without units", () => {
    expect(parseMeterReading("+1.23456E+00\r\n")).toBeCloseTo(1.23456, 9);
    expect(parseMeterReading("4.567E-01 VDC")).toBeCloseTo(0.4567, 9);
    expect(parseMeterReading("-0.0012")).toBeCloseTo(-0.0012, 9);
    expect(parseMeterReading("1.0E+03")).toBe(1000);
  });

  it("takes overload as open", () => {
    expect(parseMeterReading("9.9E37")).toBe("OL");
    expect(parseMeterReading("+1E+9")).toBe("OL");
    expect(parseMeterReading("OL")).toBe("OL");
    expect(parseMeterReading("  O.L ")).toBe("OL");
    expect(parseMeterReading("OVLD")).toBe("OL");
  });

  it("refuses answers without a reading", () => {
    expect(parseMeterReading("")).toBeNull();
    expect(parseMeterReading("OWON,XDM1241,SN,V1")).toBeNull();
    // "VOLT" contains no OL of its own.
    expect(parseMeterReading("VOLT")).toBeNull();
  });

  it("puts own commands over the profile's", () => {
    const p = profileOf({ port: "x", baud: 9600, profile: "owon-xdm", autoConnect: false, read: "FETC?", modes: { voltage: "FUNC VOLT", resistance: "CONF:RES", diode: "CONF:DIOD" } });
    expect(p.read).toBe("FETC?");
    expect(p.modes.voltage).toBe("FUNC VOLT");
    expect(profileOf({ port: "x", baud: 9600, profile: "scpi", autoConnect: false, read: " " }).read).toBe("READ?");
  });
});
