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

export interface Part {
  name: string;
  side: Side;
  mount: Mount;
  firstPin: number;
  pinCount: number;
  outline: Point[];
  bounds: Bounds;
  device?: string;
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
}

export interface Net {
  name: string;
  kind: NetKind;
  pins: number[];
  testPoints: number[];
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
  nets: Net[];
  warnings: string[];
  /** Encrypted parts left out (XinZhiZao without key). */
  lockedParts?: number;
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
