/**
 * The power tree of a board: which regulator or switch makes which rail
 * from which. Read from the copper alone, by the usual shapes:
 *
 * - Rails joined by a fuse, coil, ferrite, jumper or 0 Ω resistor are one
 *   supply (+19V_VIN → fuse → +19VB; +5VALWP → jumper → +5VALW).
 * - A switching regulator drives a switch node (a pin net that is no rail)
 *   into a coil whose other side is a rail: its output. Its input is the
 *   highest rail on the chip, on the MOSFETs of that switch node, or behind
 *   a resistor at a chip pin (the VIN filter).
 * - A small chip between two rails is a linear regulator or load switch.
 * - A MOSFET between two rails with its gate on a signal is a load switch.
 *
 * Direction goes from the higher voltage to the lower; between rails of the
 * same voltage from the always-on one (ALW, AON, S5, G3 …) to the switched
 * one (S3, S0, VS …). What cannot be ordered is left out rather than guessed.
 *
 * All of this is read from the copper, not known: each converter says why
 * its input and outputs were taken (`why`), and the other inputs it could
 * have (`inputChoices`). A boost converter, a charger or a charge pump makes
 * a higher voltage from a lower one, so the highest rail is not always the
 * input – corrections with their sources come on top (see workbench/power).
 */
import type { BoardModel } from "./board";
import { partRole, passesThrough } from "./partRole";
import { railVolts } from "../workbench/diagnosis";

