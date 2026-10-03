/**
 * Fault-finding guides for consoles and controllers: "lädt nicht",
 * "kein Bild", "geht sofort aus", built for the board in view.
 *
 * As with the notebook guide nothing is guessed: points are nets of the
 * board found by name (VBUS, CC1, HDMI_5V, HPD …) or pins of chips whose
 * datasheet pinout was checked against the board (BQ24193). Voltages come
 * from the name ("PP3V3" 3.3 V) or standards (USB 5 V, HDMI 5 V, HPD high);
 * short checks need no value at all. A guide only appears when the board
 * has what it measures.
 */
import type { BoardModel } from "../core/board";
import { chipFor, type ChipInfo } from "../knowledge/chips";
import { checkPinout } from "../knowledge/pinout";
import type { Translate } from "../i18n";
import { railVolts } from "./diagnosis";
import type { FlowExpect, FlowPoint, FlowStep } from "./flows";
import type { Quantity } from "./measure";

export interface BuiltinGuide {
  id: string;
  title: string;
  intro?: string;
  steps: FlowStep[];
}

const UNNAMED = /^(N\d+|NET\d+|UNCONNECTED|NC)$/i;

interface Found {
  part: number;
  chip: ChipInfo;
  name: string;
}

class Points {
  private readonly used = new Set<string>();
  constructor(private readonly model: BoardModel) {}

  /** Named nets matching, not ground, at most `limit`. */
  nets(pattern: RegExp, limit = 4, except?: RegExp): number[] {
    const out: number[] = [];
    const m = this.model;
    for (let i = 0; i < m.nets.length && out.length < limit; i++) {
      const n = m.nets[i];
      if (n.kind === "ground" || n.kind === "unconnected" || UNNAMED.test(n.name)) continue;
      if (pattern.test(n.name) && !except?.test(n.name)) out.push(i);
    }
    return out;
  }

  point(net: number | undefined, quantity: Quantity, expect: FlowExpect, label: string, source: string): FlowPoint[] {
    if (net === undefined) return [];
    const name = this.model.nets[net].name;
    const key = `${name}|${quantity}`;
    if (this.used.has(key) || this.model.nets[net].kind === "ground") return [];
    this.used.add(key);
    return [{ net: name, quantity, expect, label, source }];
  }

  /** Voltage by the name ("PP1V8" 1.8 V ± 10 %), else "present". */
  rail(net: number, label: string): FlowPoint[] {
    const volts = railVolts(this.model.nets[net].name);
    return volts
      ? this.point(net, "voltage", { kind: "value", value: volts, tolerance: 0.1 }, label, "Name des Netzes")
      : this.point(net, "voltage", { kind: "present" }, label, "Standard");
  }

  /** No short to ground, measured in diode mode without power. */
  noShort(net: number, label: string): FlowPoint[] {
    return this.point(net, "diode", { kind: "noShort" }, label, "Kurzschlussprüfung");
  }
}

function chips(model: BoardModel, ...kinds: ChipInfo["kind"][]): Found[] {
  const out: Found[] = [];
  model.parts.forEach((p, part) => {
    const chip = chipFor(p.device);
    if (chip && kinds.includes(chip.kind)) out.push({ part, chip, name: `${chip.name} (${p.name})` });
  });
  return out;
}

/** Nets on a chip's datasheet pins, when its pinout fits the board. */
function pinNets(model: BoardModel, f: Found): Map<string, number> {
  const out = new Map<string, number>();
  if (!f.chip.pinout) return out;
  const check = checkPinout(model, f.part, f.chip.pinout);
  for (const [pin, cp] of check.byPin) if (!out.has(cp.name)) out.set(cp.name, model.pins[pin].net);
  return out;
}

/** Supply rails on a chip's pins (named with a voltage). */
function supplyNets(model: BoardModel, part: number): number[] {
  const p = model.parts[part];
  const out = new Set<number>();
  for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
    const net = model.pins[i].net;
    const n = model.nets[net];
    if ((n.kind === "power" || railVolts(n.name) !== undefined) && n.kind !== "ground" && !NOT_A_RAIL.test(n.name)) out.add(net);
  }
  return [...out];
}

const named = (fs: Found[]) => fs.map((f) => f.name).join(", ");
const keep = (steps: FlowStep[]) => steps.filter((s) => s.points.length > 0);

// --- patterns ----------------------------------------------------------------

