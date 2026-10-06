// Mirrors the serde output of crates/avero-formats/src/model.rs.
// All coordinates are in mils (1/1000 inch), Y pointing up.

export type Side = "top" | "bottom" | "both";
export type Mount = "smd" | "th";
export type NetKind = "signal" | "ground" | "power" | "unconnected";
export type TestPointKind = "nail" | "via";

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Package = "passive" | "inductor" | "diode" | "crystal" | "ic" | "connector";

/** Pad drawn for a part's shape only; no pin, no net. */
export interface PadMark {
  x: number;
  y: number;
  radius: number;
}

export interface Part {
  name: string;
  side: Side;
  mount: Mount;
  firstPin: number;
  pinCount: number;
  outline: Point[];
  bounds: Bounds;
  device?: string;
  /** Only the position is known: drawn as a marker, not as a body. */
  marker?: boolean;
  package?: Package;
  /** Body, side, pads and pins were estimated from the copper. */
  estimated?: boolean;
  pads?: PadMark[];
}

/** Shape of a pad that is no circle: size in mils, rotation in degrees, rounded ends. */
export interface PadShape {
  w: number;
  h: number;
  angle: number;
  round: boolean;
}

export interface Pin {
  part: number;
  number: string;
  name?: string;
  x: number;
  y: number;
  radius: number;
  side: Side;
  net: number;
  probe?: number;
  /** Pad shape where the file gives one; otherwise a circle of `radius`. */
  pad?: PadShape;
}

export interface TestPoint {
  kind: TestPointKind;
  x: number;
  y: number;
  radius: number;
  side: Side;
  net: number;
  probe?: number;
  /** Label such as TP1203, when the format has one. */
  name?: string;
  /** Actual padstack, for distinguishing blind/buried vias from surface pads. */
  via?: { layers: string[]; drill: number; buried: boolean };
}

/** Straight copper track segment, from formats that carry routing. */
export interface Trace {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  /** Outer layer; "both" marks an inner layer. */
  side: Side;
  /** Index into Board.layers. */
  layer: number;
  net: number;
}

/** Copper layer that carries traces; "both" marks an inner layer. */
export interface Layer {
  name: string;
  side: Side;
}

export interface Net {
  name: string;
  kind: NetKind;
  pins: number[];
  testPoints: number[];
  traces?: number[];
  /** Ground by its vias across the whole board, not by its name. */
  assumedGround?: boolean;
}

export interface Board {
  format: string;
  formatName: string;
  unit: "mil";
  outline: Point[][];
  bounds: Bounds;
  parts: Part[];
  pins: Pin[];
  testPoints: TestPoint[];
  /** Copper tracks; missing or empty for most formats. */
  traces?: Trace[];
  /** Layers of the traces, top first. */
  layers?: Layer[];
  nets: Net[];
  warnings: string[];
  /** Encrypted parts left out (XinZhiZao without key). */
  lockedParts?: number;
  /** What Avero added or reconstructed rather than read from the file. */
  derived?: { what: string; how: string; count: number }[];
  /** Readings the file itself carries, per pin (XZZ: diode values). */
  readings?: FileReading[];
}

/** A reading stored in the board file for one pin, as the file has it. */
export interface FileReading {
  part: string;
  pin: string;
  quantity: "diode";
  /** Volts; null is open (OL). */
  value: number | null;
  /** As written in the file ("480", "OL"). */
  raw: string;
  /** The file's name for the list ("阻值"). */
  list: string;
  /** Original format, preserved when the enclosing board was converted. */
  sourceFormat?: string;
}

export type LoadErrorCode =
  | "empty"
  | "too-large"
  | "unrecognized"
  | "pdf"
  | "unsupported"
  | "needs-asc-files"
  | "invalid"
  | "no-content"
  | "io"
  | "schematic"
  | "needs-key"
  | "invalid-key"
  | "needs-fz-key"
  | "invalid-fz-key"
  | "needs-cae-key"
  | "invalid-cae-key"
  | "xzz-all-locked"
  | "internal";

export interface LoadError {
  code: LoadErrorCode;
  message: string;
  format?: string;
}

export type LoadResult = { ok: true; board: Board } | { ok: false; error: LoadError };

/** What the user is looking at: which side, and what is selected. */
export type Selection =
  | { kind: "none" }
  | { kind: "part"; part: number }
  | { kind: "pin"; pin: number }
  | { kind: "testPoint"; testPoint: number }
  | { kind: "net"; net: number };

export const MILS_PER_MM = 1000 / 25.4;
