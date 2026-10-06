/**
 * An interface of a board as one view: the connector's pins by function,
 * and what sits between them and the chips – protection (ESD/TVS),
 * filters (common-mode chokes, ferrites, caps to ground), series parts
 * (resistors, AC coupling caps, level shifters) and the ICs at the end.
 *
 * Found from the copper: a pin's function from the standard pinout of the
 * connector type (HDMI type A pins 1–19, USB-C pins A1–B12) or else from
 * its net name; the parts by walking from each pin's net through series
 * parts until a chip is reached. Everything here is a suggestion to be
 * confirmed – see workbench/groups for what was confirmed and saved.
 */
import { partRole, type PartRole } from "./partRole";
import type { BoardModel } from "./board";

export type InterfaceKind = "hdmi" | "usbc";

/** What a part does for the interface. */
export type MemberRole = "protection" | "filter" | "series" | "pull" | "switch" | "ic" | "other";

export interface InterfaceSignal {
  /** "D2+", "CC1", "VBUS" … */
  fn: string;
  /** By the connector type's standard pinout, or by the net's name. */
  why: "standard" | "name";
  pins: number[];
  /** The connector-side net. */
  net: number;
  /** Parts on the way from the pin, nearest first. */
  parts: number[];
  /** The pin has no net in the file (a pin the standard uses, left open here). */
  open?: boolean;
}

export interface InterfaceMember {
  part: number;
  role: MemberRole;
  /** Functions it serves. */
  fns: string[];
}

export interface InterfaceView {
  kind: InterfaceKind;
  connector: number;
  signals: InterfaceSignal[];
  members: InterfaceMember[];
}

const HDMI_PINS: Record<string, string> = {
  "1": "D2+",
  "3": "D2−",
  "4": "D1+",
  "6": "D1−",
  "7": "D0+",
  "9": "D0−",
  "10": "CLK+",
  "12": "CLK−",
  "13": "CEC",
  "14": "HEAC",
  "15": "SCL",
  "16": "SDA",
  "18": "+5V",
  "19": "HPD",
};

const USBC_PINS: Record<string, string> = {
  A2: "TX1+",
  A3: "TX1−",
  A4: "VBUS",
  A5: "CC1",
  A6: "D+",
  A7: "D−",
  A8: "SBU1",
  A9: "VBUS",
  A10: "RX2−",
  A11: "RX2+",
  B2: "TX2+",
  B3: "TX2−",
  B4: "VBUS",
  B5: "CC2",
  B6: "D+",
  B7: "D−",
  B8: "SBU2",
  B9: "VBUS",
  B10: "RX1−",
  B11: "RX1+",
};

/** Functions by net name, when the pinout does not apply. */
const NAME_FUNCTIONS: [RegExp, string][] = [
  [/HPD|HOT_?PLUG/i, "HPD"],
  [/CEC/i, "CEC"],
  [/(DDC|CTRL).*(CLK|SCL)|SCL.*DDC/i, "SCL"],
  [/(DDC|CTRL).*(DAT|SDA)|SDA.*DDC/i, "SDA"],
  [/(^|_)CC1($|_)/i, "CC1"],
  [/(^|_)CC2($|_)/i, "CC2"],
  [/SBU1/i, "SBU1"],
  [/SBU2/i, "SBU2"],
  [/VBUS/i, "VBUS"],
  [/USB2?0?.*(_P|DP|D\+)\d*$/i, "D+"],
  [/USB2?0?.*(_N|DN|D-)\d*$/i, "D−"],
];

/** HDMI or USB-C, by the part's name or device, or by what its pins carry. */
export function interfaceKind(model: BoardModel, part: number): InterfaceKind | undefined {
  const p = model.parts[part];
  const text = `${p.name} ${p.device ?? ""}`;
  if (p.pinCount < 8) return undefined;
  if (/HDMI/i.test(text)) return "hdmi";
  if (/TYPE-?C|USB-?C|USBC|TYPEC/i.test(text)) return "usbc";
  if (partRole(p.name, p.device, p.pinCount) !== "connector") return undefined;
  const names = new Set<string>();
  const numbers = new Set<string>();
  for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
    names.add(model.nets[model.pins[i].net].name.toUpperCase());
    numbers.add(model.pins[i].number.toUpperCase());
  }
  const all = [...names].join(" ");
  if (numbers.has("A5") && numbers.has("B5") && /CC1|CC2/.test(all)) return "usbc";
  if ((all.match(/TMDS/g) ?? []).length >= 4) return "hdmi";
  return undefined;
}

/** The interface connectors of a board. */
export function findInterfaces(model: BoardModel): InterfaceView[] {
  const out: InterfaceView[] = [];
  model.parts.forEach((_, part) => {
    const kind = interfaceKind(model, part);
    if (kind) out.push(interfaceView(model, part, kind));
  });
  return out;
}

const skipNet = (model: BoardModel, net: number) => {
  const k = model.nets[net].kind;
  return k === "ground" || k === "unconnected";
};

function netsOf(model: BoardModel, part: number): number[] {
  const p = model.parts[part];
  const out: number[] = [];
  for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) if (!out.includes(model.pins[i].net)) out.push(model.pins[i].net);
  return out;
}

/** Most pins a net behind a series part has (resistor, AC cap, chip pin, a test pad or two). */
const SERIES_NET_PINS = 6;

const PROTECTION = /ESD|TVS|TPD\d|RCLAMP|PESD|ESDA|SP30|AZ\d{4}|IP4\d{3}/i;