const VBUS = /^(P?P?_?VBUS(_\w+)?|USB_?C?_?VBUS\w*|VBUS_?(IN|C|USB|CONN)?\w*|VCHG\w*|V_?USB(_IN)?|USB_?5V|PPVBUS\w*)$/i;
const CC = /^(USB_?C?_?)?CC[12](_\w+)?$/i;
const VSYS = /^(PP_?)?V_?SYS(_\w+)?$|^SYS_?(PWR|VDD)$/i;
const VBAT = /^(PP_?)?V_?BAT(T)?(_\w+)?$|^BAT(T)?_?(P|PLUS|\+|V)$/i;
const HDMI_5V = /^(\+?5V_?HDMI\w*|HDMI_?5V\w*|P5V_?HDMI|HDMI_?VCC5?)$/i;
const HPD = /^(HDMI_?)?HPD\w*$|^HDMI_?HP_?DET\w*$/i;
const DDC = /^(HDMI_?DDC|DDC|HDMI)_?(SCL|SDA|CLK|DATA)(_\w+)?$/i;
const TMDS = /^(HDMI_?)?(TMDS_?)?(TX|D|DATA|CLK|CK)_?[0-2]?_?(P|N|\+|-)$|^HDMI_?(TX|D)[0-2]?_?(P|N)$|^HDMI_?(CLK|CK)_?(P|N)$/i;
/** Rails with a voltage in the name ("PP1V8", "+3VALW", "+1.05VS") or core supplies (VDD_CPU). */
const MAIN_RAILS = /^(\+|PP_?|P(?=\d))?\d+(\.\d+)?V\d*|^(PP_?)?V(DD|CC)_?\w+$/i;

/** Intel sleep signals or a 19/20 V adapter rail: a notebook, not a console. */
const NOTEBOOK = /SLP_S[345]|^\+?(19|20)V/i;

/** Signals named after a rail ("PP3V3_EN", "3V3_PGOOD") are no rails. */
export const NOT_A_RAIL = /_(EN|PG|PGOOD|OK|SEN|SNS|FB)$/i;

/**
 * The guides for the board in view. Notebooks get the HDMI and "goes off"
 * guides too, under neutral titles; a notebook battery has several cells.
 */
export function consoleGuides(model: BoardModel, _t: Translate): BuiltinGuide[] {
  const notebook = model.nets.some((n) => NOTEBOOK.test(n.name));
  return [charging(model, notebook), noPicture(model, notebook), shutsOff(model, notebook)].filter((g): g is BuiltinGuide => g !== null);
}