/** Enable, power-good and sense lines are named like rails but are none. */
const NOT_A_RAIL = /_(EN|PG|PGOOD|OK|SEN|SNS|FB|ON|DET|ID)$/i;
/** The same words inside a signal's name ("1V8_MAIN_EN_AND"). */
const CONTROL_WORD = /(^|_)(EN|ENABLE|PG|PGOOD|PWRGD|PWROK|SENSE|SNS|DET|CTRL|GATE|ACIN|ACOK|ECOK|ACDET|ACPRN)\d*(_|#|$)/i;
/** Main supply buses named without a voltage (Dell DCBATOUT, PWR_SRC, Apple PPBUS …). */
const BUS_RAIL = /^(DCBATOUT|PWR_?SRC|PPBUS\w*|PPVBAT\w*|VSYS|SYS_?PWR|B\+|VBAT\+?|BATT?\+|VBATT?|ADP_?IN|DC_?IN|VADP|VIN|PPDCIN\w*|VBUS\w*)$/i;
/** A regulator's own bias and reference pins, named like supplies ("PWR_5V_VCC"). */
const BIAS_PIN = /_(VCC|VDD|VDDP|VCCP|LDO\d*|REF|VREF|ILIM|ILMT|CS|CSP|CSN|SS|COMP|RT|TON)$/i;
/** Switch nodes and gate drives of regulators ("LX_5V", "PHASE1", "UG_CHG"). */
const SWITCH_NODE = /(^|_)(LX|SW|SWN|PHASE|PH|BST|BOOT|UG|LG|HG|DH|DL|DRVH|DRVL|UGATE|LGATE|HGATE|BGATE)(\d|_|$)/i;

export interface Supply {
  /** Rails joined through fuses, coils, jumpers and 0 Ω resistors; the first is the main one. */
  nets: number[];
  volts?: number;
}

export type ConverterKind = "regulator" | "linear" | "switch" | "boost" | "charger";

/** Why the copper reading took a converter's input. */
export type InputWhy = "highest" | "mosfet" | "unnamed" | "order";

export interface Converter {
  part: number;
  kind: ConverterKind;
  /** Supply index, or undefined when the source is not found. */
  input?: number;
  outputs: number[];
  /** Enable and power-good nets, by their names on the part's pins. */
  enable?: number;
  powerGood?: number;
  /** Why input and outputs were taken from the copper (absent where set by hand). */
  why?: { input?: InputWhy; outputs?: "coil" | "between" };
  /** Other supplies on the part that could be the input. */
  inputChoices?: number[];
}

export interface PowerTree {
  supplies: Supply[];
  converters: Converter[];
  /** Supply index of every rail net. */
  supplyOf: Map<number, number>;
}

/** How "always on" a rail is by its name: 3 always, 2 sleep, 1 running, 0 unknown. */
export function railRank(name: string): number {
  const n = name.toUpperCase();
  if (/ALW|AON|G3|DSW|S5|STBY|STANDBY|AUX|_A$|RTC|VIN|DCIN|ADP|BATT|VBUS|BUS\b|PPBUS|DCBATOUT|PWR_?SRC|VSYS/.test(n)) return 3;
  if (/S4|S3|SUS|_M$|DDR|SLP/.test(n)) return 2;
  if (/S0|VS\b|VS_|VS$|RUN|_SW|SW$|_ON\b/.test(n)) return 1;
  return 0;
}

const ENABLE = /(^|_)(EN|ENABLE|ON|SHDN|SHDN#|ON_OFF)\d*(_|#|$)/i;
const POWER_GOOD = /(^|_)(PG|PGOOD|PWRGD|PWROK|PWR_OK|POK|PGD)\d*(_|#|$)/i;

/** The part's enable and power-good nets, by name (the first of each). */
function controls(model: BoardModel, part: number): Pick<Converter, "enable" | "powerGood"> {
  const out: Pick<Converter, "enable" | "powerGood"> = {};
  for (const net of partNets(model, part)) {
    const name = model.nets[net].name;
    if (out.powerGood === undefined && POWER_GOOD.test(name)) out.powerGood = net;
    else if (out.enable === undefined && ENABLE.test(name)) out.enable = net;
  }
  return out;
}

function partNets(model: BoardModel, part: number): number[] {
  const p = model.parts[part];
  const out: number[] = [];
  for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
    const net = model.pins[i].net;
    if (!out.includes(net)) out.push(net);
  }
  return out;
}

export function buildPowerTree(model: BoardModel, schematicVolts?: ReadonlyMap<number, number>): PowerTree {
  const volts = (net: number) => railVolts(model.nets[net].name) ?? schematicVolts?.get(net);
  const rail = new Uint8Array(model.nets.length);
  model.nets.forEach((n, i) => {
    if (n.kind === "ground" || n.kind === "unconnected" || NOT_A_RAIL.test(n.name)) return;
    if (CONTROL_WORD.test(n.name) || SWITCH_NODE.test(n.name)) return;
    if (BUS_RAIL.test(n.name)) rail[i] = 1;
    else if (volts(i) !== undefined) rail[i] = 1;
    else if (n.kind === "power" && !BIAS_PIN.test(n.name)) rail[i] = 1;
  });
  const isRail = (net: number) => rail[net] === 1;
  const usable = (net: number) => model.nets[net].kind !== "ground" && model.nets[net].kind !== "unconnected";

  // Supplies: rails joined by pass-through parts (same or unknown voltage).
  const parent = model.nets.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const through = new Set<number>();
  model.parts.forEach((p, i) => {
    const nets = partNets(model, i);
    const [a, b] = nets;
    const both = nets.length === 2 && isRail(a) && isRail(b);
    const va = both ? volts(a) : undefined;
    const vb = both ? volts(b) : undefined;
    if (passesThrough(p.name, p.device, p.pinCount, nets.length)) {
      through.add(i);
      if (!both || (va !== undefined && vb !== undefined && Math.abs(va - vb) > 0.05)) return;
    } else {
      // A resistor between two rails of the same voltage measures current.
      const sense = both && va !== undefined && va === vb && p.pinCount <= 4 && partRole(p.name, p.device, 2) === "resistor";
      if (!sense) return;
    }
    parent[find(a)] = find(b);
  });
  const groups = new Map<number, number[]>();
  model.nets.forEach((_, i) => {
    if (!isRail(i)) return;
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  const supplies: Supply[] = [];
  const supplyOf = new Map<number, number>();
  for (const nets of groups.values()) {
    // Main rail: the one with a voltage and the most pins.
    nets.sort((a, b) => Number(volts(b) !== undefined) - Number(volts(a) !== undefined) || model.nets[b].pins.length - model.nets[a].pins.length);
    const index = supplies.length;
    supplies.push({ nets, volts: nets.map(volts).find((v) => v !== undefined) });
    for (const n of nets) supplyOf.set(n, index);
  }
  const vOf = (s: number) => supplies[s].volts;
  const pinsOf = (s: number) => supplies[s].nets.reduce((n, net) => n + model.nets[net].pins.length, 0);
  const rankOf = (s: number) => Math.max(...supplies[s].nets.map((n) => railRank(model.nets[n].name)));

  /** The supply a net leads to through pass-through parts (a coil's far side). */
  const supplyBehind = (net: number, from: number): number | undefined => {
    for (const pin of model.nets[net].pins) {
      const part = model.pins[pin].part;
      if (part === from || !through.has(part)) continue;
      if (partRole(model.parts[part].name, model.parts[part].device, 2) !== "inductor") continue;
      const other = partNets(model, part).find((n) => n !== net);
      if (other !== undefined && isRail(other)) return supplyOf.get(other);
    }
    return undefined;
  };

  /** Orders two supplies: the source first, or null when it cannot be told. */
  const order = (a: number, b: number): [number, number] | null => {
    const va = vOf(a);
    const vb = vOf(b);
    if (va !== undefined && vb !== undefined && Math.abs(va - vb) > 0.05) return va > vb ? [a, b] : [b, a];
    if ((va === undefined) !== (vb === undefined)) return null;
    const ra = rankOf(a);
    const rb = rankOf(b);
    return ra === rb ? null : ra > rb ? [a, b] : [b, a];
  };

  const converters: Converter[] = [];
  model.parts.forEach((p, part) => {
    if (through.has(part)) return;
    const role = partRole(p.name, p.device, p.pinCount);
    const nets = partNets(model, part);
    const direct = [...new Set(nets.filter(isRail).map((n) => supplyOf.get(n)!))];

    if (role === "transistor") {
      if (direct.length !== 2) return;
      const signals = nets.filter((n) => usable(n) && !isRail(n));
      if (signals.length > 1) return;
      const o = order(direct[0], direct[1]);
      // A MOSFET switch: its gate is the enable.
      if (o) converters.push({ part, kind: "switch", input: o[0], outputs: [o[1]], ...(signals[0] !== undefined && { enable: signals[0] }), why: { input: "order", outputs: "between" } });
      return;
    }
    if (role !== "ic") return;

    // Switch nodes: pin nets that are no rail and feed a coil into a rail.
    const outputs = new Set<number>();
    const candidates = new Set(direct);
    // Rails on the switching MOSFETs: the input even without a voltage in its name (PWR_SRC).
    const drains = new Set<number>();
    for (const n of nets) {
      if (isRail(n) || !usable(n)) continue;
      const out = supplyBehind(n, part);
      if (out === undefined) continue;
      outputs.add(out);
      // The MOSFETs on the switch node carry the input on their other side.
      for (const pin of model.nets[n].pins) {
        const q = model.pins[pin].part;
        if (q === part || partRole(model.parts[q].name, model.parts[q].device, model.parts[q].pinCount) !== "transistor") continue;
        for (const m of partNets(model, q)) if (isRail(m)) drains.add(supplyOf.get(m)!);
      }
    }
    // A resistor from a chip pin to a rail: the input filter (VIN, VCC).
    for (const n of nets) {
      if (isRail(n) || !usable(n) || model.nets[n].pins.length > 4) continue;
      for (const pin of model.nets[n].pins) {
        const r = model.pins[pin].part;
        const rp = model.parts[r];
        if (r === part || rp.pinCount !== 2 || partRole(rp.name, rp.device, 2) !== "resistor") continue;
        const other = partNets(model, r).find((m) => m !== n);
        if (other !== undefined && isRail(other)) candidates.add(supplyOf.get(other)!);
      }
    }

    if (outputs.size > 0) {
      const top = Math.max(...[...outputs].map((s) => vOf(s) ?? 0));
      // Highest voltage first; of equal ones the rail on the switching MOSFETs.
      const inputs = [...new Set([...candidates, ...drains])].filter((s) => !outputs.has(s) && (vOf(s) ?? 0) > top);
      inputs.sort((a, b) => (vOf(b) ?? 0) - (vOf(a) ?? 0) || Number(drains.has(b)) - Number(drains.has(a)) || pinsOf(b) - pinsOf(a));
      // Else a rail without a voltage in its name (PWR_SRC, PPBUS).
      const unnamed = [...new Set([...drains, ...direct])].filter((s) => !outputs.has(s) && vOf(s) === undefined);
      unnamed.sort((a, b) => Number(drains.has(b)) - Number(drains.has(a)) || rankOf(b) - rankOf(a) || pinsOf(b) - pinsOf(a));
      const input = inputs[0] ?? unnamed[0];
      const why: InputWhy | undefined = input === undefined ? undefined : inputs[0] === undefined ? "unnamed" : drains.has(input) ? "mosfet" : "highest";
      const choices = [...new Set([...inputs, ...unnamed, ...direct])].filter((s) => s !== input && !outputs.has(s));
      converters.push({
        part,
        kind: "regulator",
        input,
        outputs: [...outputs],
        ...controls(model, part),
        why: { ...(why && { input: why }), outputs: "coil" },
        ...(choices.length && { inputChoices: choices }),
      });
      return;
    }
    // Linear regulators and load-switch chips: small, between two rails.
    if (p.pinCount > 12 || direct.length !== 2) return;
    const o = order(direct[0], direct[1]);
    if (o) converters.push({ part, kind: "linear", input: o[0], outputs: [o[1]], ...controls(model, part), why: { input: "order", outputs: "between" }, inputChoices: [o[1]] });
  });

  return { supplies, converters, supplyOf };
}

export interface TreeNode {
  supply: number;
  /** The converters fed by this supply, each with the supplies it makes. */
  children: { converter: number; outputs: TreeNode[] }[];
}

/**
 * The tree from the sources down: supplies that feed something but are fed
 * by nothing, highest voltage first. A supply appears once; later mentions
 * (a rail made by two converters, a loop) end there.
 */
export function powerTreeRoots(tree: PowerTree): { roots: TreeNode[]; unfed: number[] } {
  const fed = new Set<number>();
  const feeds = new Map<number, number[]>();
  tree.converters.forEach((c, i) => {
    for (const o of c.outputs) fed.add(o);
    if (c.input !== undefined) feeds.set(c.input, [...(feeds.get(c.input) ?? []), i]);
  });
  const seen = new Set<number>();
  const node = (supply: number): TreeNode => {
    seen.add(supply);
    const children = (feeds.get(supply) ?? []).map((converter) => ({
      converter,
      outputs: tree.converters[converter].outputs.filter((o) => !seen.has(o)).map((o) => node(o)),
    }));
    return { supply, children };
  };
  const volts = (s: number) => tree.supplies[s].volts ?? -1;
  const starts = [...feeds.keys()].filter((s) => !fed.has(s)).sort((a, b) => volts(b) - volts(a));
  const roots = starts.map((s) => node(s));
  // Loops without a source: start from their highest supply.
  for (const s of [...feeds.keys()].sort((a, b) => volts(b) - volts(a))) if (!seen.has(s)) roots.push(node(s));
  const unfed = tree.converters.map((c, i) => (c.input === undefined ? i : -1)).filter((i) => i >= 0);
  return { roots, unfed };
}
