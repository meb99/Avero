/**
 * A bench multimeter on a USB serial port: set the function, read the value
 * into the field being measured. Meters that speak SCPI (Owon XDM and many
 * others) work with the built-in profiles; other command sets can be typed
 * in. One meter for the whole app.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { Quantity, Value } from "./measure";

export interface MeterProfile {
  id: string;
  name: string;
  baud: number;
  /** Command that switches to each function. */
  modes: Record<Quantity, string>;
  /** Query for the value on the display. */
  read: string;
}

export const METER_PROFILES: MeterProfile[] = [
  {
    id: "owon-xdm",
    name: "Owon XDM (1041, 1241, 2041 …)",
    baud: 115200,
    modes: { voltage: "CONF:VOLT:DC", resistance: "CONF:RES", diode: "CONF:DIOD" },
    read: "MEAS?",
  },
  {
    id: "scpi",
    name: "SCPI (CONF + READ?)",
    baud: 9600,
    modes: { voltage: "CONF:VOLT:DC", resistance: "CONF:RES", diode: "CONF:DIOD" },
    read: "READ?",
  },
];

export interface MeterSettings {
  port: string;
  baud: number;
  profile: string;
  /** Own commands for a meter the profiles do not fit. */
  modes?: Record<Quantity, string>;
  read?: string;
  /** Connect on start when the port is there. */
  autoConnect: boolean;
}

export function profileOf(s: MeterSettings): MeterProfile {
  const base = METER_PROFILES.find((p) => p.id === s.profile) ?? METER_PROFILES[0];
  return { ...base, modes: { ...base.modes, ...s.modes }, read: s.read?.trim() || base.read };
}

/** SCPI says overload with 9.9E37; others print OL, OVLD, OVER. */
const OVERLOAD = 1e9;

/**
 * A meter's answer as a reading: the number it starts with ("+1.2345E+00 VDC"),
 * "OL" for overload or open. Null when there is no reading in it.
 */
export function parseMeterReading(answer: string): Value | null {
  const text = answer.trim().toUpperCase();
  if (!text) return null;
  if (/\bO\.?L\b|OVLD|OVER|OPEN|INF/.test(text)) return "OL";
  // The reading leads; units may follow ("4.567E-01 VDC").
  const m = /^[-+]?(\d+(\.\d*)?|\.\d+)(E[-+]?\d+)?(?![\w,])/.exec(text);
  if (!m) return null;
  const v = Number(m[0]);
  if (!Number.isFinite(v)) return null;
  return Math.abs(v) >= OVERLOAD ? "OL" : v;
}

// --- connection state ----------------------------------------------------------

export interface MeterState {
  connected: boolean;
  port?: string;
  /** The meter's answer to *IDN?, when it gives one. */
  id?: string;
  busy: boolean;
  error?: string;
}

let state: MeterState = { connected: false, busy: false };
let lastMode: Quantity | null = null;
let profile: MeterProfile = METER_PROFILES[0];
const listeners = new Set<() => void>();

function set(change: Partial<MeterState>) {
  state = { ...state, ...change };
  for (const l of listeners) l();
}

export function useMeter(): MeterState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function meterState(): MeterState {
  return state;
}

export async function connectMeter(s: MeterSettings): Promise<void> {
  set({ busy: true, error: undefined });
  try {
    await invoke("meter_connect", { port: s.port, baud: s.baud });
    profile = profileOf(s);
    lastMode = null;
    // Not every meter answers *IDN?; the connection stands anyway.
    const [id] = await invoke<(string | null)[]>("meter_send", { commands: ["*IDN?"] }).catch(() => [null]);
    set({ connected: true, port: s.port, id: id ?? undefined, busy: false });
  } catch (e) {
    set({ connected: false, busy: false, error: String(e) });
    throw e;
  }
}

export async function disconnectMeter(): Promise<void> {
  await invoke("meter_disconnect").catch(() => {});
  lastMode = null;
  set({ connected: false, port: undefined, id: undefined, error: undefined });
}

/** Switches the meter to the quantity (when it is not already) and reads the display. */
export async function readMeter(quantity: Quantity): Promise<Value> {
  if (!state.connected) throw new Error("no meter connected");
  set({ busy: true, error: undefined });
  try {
    const commands = lastMode === quantity ? [profile.read] : [profile.modes[quantity], profile.read];
    const answers = await invoke<(string | null)[]>("meter_send", { commands });
    lastMode = quantity;
    const answer = answers[answers.length - 1] ?? "";
    const value = parseMeterReading(answer);
    if (value === null) throw new Error(`unexpected answer: ${answer || "(none)"}`);
    set({ busy: false });
    return value;
  } catch (e) {
    lastMode = null;
    set({ busy: false, error: String(e) });
    throw e;
  }
}

export interface PortInfo {
  name: string;
  description: string;
}

export const meterPorts = () => invoke<PortInfo[]>("meter_ports");

/** Event a value field listens for: put this meter reading in. */
export const METER_VALUE_EVENT = "avero-meter-value";

/** Readings in a row that must agree before a value counts as settled. */
export const STABLE_COUNT = 3;

/**
 * Whether the last readings show a settled display: the last
 * `STABLE_COUNT` all OL, or all numbers within 1 % of each other (at least
 * a small absolute step for readings near zero). A display still moving is
 * never taken as the final value.
 */
export function isStable(values: readonly Value[], quantity: Quantity): boolean {
  if (values.length < STABLE_COUNT) return false;
  const last = values.slice(-STABLE_COUNT);
  if (last.every((v) => v === "OL")) return true;
  if (last.some((v) => v === "OL")) return false;
  const nums = last as number[];
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const step = { diode: 0.003, voltage: 0.01, resistance: 0.5 }[quantity];
  return hi - lo <= Math.max(Math.abs(hi) * 0.01, step);
}

/**
 * Reads until the display settles (see isStable), at most `tries` times;
 * `stable: false` with the last reading when it does not.
 */
export async function readStable(quantity: Quantity, tries = 10, pauseMs = 250): Promise<{ value: Value; stable: boolean }> {
  const seen: Value[] = [];
  for (let i = 0; i < tries; i++) {
    seen.push(await readMeter(quantity));
    if (isStable(seen, quantity)) return { value: seen[seen.length - 1], stable: true };
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { value: seen[seen.length - 1], stable: false };
}