/** Switch, Switch Lite / OLED, controllers: the board takes no charge. */
function charging(model: BoardModel, notebook: boolean): BuiltinGuide | null {
  const pts = new Points(model);
  const pds = chips(model, "pd");
  const chargers = chips(model, "charger");
  const vbus = pts.nets(VBUS, 3);
  const vbat = pts.nets(VBAT, 2);
  // Only boards with a battery and a USB input charge.
  if (vbus.length === 0 || vbat.length === 0) return null;
  const pd = pds.length ? ` Der USB-C-PD-Controller ${named(pds)} handelt die Spannung aus; er fällt nach falschen Netzteilen oder Docks oft aus.` : "";
  const steps: FlowStep[] = [
    {
      id: "c-short",
      title: "Kurzschluss am Ladeeingang",
      text: "Ohne Netzteil und mit abgeklemmtem Akku im Diodenmodus gegen Masse messen. VBUS und die CC-Leitungen dürfen nicht auf Masse liegen.",
      hint: `Kurzschluss auf VBUS: Kondensatoren am Eingang und die USB-C-Buchse (verbogene Pins, Flüssigkeit) prüfen.${pd} Kurzschluss auf CC: Buchse und PD-Controller.`,
      points: [...vbus.flatMap((n) => pts.noShort(n, "Ladeeingang (VBUS)")), ...pts.nets(CC, 2).flatMap((n) => pts.noShort(n, "USB-C CC-Leitung"))],
    },
    {
      id: "c-vbus",
      title: "Spannung vom Netzteil",
      text: "Netzteil anschließen und VBUS messen. Zuerst liegen 5 V an; mit einem PD-Netzteil oder Dock danach auch mehr (bei der Switch bis 15 V).",
      hint: `Fehlt VBUS hinter der Buchse: Buchse, Sicherung und Eingangs-MOSFETs prüfen.${pd}`,
      points: vbus.flatMap((n) => pts.point(n, "voltage", { kind: "range", min: 4.5, max: 20.5 }, "VBUS mit Netzteil", "USB-Standard")),
    },
  ];
  // The charger's own pins when its pinout fits (BQ24193 in the Switch).
  const chargerPoints = chargers.flatMap((f) => {
    const pins = pinNets(model, f);
    return [
      ...pts.point(pins.get("VBUS"), "voltage", { kind: "range", min: 3.9, max: 17 }, `VBUS am ${f.name}`, "Datenblatt"),
      ...pts.point(pins.get("REGN"), "voltage", { kind: "present" }, `REGN am ${f.name} – Treiberversorgung, nur mit gültigem Eingang`, "Datenblatt"),
      ...pts.point(pins.get("SYS"), "voltage", { kind: "present" }, `SYS am ${f.name}`, "Datenblatt"),
    ];
  });
  steps.push({
    id: "c-charger",
    title: "Laderegler",
    text: chargers.length
      ? `Der Laderegler ${named(chargers)} setzt die Eingangsspannung in Systemspannung und Ladestrom um. Mit Netzteil messen.`
      : "Hinter dem Laderegler liegt die Systemspannung. Mit Netzteil messen.",
    hint: "Ist VBUS am Laderegler da, aber REGN oder SYS fehlen: Laderegler prüfen (häufig nach Kurzschluss am Eingang mit beschädigt), dann seine Spule und Kondensatoren.",
    points: [...chargerPoints, ...pts.nets(VSYS, 2).flatMap((n) => pts.point(n, "voltage", { kind: "present" }, "Systemspannung", "Standard"))],
  });
  steps.push({
    id: "c-battery",
    title: "Akku",
    text: notebook
      ? "Spannung am Akkuanschluss: je Lithium-Zelle etwa 3,0 V (leer) bis 4,35 V (voll), mal der Zellenzahl des Akkus."
      : "Spannung am Akkuanschluss: eine Lithium-Zelle liegt zwischen etwa 3,0 V (leer) und 4,35 V (voll).",
    hint: "Unter 3 V je Zelle: Akku tiefentladen oder defekt – mit Labornetzteil vorsichtig anladen oder tauschen. Kein Kontakt: Akkustecker und Sicherung prüfen.",
    points: vbat.flatMap((n) =>
      notebook
        ? pts.point(n, "voltage", { kind: "present" }, "Akkuspannung", "Lithium-Akku")
        : pts.point(n, "voltage", { kind: "range", min: 3.0, max: 4.4 }, "Akkuspannung", "Lithium-Zelle"),
    ),
  });
  return { id: "console-charge", title: notebook ? "Lädt nicht über USB-C" : "Konsole/Controller lädt nicht", intro: introFor("Lädt nicht", pds, chargers), steps: keep(steps) };
}

