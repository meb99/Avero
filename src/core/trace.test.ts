import { describe, expect, it } from "vitest";
import { BoardModel } from "./board";
import { partLinks, traceNet, type TraceKind } from "./trace";
import type { Board, NetKind, Side } from "./types";

/**
 * A compact board for these tests: nets as [name, kind], parts with the net
 * index of each pin. Everything the model needs besides the net graph is
 * filled in with placeholders. The geometry is irrelevant to tracing.
 */
function make(spec: { nets: [string, NetKind][]; parts: { name: string; device?: string; side?: Side; pins: number[] }[] }): BoardModel {
  const pins: Board["pins"] = [];
  const parts: Board["parts"] = spec.parts.map((p, pi) => {
    const firstPin = pins.length;
    p.pins.forEach((net, i) => pins.push({ part: pi, number: String(i + 1), x: i * 50, y: pi * 50, radius: 10, side: p.side ?? "top", net }));
    return { name: p.name, side: p.side ?? "top", mount: "smd", firstPin, pinCount: p.pins.length, outline: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, device: p.device };
  });
  const nets: Board["nets"] = spec.nets.map(([name, kind], i) => ({
    name,
    kind,
    pins: pins.map((_, pi) => pi).filter((pi) => pins[pi].net === i),
    testPoints: [],
  }));
  return new BoardModel({ format: "brd", formatName: "t", unit: "mil", outline: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, parts, pins, testPoints: [], nets, warnings: [] });
}

/** traceNet as a readable set of "NET:kind@depth" strings. */
const trace = (m: BoardModel, start: number, kinds?: ReadonlySet<TraceKind>) =>
  traceNet(m, start, kinds)
    .map((l) => `${m.nets[l.net].name}:${l.kind}@${l.depth}`)
    .sort();

describe("partLinks: how a part passes a net on", () => {
  it("classifies each kind, and refuses what is no path", () => {
    // Through: an inductor (same supply on both sides).
    const l = make({ nets: [["PP5V", "power"], ["PP5V_F", "power"]], parts: [{ name: "L1", device: "1uH", pins: [0, 1] }] });
    expect(partLinks(l, 0, 0)).toEqual({ kind: "through", nets: [1] });

    // Diode between two nets; a four-pin part named like a diode is no path.
    const d = make({ nets: [["A", "signal"], ["B", "signal"]], parts: [{ name: "D1", pins: [0, 1] }] });
    expect(partLinks(d, 0, 0)).toEqual({ kind: "diode", nets: [1] });

    // Load switch: a transistor with source/drain on two rails, traced from a rail.
    const q = make({ nets: [["PPBUS", "power"], ["PP3V3_SW", "power"], ["EN", "signal"]], parts: [{ name: "Q1", pins: [0, 1, 2] }] });
    expect(partLinks(q, 0, 0)).toEqual({ kind: "switch", nets: [1] });
    // From the gate signal (net 2) it is no path.
    expect(partLinks(q, 0, 2)).toBeNull();

    // Series resistor between two signals; a pull-up to a rail is no path.
    const r = make({ nets: [["CLK", "signal"], ["CLK_T", "signal"]], parts: [{ name: "R1", device: "33", pins: [0, 1] }] });
    expect(partLinks(r, 0, 0)).toEqual({ kind: "resistor", nets: [1] });
    const pull = make({ nets: [["RESET", "signal"], ["PP1V8", "power"]], parts: [{ name: "R2", device: "10k", pins: [0, 1] }] });
    expect(partLinks(pull, 0, 0)).toBeNull();

    // Coupling capacitor between two signals; decoupling to ground is no path.
    const c = make({ nets: [["HDMI_TX", "signal"], ["HDMI_TX_C", "signal"]], parts: [{ name: "C1", device: "0.1uF", pins: [0, 1] }] });
    expect(partLinks(c, 0, 0)).toEqual({ kind: "coupling", nets: [1] });
    const dec = make({ nets: [["PP1V1", "power"], ["GND", "ground"]], parts: [{ name: "C2", device: "1uF", pins: [0, 1] }] });
    expect(partLinks(dec, 0, 0)).toBeNull();
  });

  it("does not invent a path across ground, unconnected or an IC", () => {
    const m = make({
      nets: [["PP3V3", "power"], ["GND", "ground"], ["NC", "unconnected"], ["SDA", "signal"]],
      parts: [{ name: "U1", pins: [0, 1, 2, 3] }, { name: "R1", device: "0R", pins: [0, 1] }],
    });
    // The IC (part 0) passes nothing on.
    expect(partLinks(m, 0, 0)).toBeNull();
    // The 0 Ω part (part 1) whose other pin is ground is no usable path either.
    expect(partLinks(m, 1, 0)).toBeNull();
  });

  it("joins a four-pin coil with two pads per side (same net on two pins)", () => {
    const m = make({ nets: [["PPVIN", "power"], ["PPVOUT", "power"]], parts: [{ name: "L1", device: "FERRITE BEAD", pins: [0, 0, 1, 1] }] });
    expect(partLinks(m, 0, 0)).toEqual({ kind: "through", nets: [1] });
  });
});

