import { describe, expect, it } from "vitest";
import type { BoardModel } from "../core/board";
import { chipFor } from "./chips";
import { checkPinout, netFitsPin } from "./pinout";

/** A board with one part whose pins sit on the given nets, numbered as given. */
function board(pins: [number: string, net: string][]): BoardModel {
  const netNames = [...new Set(pins.map(([, n]) => n))];
  return {
    parts: [{ name: "U1", firstPin: 0, pinCount: pins.length }],
    pins: pins.map(([number, net]) => ({ part: 0, number, net: netNames.indexOf(net) })),
    nets: netNames.map((name) => ({ name, kind: /GND/.test(name) ? "ground" : "signal" })),
    fileNetName: (i: number) => netNames[i],
  } as unknown as BoardModel;
}

const driver = chipFor("NCP81253MNTBG_DFN8_2X2")!.pinout!;
// As the Lenovo LA-G132P names the nets of its NCP81253.
const GOOD: [string, string][] = [
  ["1", "BST_VCCSA"],
  ["2", "PWM1_1PH/ICCMAX1"],
  ["3", "DRON_CPU"],
  ["4", "+5VALW"],
  ["5", "LG_VCCSA"],
  ["6", "GND"],
  ["7", "LX_VCCSA"],
  ["8", "UG_VCCSA"],
  ["9", "GND"],
];

describe("pinout check", () => {
  it("fits net names to pin names and their other names", () => {
    const pin = (name: string, aka?: string[]) => ({ name, role: "", aka });
    expect(netFitsPin("LG_CHG", pin("LGATE", ["LG", "DRVL"]))).toBe(true);
    expect(netFitsPin("ACIN_CHG", pin("ACIN"))).toBe(true);
    expect(netFitsPin("PWM1_1PH/ICCMAX1", pin("PWM"))).toBe(true);
    expect(netFitsPin("USB_CHG_ILIM_SEL", pin("ILIM_SEL"))).toBe(true);
    expect(netFitsPin("CS_DDR", pin("CS"))).toBe(true);
    // Short names only as whole words: CSOP is not CS.
    expect(netFitsPin("CSOP_CHG", pin("CS"))).toBe(false);
    expect(netFitsPin("N27336800", pin("FB"))).toBe(false);
  });

  it("confirms a pinout that fits the board, pin by pin", () => {
    const c = checkPinout(board(GOOD), 0, driver);
    expect(c.status).toBe("confirmed");
    expect(c.ground).toEqual({ total: 2, ok: 2 });
    expect(c.names).toEqual({ total: 6, fit: 6 });
    expect(c.byPin.get(4)?.name).toBe("DRVL");
  });

  it("refuses when a datasheet ground pin is not on ground", () => {
    const swapped = GOOD.map(([n, net]) => [n, n === "6" ? "LX_VCCSA" : n === "7" ? "GND" : net] as [string, string]);
    const c = checkPinout(board(swapped), 0, driver);
    expect([c.status, c.reason]).toEqual(["mismatch", "ground"]);
    expect(c.byPin.size).toBe(0);
  });

  it("refuses pins the datasheet does not know", () => {
    const c = checkPinout(board([...GOOD, ["10", "GND"], ["11", "GND"]]), 0, driver);
    expect([c.status, c.reason]).toEqual(["mismatch", "pins"]);
  });

  it("refuses when the net names point elsewhere", () => {
    const named = GOOD.map(([n, net]) => [n, /GND|5VALW/.test(net) ? net : `HDMI_DATA${n}`] as [string, string]);
    expect(checkPinout(board(named), 0, driver).reason).toBe("names");
  });

  it("finds an unnumbered exposed pad as EP or the next number", () => {
    const charger = chipFor("ISL88739AHRZ-T_QFN32_4X4")!.pinout!;
    const pins: [string, string][] = Array.from({ length: 32 }, (_, i) => [String(i + 1), `N${i}`]);
    expect(checkPinout(board([...pins, ["33", "GND"]]), 0, charger).byPin.get(32)?.name).toBe("GND");
    expect(checkPinout(board([...pins, ["EP", "GND"]]), 0, charger).byPin.get(32)?.name).toBe("GND");
    // Ground fits, but no named nets to compare: not more than plausible.
    expect(checkPinout(board([...pins, ["33", "GND"]]), 0, charger).status).toBe("plausible");
  });
});
