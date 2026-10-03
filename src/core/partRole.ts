/**
 * What a part is, from its designator and device text, across the naming
 * schemes of board makers:
 *
 * - Plain letters: C12, R5, L3, D2, Q7, U1, J4, F1, FB2, Y1.
 * - A leading P for the power section (Compal, Quanta, Dell): PC101,
 *   PR4401, PL1801, PJ1501 (jumper), PQ303, PD501, PU4401.
 * - A leading E on Dell EMI parts: EC, ED, EL, ER.
 * - Section letters after the kind (Compal): CG/RG (GPU), LA, LT, QV …
 *
 * The device text wins where it is clear ("JUMP_43X79", "R0402_0OHM",
 * "CHENG_MBK1608121YZF" bead).
 */

export type PartRole =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "ferrite"
  | "fuse"
  | "jumper"
  | "diode"
  | "transistor"
  | "ic"
  | "connector"
  | "crystal"
  | "testpoint"
  | "other";

/** "0", "0R", "0R0", "0.0", "0 OHM", "0Ω" as a field of the device text ("R0402_0OHM", "0_0402_5%"), never "1R0" or "0402". */
const ZERO_OHM = /(^|[_\s-])(0|0\.0+|0R0?)(\s?(OHMS?|Ω|R))?(?=$|[_\s%-])/i;
const JUMPER_DEVICE = /JUMP|JUMPER|NET[_\s-]?TIE|SHORT[_\s-]?PAD|SOLDER[_\s-]?JUMP/i;
const FUSE_DEVICE = /FUSE|POLY[_\s-]?SW|PTC|EFUSE/i;
const BEAD_DEVICE = /BEAD|FERRITE|\bFB[MA]?\d|BLM\d|MPZ\d|HCB\d|FCM\d|MBK\d|\bFBMH|CHENG_MB/i;

/** The letters before the number, with the power/EMI section letter removed. */
export function kindLetters(name: string): string {
  const letters = (/^[A-Za-z]+/.exec(name.trim())?.[0] ?? "").toUpperCase();
  if (letters.length >= 2 && letters[0] === "P" && "CRLJQDUFTY".includes(letters[1])) return letters.slice(1);
  if (letters.length >= 2 && letters[0] === "E" && "CRLD".includes(letters[1])) return letters.slice(1);
  return letters;
}

export function partRole(name: string, device?: string, pinCount = 2): PartRole {
  const dev = device ?? "";
  if (JUMPER_DEVICE.test(dev)) return "jumper";
  if (FUSE_DEVICE.test(dev)) return "fuse";
  if (pinCount === 2 && BEAD_DEVICE.test(dev)) return "ferrite";
  const k = kindLetters(name);
  if (!k) return "other";
  if (/^(TP|TEST)/.test(k)) return "testpoint";
  if (/^(JP|SJ|XW|NT|JMP)/.test(k)) return "jumper";
  if (/^(FB|FL|BEAD)/.test(k)) return "ferrite";
  if (/^(FU|PF)/.test(k) || k === "F") return "fuse";
  if (/^LED/.test(k)) return "diode";
  if (/^L/.test(k)) return "inductor";
  if (/^R/.test(k)) return "resistor";
  if (/^C(?!ON|N\b)/.test(k)) return "capacitor";
  if (/^(D|ZD|CR)/.test(k)) return "diode";
  if (/^Q/.test(k)) return "transistor";
  if (/^(U|IC)/.test(k)) return "ic";
  if (/^(J|CN|CON|USB|HDMI)/.test(k)) return "connector";
  if (/^(Y|X|OSC)/.test(k)) return "crystal";
  return "other";
}

/** A 0 Ω resistor by its device text ("0R", "R0402_0OHM", "0_0402_5%"). */
export function isZeroOhm(device: string | undefined): boolean {
  return !!device && ZERO_OHM.test(device.trim());
}

/**
 * Parts that join their two nets into one for tracing a supply or signal:
 * coils, ferrites, fuses, jumpers and 0 Ω resistors.
 */
export function passesThrough(name: string, device: string | undefined, pinCount: number): boolean {
  if (pinCount !== 2) return false;
  const role = partRole(name, device, pinCount);
  return role === "inductor" || role === "ferrite" || role === "fuse" || role === "jumper" || (role === "resistor" && isZeroOhm(device));
}