describe("traceNet: the signal path across parts", () => {
  it("follows a through chain to its end, with depth", () => {
    const m = make({
      nets: [["PP5V", "power"], ["PP5V_F", "power"], ["PP5V_FF", "power"]],
      parts: [{ name: "F1", device: "FUSE", pins: [0, 1] }, { name: "R1", device: "0R", pins: [1, 2] }],
    });
    expect(trace(m, 0)).toEqual(["PP5V_F:through@1", "PP5V_FF:through@2"]);
  });

  it("stops at ground and unconnected nets", () => {
    const m = make({
      nets: [["SIG", "signal"], ["GND", "ground"], ["NC", "unconnected"]],
      parts: [{ name: "R1", device: "33", pins: [0, 1] }, { name: "R2", device: "33", pins: [0, 2] }],
    });
    expect(trace(m, 0)).toEqual([]);
  });

  it("reaches a parallel-bridged net once, not once per bridge", () => {
    const m = make({
      nets: [["VA", "power"], ["VB", "power"]],
      parts: [{ name: "R1", device: "0R", pins: [0, 1] }, { name: "R2", device: "0R", pins: [0, 1] }],
    });
    const hits = traceNet(m, 0).filter((l) => l.net === 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("through");
  });

  it("treats a part with two pins on the net once (no duplicate step)", () => {
    const m = make({
      nets: [["VA", "power"], ["VB", "power"]],
      // A coil whose two input pads share the net must not yield two links to VB.
      parts: [{ name: "L1", device: "1uH", pins: [0, 0, 1, 1] }],
    });
    expect(traceNet(m, 0).filter((l) => l.net === 1)).toHaveLength(1);
  });

  it("limits the number of non-through hops so a trace stays readable", () => {
    // Four signals in a row, joined by series resistors: R0→R1→R2→R3.
    const m = make({
      nets: [["N0", "signal"], ["N1", "signal"], ["N2", "signal"], ["N3", "signal"]],
      parts: [
        { name: "R1", device: "33", pins: [0, 1] },
        { name: "R2", device: "33", pins: [1, 2] },
        { name: "R3", device: "33", pins: [2, 3] },
      ],
    });
    // Two resistor hops are followed, the third net is beyond the limit.
    expect(trace(m, 0)).toEqual(["N1:resistor@1", "N2:resistor@2"]);
  });

  it("can be limited to one kind of link", () => {
    const m = make({
      nets: [["VA", "power"], ["VB", "power"], ["SIG", "signal"]],
      parts: [{ name: "L1", device: "1uH", pins: [0, 1] }, { name: "D1", pins: [0, 2] }],
    });
    expect(trace(m, 0)).toEqual(["SIG:diode@1", "VB:through@1"]);
    expect(trace(m, 0, new Set<TraceKind>(["through"]))).toEqual(["VB:through@1"]);
  });

  it("returns nothing for a net with no onward path", () => {
    const m = make({ nets: [["LONE", "signal"], ["GND", "ground"]], parts: [{ name: "C1", device: "1uF", pins: [0, 1] }] });
    expect(traceNet(m, 0)).toEqual([]);
  });
});
