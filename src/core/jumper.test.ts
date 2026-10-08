import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { jumperPlan, jumperTargets, segmentHitsBox, signalClass } from "./jumper";
import type { Board } from "./types";
import { testBoard } from "./testBoard";

describe("jumperTargets", () => {
  const model = new BoardModel(testBoard());

  it("offers the nearest other points of the net, same side first", () => {
    // Pin 0 is R1.1 on PP3V3, which also reaches U10 and a test point.
    const targets = jumperTargets(model, 0);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => !(t.kind === "pin" && model.pins[t.index].part === model.pins[0].part))).toBe(true);
    const sides = targets.map((t) => t.sameSide);
    expect(sides).toEqual([...sides].sort((a, b) => Number(b) - Number(a)));
  });

  it("puts pins under a large package last, however near", () => {
    // A.1 on SIG; a 16-ball part with its centre ball on SIG close by, R.1 on SIG further away.
    const balls = Array.from({ length: 16 }, (_, k) => ({ part: 1, number: String(k + 1), x: 100 + (k % 4) * 100, y: 100 + Math.floor(k / 4) * 100, radius: 8, side: "top" as const, net: k === 5 ? 0 : 1 }));
    const board: Board = {
      format: "brd",
      formatName: "test",
      unit: "mil",
      outline: [],
      bounds: { minX: -100, minY: -100, maxX: 1100, maxY: 500 },
      parts: [
        { name: "A", side: "top", mount: "smd", firstPin: 0, pinCount: 1, outline: [], bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 } },
        { name: "U1", side: "top", mount: "smd", firstPin: 1, pinCount: 16, outline: [], bounds: { minX: 100, minY: 100, maxX: 400, maxY: 400 } },
        { name: "R", side: "top", mount: "smd", firstPin: 17, pinCount: 1, outline: [], bounds: { minX: 990, minY: -10, maxX: 1010, maxY: 10 } },
      ],
      pins: [{ part: 0, number: "1", x: 0, y: 0, radius: 8, side: "top", net: 0 }, ...balls, { part: 2, number: "1", x: 1000, y: 0, radius: 8, side: "top", net: 0 }],
      testPoints: [],
      nets: [
        { name: "SIG", kind: "signal", pins: [0, 6, 17], testPoints: [] },
        { name: "GND", kind: "ground", pins: balls.map((_, k) => k + 1).filter((i) => i !== 6), testPoints: [] },
      ],
      warnings: [],
    };
    const m = new BoardModel(board);
    expect(jumperTargets(m, 0).map((t) => [t.label, t.hidden])).toEqual([
      ["R.1", false],
      ["U1.6", true],
    ]);
  });

  it("keeps the pins of a two-row connector reachable", () => {
    // A 20-pin connector whose body reaches past both rows; pin 3 in the top row is on SIG.
    const pins = Array.from({ length: 20 }, (_, k) => ({ part: 1, number: String(k + 1), x: 100 + Math.floor(k / 2) * 50, y: k % 2 ? 60 : 140, radius: 8, side: "top" as const, net: k === 2 ? 0 : 1 }));
    const board: Board = {
      format: "brd",
      formatName: "test",
      unit: "mil",
      outline: [],
      bounds: { minX: -100, minY: -100, maxX: 700, maxY: 300 },
      parts: [
        { name: "A", side: "top", mount: "smd", firstPin: 0, pinCount: 1, outline: [], bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 } },
        { name: "J1", side: "top", mount: "smd", firstPin: 1, pinCount: 20, outline: [], bounds: { minX: 50, minY: 0, maxX: 600, maxY: 200 } },
      ],
      pins: [{ part: 0, number: "1", x: 0, y: 0, radius: 8, side: "top", net: 0 }, ...pins],
      testPoints: [],
      nets: [
        { name: "SIG", kind: "signal", pins: [0, 3], testPoints: [] },
        { name: "GND", kind: "ground", pins: pins.map((_, k) => k + 1).filter((i) => i !== 3), testPoints: [] },
      ],
      warnings: [],
    };
    expect(jumperTargets(new BoardModel(board), 0).map((t) => [t.label, t.hidden])).toEqual([["J1.3", false]]);
  });

  it("has nothing for ground", () => {
    const ground = model.nets.findIndex((n) => n.kind === "ground");
    expect(jumperTargets(model, model.nets[ground].pins[0])).toEqual([]);
  });
});