/** HDMI or dock: the console runs but no picture. */
function noPicture(model: BoardModel, notebook: boolean): BuiltinGuide | null {
  const pts = new Points(model);
  const video = chips(model, "video");
  const hdmi5 = pts.nets(HDMI_5V, 2);
  const hpd = pts.nets(HPD, 2);
  const tmds = pts.nets(TMDS, 8);
  if (hdmi5.length + hpd.length + tmds.length === 0 && video.length === 0) return null;
  const retimer = video.length ? ` Hier: ${named(video)}.` : "";
  const steps: FlowStep[] = [
    {
      id: "v-short",
      title: "HDMI-Leitungen ohne Kurzschluss",
      text: "Ohne Strom im Diodenmodus gegen Masse messen. Beschädigte HDMI-Buchsen (verbogene oder abgerissene Pins) sind der häufigste Grund für kein Bild.",
      hint: "Eine Leitung auf Masse oder OL, während die Nachbarn gleiche Werte zeigen: HDMI-Buchse unter dem Mikroskop prüfen und tauschen. Bleibt es, den HDMI-Baustein dahinter.",
      points: [...tmds.flatMap((n) => pts.noShort(n, "HDMI-Datenleitung")), ...pts.nets(DDC, 2).flatMap((n) => pts.noShort(n, "DDC (EDID)"))],
    },
    {
      id: "v-5v",
      title: "5 V für den Fernseher",
      text: "Konsole eingeschaltet: Die HDMI-Buchse liefert 5 V an den Fernseher (HDMI-Standard), damit er die Konsole erkennt.",
      hint: "5 V fehlen: Sicherung oder Lastschalter auf der HDMI-5-V-Leitung prüfen.",
      points: hdmi5.flatMap((n) => pts.point(n, "voltage", { kind: "range", min: 4.7, max: 5.3 }, "HDMI 5 V", "HDMI-Standard")),
    },
    {
      id: "v-hpd",
      title: "Fernseher erkannt (Hot Plug)",
      text: "Mit angeschlossenem, eingeschaltetem Fernseher geht Hot Plug Detect auf High.",
      hint: "HPD bleibt Low: Kabel und Fernseher gegenprüfen, dann HPD-Pin der Buchse und Pegelwandler/Widerstände dazwischen.",
      points: hpd.flatMap((n) => pts.point(n, "voltage", { kind: "high" }, "HPD mit Fernseher", "HDMI-Standard")),
    },
    {
      id: "v-chip",
      title: "HDMI-Baustein versorgt",
      text: `Der Baustein zwischen Prozessor und Buchse (Retimer, Redriver oder Encoder) braucht seine Spannungen.${retimer}`,
      hint: "Versorgung da und alles andere in Ordnung, aber kein Bild: der Baustein selbst ist der nächste Kandidat (oft nach Spannungsspitzen über das HDMI-Kabel).",
      points: video.flatMap((f) => supplyNets(model, f.part).flatMap((n) => pts.rail(n, `Versorgung ${f.name}`))),
    },
  ];
  return { id: "console-picture", title: notebook ? "Kein Bild über HDMI" : "Konsole: kein Bild (HDMI/Dock)", intro: introFor("Kein Bild", video), steps: keep(steps) };
}

/** Turns on and goes straight off again: a rail is shorted or a regulator gives up. */
function shutsOff(model: BoardModel, notebook: boolean): BuiltinGuide | null {
  const pts = new Points(model);
  const pmics = chips(model, "pmic", "buck", "system");
  // Not the adapter input (the charging guide's), nor a notebook's battery
  // rail, whose voltage follows the charge; consoles do run on 12 V (PS5).
  const max = notebook ? 6 : 13;
  const rails = pts.nets(MAIN_RAILS, 40, NOT_A_RAIL).filter((n) => (railVolts(model.nets[n].name) ?? 0) <= max).slice(0, 10);
  const sys = [...pts.nets(VSYS, 1), ...pts.nets(VBAT, 1)];
  if (rails.length < 2) return null;
  const steps: FlowStep[] = [
    {
      id: "o-short",
      title: "Kurzschluss auf einer Schiene",
      text: "Ohne Strom (Akku ab) im Diodenmodus gegen Masse messen. Geht die Konsole an und sofort aus, schaltet meist der Regler einer Schiene wegen Kurzschluss ab.",
      hint: "Eine Schiene nahe 0: Kurzschluss suchen – Labornetzteil mit Strombegrenzung auf die Schiene, warm werdendes Bauteil mit Wärmebildkamera oder Isopropanol finden (meist ein Kondensator).",
      points: [...sys, ...rails].flatMap((n) => pts.noShort(n, "Schiene")),
    },
    {
      id: "o-up",
      title: "Schienen kommen hoch",
      text: "Einschalten und gleich messen, bevor sie wieder abschaltet: Welche Schiene fehlt oder bricht ein?",
      hint: `Die erste fehlende Schiene: Freigabe und Eingang ihres Reglers prüfen${pmics.length ? ` – hier ${named(pmics)}` : ""}. Bricht sie unter Last ein, eher Kurzschluss oder defekter Regler.`,
      points: rails.flatMap((n) => pts.rail(n, "Schiene eingeschaltet")),
    },
  ];
  return { id: "console-off", title: notebook ? "Geht sofort wieder aus" : "Konsole/Controller geht sofort wieder aus", intro: introFor("Geht sofort aus", pmics), steps: keep(steps) };
}

function introFor(what: string, ...groups: Found[][]): string {
  const found = groups.flat();
  const known = found.length ? ` Erkannte Bausteine: ${named(found)}.` : "";
  return `${what}: Schritt für Schritt mit den Messpunkten dieses Boards. Werte aus Netznamen, Datenblättern und Standards (USB, HDMI).${known}`;
}