/** What a part on a signal's way does, and whether the way goes on through it. */
function roleOf(model: BoardModel, part: number, from: number): { role: MemberRole; through: boolean } {
  const p = model.parts[part];
  const r: PartRole = partRole(p.name, p.device, p.pinCount);
  const nets = netsOf(model, part);
  const others = nets.filter((n) => n !== from);
  const toGround = others.some((n) => model.nets[n].kind === "ground");
  // A signal goes on into a small net (resistor, cap, chip pin); a node shared by many parts is a
  // bias or pull network of several lines, not the way of this one.
  const onward = others.filter((n) => !skipNet(model, n) && model.nets[n].kind !== "power" && model.nets[n].pins.length <= SERIES_NET_PINS);
  if (PROTECTION.test(p.device ?? "") || r === "diode") return { role: "protection", through: false };
  switch (r) {
    case "capacitor":
      return toGround || onward.length === 0 ? { role: "filter", through: false } : { role: "series", through: true };
    case "resistor":
      return onward.length ? { role: "series", through: true } : { role: "pull", through: false };
    case "inductor":
    case "ferrite":
      return { role: "filter", through: onward.length > 0 };
    case "transistor":
      return { role: "switch", through: onward.length > 0 };
    case "ic":
      // Small chips with ground and only this signal's nets: ESD arrays named U.
      return p.pinCount <= 10 && toGround && PROTECTION.test(`${p.device ?? ""}`) ? { role: "protection", through: false } : { role: "ic", through: false };
    default:
      return p.pinCount > 8 ? { role: "ic", through: false } : { role: "other", through: false };
  }
}

/** Steps through series parts at most; chips end the way. */
const MAX_STEPS = 4;

function interfaceView(model: BoardModel, connector: number, kind: InterfaceKind): InterfaceView {
  const c = model.parts[connector];
  const table = kind === "hdmi" ? HDMI_PINS : USBC_PINS;
  // Standard pinout only where the pin names are the standard's (numbers 1–19, A1–B12).
  const numbers = new Set<string>();
  for (let i = c.firstPin; i < c.firstPin + c.pinCount; i++) numbers.add(model.pins[i].number.toUpperCase());
  const standard = kind === "hdmi" ? ["1", "10", "19"].every((n) => numbers.has(n)) : ["A5", "B5", "A12"].every((n) => numbers.has(n));

  // Signals by function, pins of one function together (VBUS, D+ on both rows).
  const byFn = new Map<string, InterfaceSignal>();
  for (let i = c.firstPin; i < c.firstPin + c.pinCount; i++) {
    const pin = model.pins[i];
    if (model.nets[pin.net].kind === "unconnected" && standard && table[pin.number.toUpperCase()]) {
      // Said, not left out: a pin the standard uses has no net in this file.
      const fn = table[pin.number.toUpperCase()];
      const key = `${fn}|open`;
      const s = byFn.get(key) ?? { fn, why: "standard" as const, pins: [], net: pin.net, parts: [], open: true };
      s.pins.push(i);
      byFn.set(key, s);
      continue;
    }
    if (skipNet(model, pin.net)) continue;
    const name = model.nets[pin.net].name;
    let fn = standard ? table[pin.number.toUpperCase()] : undefined;
    let why: InterfaceSignal["why"] = "standard";
    if (!fn) {
      fn = NAME_FUNCTIONS.find(([re]) => re.test(name))?.[1] ?? (kind === "hdmi" ? tmdsFunction(name) : undefined);
      why = "name";
    }
    fn ??= name;
    const key = `${fn}|${pin.net}`;
    const s = byFn.get(key) ?? { fn, why, pins: [], net: pin.net, parts: [] };
    s.pins.push(i);
    byFn.set(key, s);
  }

  const members = new Map<number, InterfaceMember>();
  for (const s of byFn.values()) {
    if (s.open) continue;
    // Breadth first from the pin's net through series parts; power nets are left (VBUS keeps its own).
    const seenNets = new Set<number>([s.net]);
    const seenParts = new Set<number>([connector]);
    let frontier = [s.net];
    for (let step = 0; step < MAX_STEPS && frontier.length; step++) {
      const next: number[] = [];
      for (const net of frontier) {
        // Ground-referenced and large nets (a rail) end the walk past the first step.
        if (step > 0 && (model.nets[net].kind === "power" || model.nets[net].pins.length > 40)) continue;
        for (const pinIndex of model.nets[net].pins) {
          const part = model.pins[pinIndex].part;
          if (seenParts.has(part)) continue;
          seenParts.add(part);
          const { role, through } = roleOf(model, part, net);
          s.parts.push(part);
          const m = members.get(part) ?? { part, role, fns: [] };
          if (!m.fns.includes(s.fn)) m.fns.push(s.fn);
          members.set(part, m);
          if (!through) continue;
          for (const n of netsOf(model, part)) {
            if (seenNets.has(n) || skipNet(model, n)) continue;
            seenNets.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
  }
  const order = (s: InterfaceSignal) => (Object.values(table).indexOf(s.fn) + 1 || 99) * 1000 + s.pins[0];
  return { kind, connector, signals: [...byFn.values()].sort((a, b) => order(a) - order(b)), members: [...members.values()] };
}

/** HDMI data pairs by their net names ("TMDS_R_TX2P" → D2+, "…TXCN" → CLK−). */
function tmdsFunction(name: string): string | undefined {
  const m = /TMDS.*?(?:TX|D|DATA)?([0-2C]|CLK)_?(P|N|\+|-)?$/i.exec(name.replace(/_R(?=_)/i, ""));
  if (!m) return undefined;
  const lane = m[1].toUpperCase() === "C" || m[1].toUpperCase() === "CLK" ? "CLK" : `D${m[1]}`;
  const sign = m[2] ? (/[P+]/i.test(m[2]) ? "+" : "−") : "";
  return `${lane}${sign}`;
}