describe("jumper plan (F43)", () => {
  // A wire from A.1 to B.1 on SIG, with C sitting right between them and D's pins next to A.
  const part = (name: string, firstPin: number, pinCount: number, b: { minX: number; minY: number; maxX: number; maxY: number }) => ({
    name,
    side: "top" as const,
    mount: "smd" as const,
    firstPin,
    pinCount,
    outline: [],
    bounds: b,
  });
  const pin = (p: number, number: string, x: number, y: number, net: number) => ({ part: p, number, x, y, radius: 8, side: "top" as const, net });
  const board = (netName: string): Board => ({
    format: "brd",
    formatName: "test",
    unit: "mil",
    outline: [],
    bounds: { minX: -200, minY: -400, maxX: 1200, maxY: 400 },
    parts: [
      part("A", 0, 2, { minX: -20, minY: -20, maxX: 20, maxY: 80 }),
      part("B", 2, 2, { minX: 980, minY: -20, maxX: 1020, maxY: 80 }),
      part("C", 4, 2, { minX: 400, minY: -100, maxX: 600, maxY: 100 }),
      part("D", 6, 1, { minX: -10, minY: -50, maxX: 10, maxY: -20 }),
    ],
    pins: [pin(0, "1", 0, 0, 0), pin(0, "2", 0, 60, 2), pin(1, "1", 1000, 0, 0), pin(1, "2", 1000, 60, 2), pin(2, "1", 450, 0, 1), pin(2, "2", 550, 0, 2), pin(3, "1", 0, -30, 1)],
    testPoints: [],
    nets: [
      { name: netName, kind: "signal", pins: [0, 2], testPoints: [] },
      { name: "OTHER", kind: "signal", pins: [4, 6], testPoints: [] },
      { name: "GND", kind: "ground", pins: [1, 3, 5], testPoints: [] },
    ],
    warnings: [],
  });

  it("goes around the part in the way and names both ends, the wire and the neighbours", () => {
    const model = new BoardModel(board("SIG"));
    const plan = jumperPlan(model, 0, { kind: "pin", index: 2 }, "top");
    expect(plan.from.label).toBe("A.1");
    expect(plan.to.label).toBe("B.1");
    expect(plan.inTheWay.map((i) => model.parts[i].name)).toEqual(["C"]);
    expect(plan.crossed).toEqual([]);
    expect(plan.route.length).toBeGreaterThan(2);
    expect(plan.routed).toBeGreaterThan(plan.straight);
    // 1000 mil straight is 25.4 mm; the wire is longer, with slack and both joints.
    expect(plan.wireMm).toBeGreaterThan(25.4 * 1.1 + 3);
    expect(plan.neighbours.map((n) => n.net)).toContain("OTHER");
    expect(plan.signal).toBe("plain");
  });

  it("does not treat high-speed or clock nets as freely interchangeable", () => {
    for (const name of ["USB3_TX1_P", "PCIE_RX0_N", "HDMI_TMDS_D2+", "USB_D+", "EDP_TX0_P", "DDR_DQ12", "MEM_DQS0_T", "CSI0_D1_P", "USB2_DM1"]) expect(signalClass(name)).toBe("highSpeed");
    for (const name of ["CLK_32K", "XTAL_IN", "SYS_OSC"]) expect(signalClass(name)).toBe("clock");
    for (const name of ["PP3V3_S5", "EC_SMB_DAT", "PWRBTN#", "UART_TX", "LID_SW#", "SYS_RST_N", "PWR_EN_N", "SPI_CS_N", "SMC_ONOFF_N", "PPVBAT_P", "DQ_EN", "PCIE_CLKREQ_N", "PCIE_WAKE_N"]) expect(signalClass(name)).toBe("plain");
    expect(jumperPlan(new BoardModel(board("USB3_TX1_P")), 0, { kind: "pin", index: 2 }, "top").signal).toBe("highSpeed");
  });

  it("knows when a segment passes through a box", () => {
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
    expect(segmentHitsBox({ x: -5, y: 15 }, { x: 15, y: 15 }, box)).toBe(false);
    expect(segmentHitsBox({ x: -5, y: -5 }, { x: -1, y: 20 }, box)).toBe(false);
  });
});
