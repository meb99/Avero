import { describe, expect, it } from "vitest";
import type { BoardModel } from "../core/board";
import { translator } from "../i18n";
import { consoleGuides } from "./consoleGuides";

function board(parts: { name: string; device: string; pins: [string, string][] }[]): BoardModel {
  const netNames = [...new Set(parts.flatMap((p) => p.pins.map(([, n]) => n)))];
  const pins: { part: number; number: string; net: number }[] = [];
  const modelParts = parts.map((p, i) => {
    const firstPin = pins.length;
    for (const [number, net] of p.pins) pins.push({ part: i, number, net: netNames.indexOf(net) });
    return { name: p.name, device: p.device, firstPin, pinCount: p.pins.length };
  });
  return {
    parts: modelParts,
    pins,
    nets: netNames.map((name) => ({ name, kind: name === "GND" ? "ground" : /^(PP|\+)/.test(name) ? "power" : "signal" })),
    fileNetName: (i: number) => netNames[i],
  } as unknown as BoardModel;
}

const t = translator("de");

describe("console guides", () => {
  const handheld = board([
    { name: "U1", device: "BM92T36", pins: [["1", "VBUS"], ["2", "CC1"], ["3", "CC2"], ["4", "GND"]] },
    { name: "U2", device: "BQ24193RGER", pins: [["1", "VBUS"], ["13", "VBAT"], ["15", "VSYS"], ["17", "GND"]] },
    { name: "U3", device: "MAX77620", pins: [["1", "VSYS"], ["2", "PP1V8"], ["3", "PP3V3"], ["4", "GND"]] },
  ]);

  it("builds a charging guide for a board with battery and USB input", () => {
    const guides = consoleGuides(handheld, t);
    const charge = guides.find((g) => g.id === "console-charge")!;
    expect(charge.intro).toContain("M92T36 (U1)");
    const short = charge.steps.find((s) => s.id === "c-short")!;
    expect(short.points.map((p) => [p.net, p.quantity, p.expect.kind])).toEqual([
      ["VBUS", "diode", "noShort"],
      ["CC1", "diode", "noShort"],
      ["CC2", "diode", "noShort"],
    ]);
    expect(charge.steps.find((s) => s.id === "c-battery")!.points[0]).toMatchObject({ net: "VBAT", expect: { kind: "range", min: 3, max: 4.4 } });
    // No HDMI on a board without it.
    expect(guides.find((g) => g.id === "console-picture")).toBeUndefined();
  });

  it("checks rails for shorts and by the voltage their names state", () => {
    const off = consoleGuides(handheld, t).find((g) => g.id === "console-off")!;
    const up = off.steps.find((s) => s.id === "o-up")!;
    expect(up.points.find((p) => p.net === "PP1V8")?.expect).toEqual({ kind: "value", value: 1.8, tolerance: 0.1 });
    expect(off.steps[0].points.every((p) => p.quantity === "diode" && p.expect.kind === "noShort")).toBe(true);
  });

  it("builds the HDMI guide for a stationary console without a charging guide", () => {
    const ps = board([
      { name: "IC6002", device: "MN864739", pins: [["1", "PP1V1_HDMI"], ["2", "PP3V3_HDMI"], ["3", "HDMI_TX0_P"], ["4", "HDMI_TX0_N"], ["5", "GND"]] },
      { name: "J1", device: "HDMI", pins: [["1", "HDMI_TX0_P"], ["2", "HDMI_TX0_N"], ["18", "HDMI_5V"], ["19", "HDMI_HPD"], ["15", "HDMI_SCL"], ["16", "HDMI_SDA"], ["5", "GND"]] },
    ]);
    const guides = consoleGuides(ps, t);
    expect(guides.find((g) => g.id === "console-charge")).toBeUndefined();
    const pic = guides.find((g) => g.id === "console-picture")!;
    expect(pic.steps.map((s) => s.id)).toEqual(["v-short", "v-5v", "v-hpd", "v-chip"]);
    expect(pic.steps[0].points.map((p) => p.net)).toEqual(["HDMI_TX0_P", "HDMI_TX0_N", "HDMI_SCL", "HDMI_SDA"]);
    expect(pic.steps[3].points.map((p) => p.net)).toEqual(["PP1V1_HDMI", "PP3V3_HDMI"]);
    expect(pic.intro).toContain("MN864739 (IC6002)");
  });

  it("offers nothing for a board with unnamed nets", () => {
    const plain = board([{ name: "U1", device: "X", pins: [["1", "Net1"], ["2", "Net2"], ["3", "GND"]] }]);
    expect(consoleGuides(plain, t)).toEqual([]);
  });
});

describe("console guides on a notebook", () => {
  it("use neutral titles and no single-cell battery range", () => {
    const nb = board([
      { name: "PU1", device: "X", pins: [["1", "+19V_VIN"], ["2", "VBUS_C"], ["3", "VBAT"], ["4", "GND"]] },
      { name: "U1", device: "Y", pins: [["1", "PM_SLP_S3#"], ["2", "+3VALW"], ["3", "+1V8_MAIN"], ["4", "+3VALW_EN"], ["5", "GND"]] },
    ]);
    const guides = consoleGuides(nb, t);
    const charge = guides.find((g) => g.id === "console-charge")!;
    expect(charge.title).toBe("Lädt nicht über USB-C");
    expect(charge.steps.find((s) => s.id === "c-battery")!.points[0].expect).toEqual({ kind: "present" });
    const off = guides.find((g) => g.id === "console-off")!;
    expect(off.title).toBe("Geht sofort wieder aus");
    expect(off.steps[1].points.map((p) => p.net)).not.toContain("+3VALW_EN");
  });
});
