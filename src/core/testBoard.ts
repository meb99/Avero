import type { Board, Pin } from "./types";

/**
 * A tiny board for unit tests: a two-pin resistor on top, a four-pin chip on
 * the bottom and one test point.
 */
export function testBoard(): Board {
  const pin = (part: number, number: string, x: number, y: number, net: number, side: Pin["side"]): Pin => ({
    part,
    number,
    x,
    y,
    radius: 10,
    side,
    net,
  });
  return {
    format: "brd",
    formatName: "Test_Link BRD",
    unit: "mil",
    outline: [
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 500 },
        { x: 0, y: 500 },
      ],
    ],
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 500 },
    parts: [
      {
        name: "R1",
        side: "top",
        mount: "smd",
        firstPin: 0,
        pinCount: 2,
        outline: [
          { x: 80, y: 85 },
          { x: 170, y: 85 },
          { x: 170, y: 115 },
          { x: 80, y: 115 },
        ],
        bounds: { minX: 80, minY: 85, maxX: 170, maxY: 115 },
        device: "10k",
      },
      {
        name: "U10",
        side: "bottom",
        mount: "smd",
        firstPin: 2,
        pinCount: 4,
        outline: [
          { x: 380, y: 180 },
          { x: 520, y: 180 },
          { x: 520, y: 320 },
          { x: 380, y: 320 },
        ],
        bounds: { minX: 380, minY: 180, maxX: 520, maxY: 320 },
      },
      {
        name: "L5",
        side: "top",
        mount: "smd",
        firstPin: 6,
        pinCount: 2,
        outline: [],
        bounds: { minX: 590, minY: 90, maxX: 670, maxY: 110 },
        device: "1uH",
      },
      {
        name: "R9",
        side: "top",
        mount: "smd",
        firstPin: 8,
        pinCount: 2,
        outline: [],
        bounds: { minX: 790, minY: 90, maxX: 870, maxY: 110 },
        device: "0R 0402",
      },
    ],
    pins: [
      pin(0, "1", 100, 100, 0, "top"),
      pin(0, "2", 150, 100, 1, "top"),
      pin(1, "1", 400, 200, 0, "bottom"),
      pin(1, "2", 500, 200, 1, "bottom"),
      pin(1, "A3", 400, 300, 2, "bottom"),
      pin(1, "4", 500, 300, 3, "bottom"),
      pin(2, "1", 600, 100, 0, "top"),
      pin(2, "2", 660, 100, 4, "top"),
      pin(3, "1", 800, 100, 4, "top"),
      pin(3, "2", 860, 100, 5, "top"),
    ],
    testPoints: [{ kind: "nail", x: 700, y: 400, radius: 15, side: "bottom", net: 0, probe: 7 }],
    nets: [
      { name: "PP3V3", kind: "power", pins: [0, 2, 6], testPoints: [0] },
      { name: "GND", kind: "ground", pins: [1, 3], testPoints: [] },
      { name: "I2C_SDA", kind: "signal", pins: [4], testPoints: [] },
      { name: "UNCONNECTED", kind: "unconnected", pins: [5], testPoints: [] },
      { name: "PP3V3_L", kind: "power", pins: [7, 8], testPoints: [] },
      { name: "PP3V3_R", kind: "power", pins: [9], testPoints: [] },
    ],
    warnings: [],
  };
}
