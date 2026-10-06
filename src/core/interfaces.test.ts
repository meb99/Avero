import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { findInterfaces } from "./interfaces";
import type { Board, Part, Pin } from "./types";

/** A USB-C port: ESD diodes and AC caps on a TX pair, a CMC and ESD array on USB 2, a PD chip on CC; an HDMI port with an open TMDS pin. */
function board(): Board {
  const parts: Part[] = [];
  const pins: Pin[] = [];
  const nets: Board["nets"] = [];
  const net = (name: string, kind: "signal" | "power" | "ground" | "unconnected" = "signal") => {
    let i = nets.findIndex((n) => n.name === name);
    if (i < 0) i = nets.push({ name, kind, pins: [], testPoints: [] }) - 1;
    return i;
  };
  const part = (name: string, device: string, conns: [string, string, ("signal" | "power" | "ground" | "unconnected")?][]) => {
    const index = parts.length;
    parts.push({ name, device, side: "top", mount: "smd", firstPin: pins.length, pinCount: conns.length, outline: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    for (const [number, n, kind] of conns) {
      const ni = net(n, kind);
      nets[ni].pins.push(pins.length);
      pins.push({ part: index, number, x: 0, y: 0, radius: 5, side: "top", net: ni });
    }
  };
  part("JUSBC1", "TYPE-C 24P", [["A1", "GND", "ground"], ["A2", "TX1_P_C"], ["A4", "VBUS", "power"], ["A5", "CC1"], ["A6", "USB_DP"], ["A7", "USB_DN"], ["A12", "GND", "ground"], ["B5", "CC2"], ["B6", "USB_DP"], ["B7", "USB_DN"]]);
  part("D1", "ESD5V", [["1", "TX1_P_C"], ["2", "GND", "ground"]]);
  part("C1", "0.22U", [["1", "TX1_P_C"], ["2", "TX1_P"]]);
  part("U1", "TBT CONTROLLER", Array.from({ length: 12 }, (_, k): [string, string] => [String(k + 1), k === 0 ? "TX1_P" : k === 1 ? "USB_DP_R" : k === 2 ? "USB_DN_R" : `U1_${k}`]));
  part("L1", "CMC 90R", [["1", "USB_DP"], ["2", "USB_DN"], ["3", "USB_DP_R"], ["4", "USB_DN_R"]]);
  part("D2", "TPD4E05", [["1", "USB_DP"], ["2", "USB_DN"], ["3", "GND", "ground"], ["4", "CC1"], ["5", "CC2"], ["6", "GND", "ground"]]);
  part("U2", "PD CONTROLLER", Array.from({ length: 12 }, (_, k): [string, string] => [String(k + 1), k === 0 ? "CC1" : k === 1 ? "CC2" : `U2_${k}`]));
  part("C2", "10U", [["1", "VBUS", "power"], ["2", "GND", "ground"]]);
  part("JHDMI1", "HDMI 19P", Array.from({ length: 19 }, (_, k): [string, string, ("signal" | "unconnected")?] => [String(k + 1), k === 0 ? "UNCONNECTED" : k === 18 ? "HDMI_HPD" : `HDMI_${k + 1}`, k === 0 ? "unconnected" : undefined]));
  return { format: "test", formatName: "test", unit: "mil", outline: [], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, parts, pins, testPoints: [], nets, warnings: [] } as unknown as Board;
}

describe("interfaces", () => {
  const m = new BoardModel(board());
  const views = findInterfaces(m);
  const usb = views.find((v) => v.kind === "usbc")!;
  const role = (name: string) => usb.members.find((x) => m.parts[x.part].name === name)?.role;
  const signal = (fn: string) => usb.signals.find((s) => s.fn === fn)!;

  it("finds USB-C and HDMI connectors", () => {
    expect(views.map((v) => [v.kind, m.parts[v.connector].name])).toEqual([
      ["usbc", "JUSBC1"],
      ["hdmi", "JHDMI1"],
    ]);
  });

  it("names pins by the standard pinout and keeps both rows of one function together", () => {
    expect(signal("TX1+")).toMatchObject({ why: "standard" });
    expect(signal("D+").pins.map((p) => m.pins[p].number)).toEqual(["A6", "B6"]);
    expect(signal("CC2").pins.map((p) => m.pins[p].number)).toEqual(["B5"]);
  });

  it("walks from each pin through series parts to the chip, with what each part does", () => {
    expect(signal("TX1+").parts.map((p) => m.parts[p].name)).toEqual(["D1", "C1", "U1"]);
    expect(role("D1")).toBe("protection");
    expect(role("C1")).toBe("series");
    expect(role("U1")).toBe("ic");
    expect(role("L1")).toBe("filter");
    expect(role("D2")).toBe("protection");
    expect(role("U2")).toBe("ic");
    expect(role("C2")).toBe("filter");
    // The CMC leads on to the controller.
    expect(signal("D+").parts.map((p) => m.parts[p].name)).toContain("U1");
  });

  it("says when a pin the standard uses has no net in the file", () => {
    const hdmi = views.find((v) => v.kind === "hdmi")!;
    expect(hdmi.signals.find((s) => s.fn === "D2+")).toMatchObject({ open: true, parts: [] });
    expect(hdmi.signals.find((s) => s.fn === "HPD")).toMatchObject({ why: "standard" });
  });
});
