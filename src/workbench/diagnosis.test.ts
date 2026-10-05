import { describe, expect, it } from "vitest";
import type { BoardModel } from "../core/board";
import { judge, noPowerGuide, railVolts } from "./diagnosis";

/** Parts with devices and pins on named nets. */
function board(parts: { name: string; device: string; pins: [string, string][] }[], extraNets: string[] = []): BoardModel {
  const netNames = [...new Set([...parts.flatMap((p) => p.pins.map(([, n]) => n)), ...extraNets])];
  const pins: { part: number; number: string; net: number }[] = [];
  const modelParts = parts.map((p, i) => {
    const firstPin = pins.length;
    for (const [number, net] of p.pins) pins.push({ part: i, number, net: netNames.indexOf(net) });
    return { name: p.name, device: p.device, firstPin, pinCount: p.pins.length };
  });
  return {
    parts: modelParts,
    pins,
    nets: netNames.map((name) => ({ name, kind: /^GND$/.test(name) ? "ground" : "signal" })),
    fileNetName: (i: number) => netNames[i],
  } as unknown as BoardModel;
}

// The ISL88739A as the Lenovo LA-G132P wires it (pins 1–32 plus the pad as 33).
const CHARGER_NETS = [
  "ACIN_CHG", "VCIN1_AC_IN", "SDA_CHG", "SCL_CHG", "PROCHOT_CHG", "AMON_CHG", "BMON_CHG", "PSYS_CPU", "PROG_CHG", "COMP_CHG",
  "CCLIM_CHG", "FSET_CHG", "BATGONE_CHG", "CSON_CHG", "CSOP_CHG", "ACLIM_CHG", "NTC_CHG", "DCIN_CHG", "VDD_CHG", "VDDP_CHG",
  "LG_CHG", "LX_CHG", "UG_CHG", "BST_CHG", "BGATE_CHG", "VBAT_CHG", "OPCP_CHG", "OPCN_CHG", "CMSRC_CHG", "ASGATE_CHG", "CSIN_CHG", "CSIP_CHG", "GND",
];

describe("fault-finding guide", () => {
  it("reads the voltage a rail name states", () => {
    expect(railVolts("+3VALW")).toBe(3.3);
    expect(railVolts("+5VALW")).toBe(5);
    expect(railVolts("+1.05VALW")).toBe(1.05);
    expect(railVolts("+1V8_MAIN")).toBe(1.8);
    expect(railVolts("3D3V_S5")).toBe(3.3);
    expect(railVolts("1D05V_VCCPRIM_CORE")).toBe(1.05);
    expect(railVolts("0D95V_VCCIO")).toBe(0.95);
    expect(railVolts("DDR_VTT")).toBeUndefined();
    expect(railVolts("+19VB")).toBe(19);
    expect(railVolts("+0.6VSP")).toBe(0.6);
    expect(railVolts("PP1V8_S0")).toBe(1.8);
    expect(railVolts("PP3V3_HDMI")).toBe(3.3);
    expect(railVolts("P5V_HDMI")).toBe(5);
    expect(railVolts("PPBUS_G3H")).toBeUndefined();
    expect(railVolts("EN_3V")).toBeUndefined();
    expect(railVolts("VIN_3/5V")).toBeUndefined();
  });

  it("judges readings against what a point expects", () => {
    expect(judge({ kind: "volts", volts: 3.3 }, 3.28)).toBe("ok");
    expect(judge({ kind: "volts", volts: 3.3 }, 2.9)).toBe("bad");
    expect(judge({ kind: "range", min: 2, max: 3.5 }, 3.6)).toBe("bad");
    expect(judge({ kind: "high" }, 3.3)).toBe("ok");
    expect(judge({ kind: "high" }, 0.02)).toBe("bad");
    expect(judge({ kind: "present" }, "OL")).toBe("bad");
    expect(judge({ kind: "volts", volts: 5 }, undefined)).toBeUndefined();
  });

  it("finds the measuring points of the board, each once", () => {
    const model = board(
      [
        { name: "PU301", device: "ISL88739AHRZ-T_QFN32_4X4", pins: CHARGER_NETS.map((n, i) => [String(i + 1), n] as [string, string]) },
        { name: "U11", device: "KB9542Q-B_LQFP128_14X14", pins: [["1", "+3VALW_EC"], ["2", "EN_5VALW"], ["3", "EC_RST#"], ["4", "PCI_RST#"], ["5", "GND"]] },
      ],
      ["+19V_VIN", "+19VB", "+3VALW", "+5VALW", "+RTCVCC", "PBTN_OUT#", "PM_SLP_S3#", "VR_PWRGD"],
    );
    const steps = noPowerGuide(model);
    const by = (id: string) => steps.find((s) => s.id === id)!.points.map((p) => [p.name, p.expect.kind, p.source]);
    expect(by("adapter")).toEqual([["+19V_VIN", "range", "name"]]);
    // From the datasheet: ACIN 2–3.5 V, ACOK high, VDD and VDDP 5 V.
    expect(by("charger")).toEqual([
      ["ACIN_CHG", "range", "datasheet"],
      ["VCIN1_AC_IN", "high", "datasheet"],
      ["VDD_CHG", "volts", "datasheet"],
      ["VDDP_CHG", "volts", "datasheet"],
    ]);
    expect(by("system")).toEqual([["+19VB", "present", "name"]]);
    expect(by("always").map(([n]) => n)).toEqual(["+3VALW", "+5VALW", "+RTCVCC"]);
    // The EC's own supply and reset — not the enable it drives, not other resets.
    expect(by("ec")).toEqual([
      ["+3VALW_EC", "volts", "name"],
      ["EC_RST#", "high", "standard"],
    ]);
    expect(by("button")).toEqual([["PBTN_OUT#", "high", "standard"]]);
    expect(by("sequence").map(([n]) => n)).toEqual(["PM_SLP_S3#", "VR_PWRGD"]);
    // No chips for these steps on this board: they stay, empty.
    expect(by("memory")).toEqual([]);
    const all = steps.flatMap((s) => s.points.map((p) => p.net));
    expect(new Set(all).size).toBe(all.length);
  });
});
