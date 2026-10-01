/**
 * Checks a datasheet pinout against one part of a board before Avero shows
 * pin functions: footprints in board files do not always number pins like
 * the datasheet (merged pads, own numbering), and a wrong label is worse
 * than none.
 *
 * - Every ground pin of the datasheet must sit on a ground net.
 * - Signal pins are compared with the names of their nets (LGATE on
 *   "LG_CHG", ACIN on "ACIN_CHG"); most of them must fit.
 */
import type { BoardModel } from "../core/board";
import type { ChipPin, Pinout } from "./chips";

export type PinoutStatus = "confirmed" | "plausible" | "mismatch";

export interface PinoutCheck {
  status: PinoutStatus;
  /** Datasheet ground pins on the part, and how many of them are on ground. */
  ground: { total: number; ok: number };
  /** Signal pins on named nets, and how many of those nets fit the pin name. */
  names: { total: number; fit: number };
  /** Why the pinout does not fit, for the mismatch message. */
  reason?: "ground" | "pins" | "names";
  /** Datasheet pin of each board pin (by pin index), when the pinout fits. */
  byPin: Map<number, ChipPin>;
}

const GROUND_NAME = /(^|[^A-Z])(P|A|D|S|C)?GND|^VSS|GROUND/i;
/** Nets that carry no name of their own ("N27336800", "UNCONNECTED"). */
const UNNAMED = /^(N\d+|NET\d+|UNCONNECTED|NC|N\/C|\$?\d+)$/i;
/** Board names for an exposed pad. */
const PAD_NUMBERS = new Set(["EP", "PAD", "EPAD", "TP", "THERMAL", "0"]);

const tokens = (name: string) =>
  name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

/** Does a net name fit a pin name or one of its other names? */
export function netFitsPin(netName: string, pin: ChipPin): boolean {
  const words = tokens(netName);
  const candidates = [pin.name, ...(pin.aka ?? [])].map((n) => n.toUpperCase().replace(/[^A-Z0-9_]/g, ""));
  return candidates.some((c) => {
    const parts = c.split("_").filter(Boolean);
    // Multi-word pin names (ILIM_SEL, ZCD_EN): all words in the net name.
    if (parts.length > 1) return parts.every((p) => words.includes(p));
    // Short names must match a whole word; longer ones may lead one (PWM1 for PWM).
    return words.some((w) => w === c || (c.length >= 3 && w.startsWith(c)));
  });
}

export function checkPinout(model: BoardModel, partIndex: number, pinout: Pinout): PinoutCheck {
  const part = model.parts[partIndex];
  const boardPins = model.pins.slice(part.firstPin, part.firstPin + part.pinCount);
  const numbered = Object.keys(pinout.pins).map(Number).filter((n) => !Number.isNaN(n));
  const maxNumber = Math.max(0, ...numbered);

  // The datasheet pin of each board pin; an unnumbered exposed pad may be "EP" or the next number.
  const byPin = new Map<number, ChipPin>();
  let unknown = 0;
  boardPins.forEach((pin, k) => {
    const number = pin.number.trim().toUpperCase();
    const own = pinout.pins[String(Number(number))] ?? pinout.pins[number];
    if (own) byPin.set(part.firstPin + k, own);
    else if (pinout.pad && (PAD_NUMBERS.has(number) || Number(number) === maxNumber + 1)) byPin.set(part.firstPin + k, pinout.pad);
    else unknown++;
  });

  const isGround = (pinIndex: number) => {
    const net = model.nets[model.pins[pinIndex].net];
    return net.kind === "ground" || !!net.assumedGround || GROUND_NAME.test(net.name) || GROUND_NAME.test(model.fileNetName(model.pins[pinIndex].net));
  };

  let groundTotal = 0;
  let groundOk = 0;
  let namesTotal = 0;
  let namesFit = 0;
  for (const [pinIndex, chipPin] of byPin) {
    if (chipPin.ground) {
      groundTotal++;
      if (isGround(pinIndex)) groundOk++;
      continue;
    }
    if (chipPin.power || chipPin.name === "NC") continue;
    const net = model.pins[pinIndex].net;
    const names = [model.nets[net].name, model.fileNetName(net)];
    if (names.every((n) => UNNAMED.test(n)) || isGround(pinIndex)) continue;
    namesTotal++;
    if (names.some((n) => netFitsPin(n, chipPin))) namesFit++;
  }

  const result = (status: PinoutStatus, reason?: PinoutCheck["reason"]): PinoutCheck => ({
    status,
    ground: { total: groundTotal, ok: groundOk },
    names: { total: namesTotal, fit: namesFit },
    ...(reason && { reason }),
    byPin: status === "mismatch" ? new Map() : byPin,
  });

  // More board pins than the datasheet knows: another package or numbering.
  if (unknown > 0 || byPin.size === 0) return result("mismatch", "pins");
  if (groundTotal > 0 && groundOk < groundTotal) return result("mismatch", "ground");
  if (namesTotal >= 3 && namesFit / namesTotal < 0.4) return result("mismatch", "names");
  if (groundTotal > 0 && namesTotal >= 3 && namesFit / namesTotal >= 0.6) return result("confirmed");
  return result("plausible");
}
