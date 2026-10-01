/**
 * Reference values that ship with Avero, read off the measurement pictures
 * of repair.wiki. Like their source, the values in this file are licensed
 * under CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
 *
 * Tester screens are written down as they read, and turned into connector
 * pins here, so each value is copied only once.
 */
import type { Category } from "../workbench/catalog";
import { CHIPS } from "./chips";
import type { KnowledgePage } from "./store";
import { LINK_CLOSE, LINK_MID, LINK_OPEN, type Block, type GalleryItem } from "./wikitext";

const WIKI = "https://repair.wiki/w/";
const wikiUrl = (title: string) => WIKI + encodeURIComponent(title.replace(/ /g, "_"));

/** Values of a screen or a pin row, separated by spaces. */
const values = (s: string) => s.trim().split(/\s+/);

/** Pins A1–A12, B1–B12 of a USB-C receptacle, with their reading. */
export type UsbC = Record<string, string>;

/** USB-C readings from the pins in order: A1…A12 and B1…B12. */
export function usbC(a: string, b: string): UsbC {
  const out: UsbC = {};
  values(a).forEach((v, i) => (out[`A${i + 1}`] = v));
  values(b).forEach((v, i) => (out[`B${i + 1}`] = v));
  return out;
}

/** USB-C readings from a Mechanic tail tester screen: 01–12 are A1–A12, 13–24 are B12–B1. */
export function mechanicUsbC(screen: string): UsbC {
  const v = values(screen);
  if (v.length !== 24) throw new Error(`a Mechanic screen has 24 values, not ${v.length}`);
  const out: UsbC = {};
  for (let i = 0; i < 12; i++) {
    out[`A${i + 1}`] = v[i];
    out[`B${12 - i}`] = v[12 + i];
  }
  return out;
}

/** HDMI pins 1–19 from a Mechanic screen with the "HDMI diode test" adapter (pin n on 0n+1, 11–19 on 14–22). */
export function mechanicHdmi(screen: string): string[] {
  const v = values(screen);
  if (v.length !== 24) throw new Error(`a Mechanic screen has 24 values, not ${v.length}`);
  return Array.from({ length: 19 }, (_, i) => (i < 10 ? v[i + 1] : v[i + 3]));
}

/** One cell for several pins: one value, a range, or the values that differ. */
export function combine(readings: string[]): string {
  const norm = readings.map((r) => (r.startsWith(".") ? `0${r}` : r)).map((r) => (/^0(\.0+)?$/.test(r) ? "0" : r));
  const distinct = [...new Set(norm)];
  if (distinct.length === 1) return distinct[0];
  const numbers = distinct.map(Number);
  if (distinct.length > 2 && numbers.every((n) => !Number.isNaN(n)))
    return `${Math.min(...numbers).toFixed(3).replace(/0$/, "")}–${Math.max(...numbers).toFixed(3).replace(/0$/, "")}`;
  return distinct.join(" / ");
}

const USB_ROWS: [string, string[]][] = [
  ["VBUS", ["A4", "A9", "B4", "B9"]],
  ["CC1", ["A5"]],
  ["CC2", ["B5"]],
  ["D+", ["A6", "B6"]],
  ["D−", ["A7", "B7"]],
  ["SBU1", ["A8"]],
  ["SBU2", ["B8"]],
  ["TX/RX", ["A2", "A3", "A10", "A11", "B2", "B3", "B10", "B11"]],
  ["GND", ["A1", "A12", "B1", "B12"]],
];

/** Signals as rows, one column per tester. */
function usbTable(caption: string, columns: [string, UsbC][]): Block {
  return {
    type: "table",
    header: true,
    caption,
    rows: [
      ["Signal (Pins)", ...columns.map(([name]) => name)],
      ...USB_ROWS.map(([signal, pins]) => [
        `${signal}\n${pins.length > 4 ? `${pins.slice(0, 4).join(" ")}\n${pins.slice(4).join(" ")}` : pins.join(" ")}`,
        ...columns.map(([, reading]) => combine(pins.map((p) => reading[p]))),
      ]),
    ],
  };
}

const HDMI_ROWS: [string, number[]][] = [
  ["TMDS Daten + Takt", [1, 3, 4, 6, 7, 9, 10, 12]],
  ["Schirm (GND)", [2, 5, 8, 11]],
  ["CEC", [13]],
  ["Utility / HEAC", [14]],
  ["SCL (DDC)", [15]],
  ["SDA (DDC)", [16]],
  ["DDC/CEC GND", [17]],
  ["+5V", [18]],
  ["Hot Plug Detect", [19]],
];

function hdmiTable(caption: string, columns: [string, string[]][]): Block {
  return {
    type: "table",
    header: true,
    caption,
    rows: [
      ["Signal (Pins)", ...columns.map(([name]) => name)],
      ...HDMI_ROWS.map(([signal, pins]) => [
        `${signal}\n${pins.join(" ")}`,
        ...columns.map(([, reading]) => combine(pins.map((p) => reading[p - 1]))),
      ]),
    ],
  };
}

const link = (label: string, url: string) => `${LINK_OPEN}${label}${LINK_MID}${url}${LINK_CLOSE}`;
/** Where facts beyond repair.wiki come from, each checked against the original. */
const sources = (...items: [string, string][]): Block[] => [
  heading("Quellen"),
  { type: "list", ordered: false, items: items.map(([label, url]) => link(label, url)) },
];

const note = (text: string, kind: "note" | "warning" | "tip" = "note"): Block => ({ type: "note", kind, text });
const para = (text: string): Block => ({ type: "paragraph", text });
const heading = (text: string): Block => ({ type: "heading", level: 2, text });
const pictures = (...items: [string, string][]): Block[] => [
  heading("Messbilder"),
  para("Werte aus diesen Bildern abgelesen; im Zweifel gilt das Bild."),
  { type: "gallery", items: items.map(([file, caption]): GalleryItem => ({ file, caption })) },
];

const TESTERS_DIFFER =
  "Jeder Tester misst mit eigenem Strom und zeigt eigene Zahlen. Nur mit der Spalte des eigenen Testers vergleichen, nie Werte verschiedener Tester.";
const USB_C_INTRO =
  "Bekannt gutes Gerät, USB-C-Buchse im Diodenmodus über Tail-Plug-Tester. Mehrere Werte in einer Zelle: die Pins des Signals messen verschieden (z. B. Seite A / Seite B). OL = offen.";

function page(title: string, wikiTitle: string, device: Category, blocks: Block[]): KnowledgePage {
  return {
    title,
    url: wikiUrl(wikiTitle),
    categories: [wikiTitle, "Referenzwerte"],
    device,
    imported: "2026-10-01T00:00:00Z",
    source: "repair.wiki",
    license: "CC BY-SA 3.0",
    builtin: true,
    blocks,
  };
}

// --- Readings, as the screens show them.

const HDMI = {
  ps5: mechanicHdmi("GND .85 .07 .85 .85 .07 .85 .85 .07 .85 .85 GND GND .07 .85 .70 OL .69 .68 .07 .56 .70 OL GND"),
  ps5Meter: values(".799 0 .799 .799 0 .799 .799 0 .799 .800 0 .800 .667 OL .658 .658 0 .518 .673"),
  ps4Pro: mechanicHdmi("GND .53 .07 .53 .53 .07 .53 .53 .07 .53 .54 GND GND .07 .54 .52 OL .64 .64 .07 .66 .64 OL GND"),
  ps4Slim: mechanicHdmi("GND .53 .07 .53 .53 .07 .53 .53 .07 .54 .55 GND GND .07 .55 .52 OL .65 .65 .07 .66 .64 OL GND"),
  oneSIn: mechanicHdmi("GND .79 .07 .79 .79 .07 .79 .79 .07 .79 .79 GND GND .07 .79 .65 OL .69 .69 .07 .64 .69 OL GND"),
  oneXOut: mechanicHdmi("GND .77 .07 .77 .77 .07 .77 .77 .07 .77 .77 GND GND .07 .77 .67 .64 .67 .69 .07 .67 .71 OL GND"),
  oneXIn: mechanicHdmi("GND .85 .07 .85 .85 .07 .85 .85 .07 .85 .85 GND GND .07 .85 .65 OL .70 .70 .07 .65 .69 OL GND"),
  seriesS: mechanicHdmi("GND .79 .07 .79 .79 .07 .79 .79 .07 .79 .79 GND GND .07 .79 .67 .69 .65 .66 .07 .64 .68 OL GND"),
  seriesX: mechanicHdmi("GND .79 .07 .79 .79 .07 .79 .79 .07 .79 .79 GND GND .07 .79 .65 .59 .65 .67 .07 .64 .69 OL GND"),
};

const HDMI_NOTE =
  "Mechanic T-824 mit „HDMI Diode Test“-Adapter. Der Schirm (Pins 2, 5, 8, 11) und Pin 17 zeigen bei allen Konsolen 0.07 statt 0 – das liegt am Adapter. Im Betrieb liefert die Konsole auf Pin 18 +5 V (HDMI-Norm); fehlen sie, zuerst die 5-V-Versorgung des Ports prüfen.";

const OLED = {
  t824: mechanicUsbC("GND OL OL .53 .50 .46 .46 .75 .53 OL OL GND GND OL OL .53 .75 .46 .46 .50 .53 OL OL GND"),
  t824se: mechanicUsbC("GND OL OL .53 .50 .46 .46 .75 .53 OL OL GND GND OL OL .53 .75 .47 .47 .50 .53 OL OL GND"),
  jcid: usbC("0 OL OL .528 .506 .476 .476 .753 .528 OL OL 0", "0 OL OL .528 .506 .476 .476 .752 .528 OL OL 0"),
  ibridge: usbC("GND OL OL .814 .504 .482 .483 .762 .814 OL OL GND", "GND OL OL .814 .504 .483 .483 .762 .814 OL OL GND"),
  tns360: usbC("GND OL OL .812 .502 .481 .481 .759 .812 OL OL GND", "GND OL OL .812 .502 .481 .481 .759 .812 OL OL GND"),
  ycsTail: usbC("GND OL OL .521 .485 .456 .454 .738 .519 OL OL GND", "GND OL OL .529 .493 .464 .464 .745 .529 OL OL GND"),
  uul: usbC("GND OL OL .520 .484 .454 .454 .739 .521 OL OL GND", "GND OL OL .529 .492 .462 .462 .749 .528 OL OL GND"),
  bare: mechanicUsbC("GND OL OL .50 .51 .78 .78 .73 .50 OL OL GND GND OL OL .50 .73 .78 .78 .51 .50 OL OL GND"),
};

const LITE = {
  t824: mechanicUsbC("GND OL OL .52 .53 .80 .81 OL .53 OL OL GND GND OL OL .52 OL .81 .80 .55 .52 OL OL GND"),
  t824se: mechanicUsbC("GND OL OL .54 .55 .81 .82 OL .54 OL OL GND GND OL OL .54 OL .82 .81 .55 .54 OL OL GND"),
  jcid: usbC("0 OL OL .548 .550 .810 .822 OL .548 OL OL 0", "0 OL OL .548 .550 .810 .822 OL .548 OL OL 0"),
  ibridge: usbC("GND OL OL .821 .564 .838 .845 OL .821 OL OL GND", "GND OL OL .821 .563 .838 .845 OL .821 OL OL GND"),
  tns360: usbC("GND OL OL .818 .559 .833 .840 OL .818 OL OL GND", "GND OL OL .818 .558 .833 .839 OL .818 OL OL GND"),
  // Shown only in the note: this tester cannot read D± and CC on a Lite.
  ycsTail: usbC("GND OL OL .528 OL OL OL OL .528 OL OL GND", "GND OL OL .535 OL OL OL OL .537 OL OL GND"),
  uul: usbC("GND OL OL .526 .538 .803 .807 OL .525 OL OL GND", "GND OL OL .535 .548 .812 .815 OL .534 OL OL GND"),
};

/** All known chips on one page, so search finds them; the same facts show on a part with that device. */
const CHIP_PAGE: KnowledgePage = {
  title: "Chip-Datenbank – häufige Reparatur-ICs",
  url: "https://github.com/meb99/Avero",
  categories: ["Chips", "Datenblätter"],
  device: { brand: "", family: "", model: "" },
  imported: "2026-10-01T00:00:00Z",
  source: "Herstellerangaben",
  license: "Fakten aus Datenblättern",
  builtin: true,
  blocks: [
    para(
      "Laderegler, Spannungswandler, PD- und HDMI-Chips, die bei Reparaturen oft auffallen. Alle Werte stammen aus dem Datenblatt oder von der Produktseite des Herstellers. Steht der Typ in der Boarddatei (z. B. ISL88739AHRZ), zeigt Avero diese Angaben direkt beim Bauteil.",
    ),
    {
      type: "table",
      header: true,
      caption: "Chips",
      rows: [
        ["Chip", "Hersteller", "Aufgabe", "Werte"],
        ...CHIPS.map((c) => [c.name, c.maker, c.role, c.facts.map(([k, v]) => `${k}: ${v}`).join("\n") || "–"]),
      ],
    },
    ...sources(...CHIPS.map((c): [string, string] => [`${c.name} (${c.maker})`, c.url])),
  ],
};

/** Pages built into Avero; they show like imported pages but cannot be removed. */
export const BUILTIN_PAGES: KnowledgePage[] = [
  CHIP_PAGE,
  page("Nintendo Switch OLED – USB-C Diodenwerte", "Nintendo Switch OLED", { brand: "Nintendo", family: "Switch", model: "OLED" }, [
    note(`${TESTERS_DIFFER} Beispiel: VBUS zeigt 0,53 auf Mechanic und JCID, aber 0,81 auf YCS TNS 360 und iBridge.`, "warning"),
    para(`${USB_C_INTRO} Platine HEG-CPU-01.`),
    usbTable("USB-C, Diodenmodus", [
      ["Mechanic T824", OLED.t824],
      ["Mechanic T824SE", OLED.t824se],
      ["JCID CD01", OLED.jcid],
      ["Qianli iBridge A3", OLED.ibridge],
      ["YCS TNS 360", OLED.tns360],
      ["YCS Tail Plug", OLED.ycsTail],
      ["2UUL PW31", OLED.uul],
    ]),
    note(
      `Nicht als Referenz übernommen: Ein weiteres Mechanic-Foto (ausgebaute Platine) zeigt D+/D− ${combine([OLED.bare.A6, OLED.bare.A7])} statt um 0.46–0.48 auf demselben Testermodell, ohne erkennbaren Grund. Weicht dein Wert so ab, ein bekannt gutes Gerät mit demselben Tester gegenmessen.`,
      "warning",
    ),
    ...pictures(
      ["Nintendo_Switch_OLED_Diode_Readings_Mechanic_T824.jpg", "Mechanic T824"],
      ["Nintendo_Switch_OLED_Diode_Readings_Mechanic_T824SE.jpg", "Mechanic T824SE"],
      ["Nintendo_Switch_OLED_Diode_Readings_JCS_CD01.jpg", "JCID CD01"],
      ["Nintendo_Switch_OLED_Diode_Readings_Qianli_iBridge.jpg", "Qianli iBridge A3"],
      ["Nintendo_Switch_OLED_Diode_Readings_YCS_TNS_360.jpg", "YCS TNS 360"],
      ["Nintendo_Switch_OLED_Diode_Readings_YCS_Tail_Plug_Tester.jpg", "YCS Tail Plug Tester"],
      ["Nintendo_Switch_OLED_Diode_Readings_2UUL_PW31.jpg", "2UUL PW31"],
      ["Switch_OLED_Mechanic_Readings.jpg", "Mechanic, ausgebaute Platine (abweichend)"],
      ["Switch-oled-display-connector-diode-readings.jpg", "Display- und Spielkarten-Anschluss, Diodenwerte je Pin (nur im Bild)"],
    ),
  ]),

  page("Nintendo Switch Lite – USB-C Diodenwerte", "Nintendo Switch Lite", { brand: "Nintendo", family: "Switch", model: "Lite" }, [
    note(TESTERS_DIFFER, "warning"),
    para(`${USB_C_INTRO} Platine HDH-CPU-10.`),
    note("SBU1/SBU2 sind auf der Switch Lite nicht belegt: OL ist hier richtig (anders als bei Switch und OLED)."),
    usbTable("USB-C, Diodenmodus", [
      ["Mechanic T824", LITE.t824],
      ["Mechanic T824SE", LITE.t824se],
      ["JCID CD01", LITE.jcid],
      ["Qianli iBridge A3", LITE.ibridge],
      ["YCS TNS 360", LITE.tns360],
      ["2UUL PW31", LITE.uul],
    ]),
    note(
      `Der YCS Tail Plug Tester taugt für die Switch Lite nicht: Auf einem guten Gerät zeigt er D+/D− und CC als OL und meldet Fehler, nur VBUS misst er (${combine([LITE.ycsTail.A4, LITE.ycsTail.B9])}). Deshalb steht er nicht in der Tabelle.`,
      "warning",
    ),
    ...pictures(
      ["Nintendo_Switch_Lite_-_Mechanic_Readings.jpg", "Mechanic T824"],
      ["Nintendo_Switch_Lite_Diode_Readings_Mechanic_T824SE.jpg", "Mechanic T824SE"],
      ["Nintendo_Switch_Lite_Diode_Readings_JCID_CD01.jpg", "JCID CD01"],
      ["IBridge_USB-C_Diode_Readings.jpg", "Qianli iBridge A3"],
      ["YCS_USB-C_Diode_Readings.jpg", "YCS TNS 360"],
      ["Nintendo_Switch_Lite_Diode_Readings_YCS_Tail_Plug.jpg", "YCS Tail Plug (misst D± und CC nicht)"],
      ["Nintendo_Switch_Lite_Diode_Readings_2UUL_Tail_Plug.jpg", "2UUL PW31"],
    ),
  ]),

  page("Nintendo Switch – USB-C Diodenwerte", "Nintendo Switch", { brand: "Nintendo", family: "Switch", model: "Original" }, [
    para(`${USB_C_INTRO} Gilt für HAC-001 und HAC-001(-01).`),
    usbTable("USB-C, Diodenmodus", [
      ["Mechanic T824", mechanicUsbC("GND OL OL .53 .49 .46 .46 .73 .53 OL OL GND GND OL OL .53 .74 .46 .46 .49 .53 OL OL GND")],
    ]),
    note(
      "Ohne Tester mit dem Multimeter direkt an den Lötpunkten messen: Das Bild „Pin Correlation“ zeigt, welcher Lötpunkt welcher Mechanic-Nummer entspricht (01–12 untere Reihe von rechts, 13–24 obere Reihe von rechts).",
      "tip",
    ),
    ...pictures(
      ["Nintendo_Switch_Diode_Mode_Readings_Mechanic_T824.jpg", "Mechanic T824"],
      ["453864473_865240828350782_7346018744626912308_n.jpg", "Diodenwerte direkt an den Lötpunkten"],
      ["Nintendo_Switch_Mechanic_Pin_Correlation_.jpg", "Lötpunkte ↔ Mechanic-Nummern"],
    ),
  ]),

  page("Nintendo Switch 2 – USB-C Diodenwerte", "Nintendo Switch 2", { brand: "Nintendo", family: "Switch", model: "2" }, [
    para(`${USB_C_INTRO} Die Switch 2 hat zwei USB-C-Buchsen.`),
    usbTable("USB-C, Diodenmodus, Mechanic T824", [
      ["Untere Buchse", mechanicUsbC("GND OL OL .57 .44 .36 .36 .57 .57 OL OL GND GND OL OL .57 .57 .36 .36 .44 .57 OL OL GND")],
      ["Obere Buchse", mechanicUsbC("GND OL OL .57 .44 .36 .36 OL .57 OL OL GND GND OL OL .57 OL .36 .36 .44 .57 OL OL GND")],
    ]),
    note("An der oberen Buchse sind SBU1/SBU2 offen (OL), an der unteren messen sie 0.57."),
    ...pictures(
      ["Switch_2_Bottom_USB-C_Port_Diode_.jpeg", "Untere Buchse"],
      ["Switch_2_Top_USB-C_Port_Diode_.jpeg", "Obere Buchse"],
    ),
  ]),

  page("PlayStation 5 – Diodenwerte", "PlayStation 5", { brand: "Sony", family: "PlayStation", model: "5" }, [
    note(TESTERS_DIFFER, "warning"),
    hdmiTable("HDMI, Diodenmodus", [
      ["Mechanic T-824", HDMI.ps5],
      ["Multimeter, EDM-020 ohne Buchse", HDMI.ps5Meter],
    ]),
    para(HDMI_NOTE),
    para(
      "Die Multimeter-Werte sind an den Lötpunkten einer EDM-020 ohne HDMI-Buchse gemessen; Pin 19 links, Pin 1 rechts (Bild „HDMI ohne Buchse“).",
    ),
    {
      type: "table",
      header: true,
      caption: "USB-A hinten (beide Buchsen gleich)",
      rows: [
        ["Signal", "Wert"],
        ["VBUS", "0.508"],
        ["D+ / D−", "0.692–0.694"],
        ["SuperSpeed-Paare", "0.772–0.773"],
        ["GND", "0"],
      ],
    },
    para("Die Signale sind nach der USB-3.0-Belegung zugeordnet; das Bild zeigt nur die Lötpunkte mit ihren Werten."),
    {
      type: "table",
      header: true,
      caption: "Weitere Anschlüsse (Pins in Bildreihenfolge)",
      rows: [
        ["Anschluss", "Werte"],
        ["Lüfter, 3-polig (von links)", "0.491 · 0 · 0.431"],
        ["Laufwerk-Strom, 4-polig (von oben)", "0.432 · 0 · 0 · 0.456"],
        ["Power-/Eject-Tasten, 6-polig (von oben)", "1.073 · 1.179 · OL · OL · OL · 0"],
        ["LAN, 8 Pins", "alle OL"],
      ],
    },
    ...pictures(
      ["PS5-HDMI-Mechnic-Readings.jpg", "HDMI, Mechanic T-824"],
      ["HDMI_NO_PORT_MEASUREMENTS.jpg", "HDMI ohne Buchse, EDM-020"],
      ["USB_Ports.jpg", "USB-A hinten"],
      ["Fan_and_drive_power.jpg", "Lüfter und Laufwerk-Strom"],
      ["Power_and_disk_buttons_con.jpg", "Power- und Eject-Tasten"],
      ["LAN_Port.jpg", "LAN"],
      ["Front_USB_FPC.jpg", "Front-USB-Flexkabel (nur im Bild)"],
      ["M2_SSD.jpg", "M.2-SSD-Steckplatz (nur im Bild)"],
      ["Disk_Drive_DATA_FPC.jpg", "Laufwerk-Daten-Flexkabel (nur im Bild)"],
      ["LED_FPC.jpg", "LED-Flexkabel (nur im Bild)"],
    ),
  ]),

  page("Nintendo Switch – Ladeelektronik und Fremd-Docks", "Nintendo Switch", { brand: "Nintendo", family: "Switch", model: "" }, [
    para(
      "Bauteile des Ladewegs laut Teileliste von repair.wiki (Switch HAC-001), Aufgaben und Grenzwerte aus den Datenblättern der Hersteller. Händler bieten den M92T36 auch für Switch Lite und OLED an.",
    ),
    {
      type: "table",
      header: true,
      caption: "Ladeweg",
      rows: [
        ["Bauteil", "Aufgabe", "Wichtige Werte"],
        ["M92T36 (ROHM)", "USB-C Power Delivery: handelt mit Netzteil/Dock die Spannung aus", "CC-Pin max. 6 V"],
        ["BQ24193 (TI)", "Akkuladeregler mit Power-Path, USB-OTG", "Eingang 3,9–17 V, max. 22 V; Ladestrom bis 4,5 A"],
        ["MAX17050 (Maxim)", "Ladestandsmessung (Fuel Gauge)", "–"],
        ["MAX77620 (Maxim)", "System-PMIC, „großer PMIC“ auf Seite B", "13 Spannungsregler, RTC"],
        ["MAX77621 (Maxim)", "Wandler für CPU und RAM („kleiner PMIC“)", "bis 16 A"],
        ["PI3USB30532 (Diodes)", "Umschalter USB 3 / DisplayPort an der USB-C-Buchse (Bild am Dock)", "Versorgung 3,0–3,6 V"],
      ],
    },
    note(
      "Bekannte Ursache für tote Switches: Fremd-Docks (z. B. Nyko) legten 9 V auf den CC-Pin – 50 % über dem Grenzwert des M92T36 von 6 V. Der CC-Pin liegt nur 0,5 mm neben VBUS, das am Dock 15 V führt; verbogene oder verschmorte Kontakte in der Buchse können beide verbinden.",
      "warning",
    ),
    para(
      "Bei „lädt nicht“ daher zuerst die USB-C-Buchse unter dem Mikroskop prüfen, dann die Diodenwerte (Seite „USB-C Diodenwerte“ des Modells) und den M92T36.",
    ),
    ...sources(
      ["repair.wiki: Nintendo Switch, Teileliste", wikiUrl("Nintendo Switch")],
      ["ChargerLab: Ursachen für tote Switches (CC 9 V, Abstand zu VBUS)", "https://www.chargerlab.com/the-reasons-behind-the-nintendo-switch-bricking-situation"],
      ["Texas Instruments: BQ24193 Datenblatt", "https://www.ti.com/product/BQ24193"],
      ["Linux-Kernel: MAX77620 (Regler, RTC)", "https://www.kernel.org/doc/Documentation/devicetree/bindings/mfd/max77620.txt"],
      ["Diodes Inc.: PI3USB30532", "https://diodes.com/part/PI3USB30532"],
      ["Händler: M92T36 für Switch, Lite, OLED", "https://beetstech.com/product/nintendo-switch-usb-c-power-delivery-controller-ic-m92t36"],
    ),
  ]),

  page("Konsolen – HDMI-Chips", "Category:Game Consoles", { brand: "", family: "", model: "" }, [
    para(
      "Welcher Chip das HDMI-Signal treibt – bei „kein Bild“ nach Port und Zuleitungen die nächste Station. Nur Angaben, die mindestens zwei Quellen übereinstimmend nennen; Versorgungsspannungen aus den Datenblättern.",
    ),
    {
      type: "table",
      header: true,
      caption: "HDMI-Chips",
      rows: [
        ["Konsole", "Chip", "Versorgung"],
        ["PlayStation 5", "Panasonic MN864739 (HDMI-Encoder)", "kein öffentliches Datenblatt"],
        ["Xbox One X", "TI TDP158 (HDMI-Redriver)", "VDD 1,1 V, VCC 3,3 V"],
        ["Xbox Series X / S", "Aufschrift NB7N621M; passt zu onsemi NB7NQ621M (HDMI-2.1-Redriver)", "3,3 V"],
      ],
    },
    note(
      "PS4: Händler und Foren ordnen MN86471A und MN864729 den Modellen widersprüchlich zu. Deshalb hier keine Angabe – die Aufschrift auf dem Board ablesen.",
    ),
    ...sources(
      ["Händler: MN864739 für PS5 (5g-m)", "https://www.5g-m.com/en/spare-parts-playstation-5/32346-hdmi-ic-mn864739-ps5.html"],
      ["Händler: MN864739 für PS5 (dalbani)", "https://dalbani.com/product/new-panasonic-hdmi-encoder-video-ic-chip-mn864739-for-sony-ps5/"],
      ["Händler: TDP158 für Xbox One X (5g-m)", "https://www.5g-m.com/en/spare-parts-xbox/27427-ic-tdp158-hdmi-xbox-one-x.html"],
      ["Händler: TDP158 für Xbox One X (dalbani)", "https://dalbani.com/product/oem-xbox-one-x-hdmi-tdp158-75dp159-retimer-ic-chip-display-interface-ic-interfac/"],
      ["Texas Instruments: TDP158 Datenblatt", "https://www.ti.com/product/TDP158"],
      ["Händler: NB7N621M für Xbox Series X/S (dalbani)", "https://dalbani.com/product/oem-nb7n621m-hdmi-retimer-ic-chip-driver-mainboard-for-xbox-series-x-s-console/"],
      ["onsemi: NB7NQ621M Datenblatt", "https://www.onsemi.com/products/signal-conditioning-control/redrivers/nb7nq621m"],
    ),
  ]),

  page("PlayStation 5 Slim – NAND-Tausch", "PlayStation 5 Slim", { brand: "Sony", family: "PlayStation", model: "5 Slim" }, [
    note(
      "EDM-040: Nur der im Bild grün markierte NAND kann getauscht werden, der rot markierte nicht.",
      "warning",
    ),
    ...pictures(["PS5_Slim_EDM-040_NAND_SWAP.png", "Grün: tauschbar, rot: nicht tauschbar"]),
  ]),

  page("PlayStation 4 Pro – HDMI-Diodenwerte", "Playstation 4 Pro", { brand: "Sony", family: "PlayStation", model: "4 Pro" }, [
    hdmiTable("HDMI, Diodenmodus", [["Mechanic T-824", HDMI.ps4Pro]]),
    para(HDMI_NOTE),
    ...pictures(["PS4Pro-HDMI-Mechnic-Readings.jpg", "HDMI, Mechanic T-824"]),
  ]),

  page("PlayStation 4 Slim – HDMI-Diodenwerte", "Playstation 4 Slim", { brand: "Sony", family: "PlayStation", model: "4 Slim" }, [
    hdmiTable("HDMI, Diodenmodus", [["Mechanic T-824", HDMI.ps4Slim]]),
    para(HDMI_NOTE),
    ...pictures(["PS4Slim-HDMI-Mechnic-Readings.jpg", "HDMI, Mechanic T-824"]),
  ]),

  page("PlayStation 4 – verheiratete Chips", "Playstation 4", { brand: "Sony", family: "PlayStation", model: "4" }, [
    note(
      "APU, Syscon, NOR und der Renesas-Chip gehören zusammen: Sie lassen sich nicht einzeln aus einem Spenderboard tauschen. Im Bild markiert auf einer SAA-001.",
      "warning",
    ),
    ...pictures(["Married_chips_sm_.jpg", "Rot APU, grün Syscon, gelb NOR, orange Renesas"]),
  ]),

  page("Xbox Series X – HDMI-Diodenwerte", "Xbox Series X", { brand: "Microsoft", family: "Xbox", model: "Series X" }, [
    hdmiTable("HDMI, Diodenmodus", [["Mechanic T-824", HDMI.seriesX]]),
    para(HDMI_NOTE),
    ...pictures(["Xbox_Series_X-HDMI-Mechnic-Readings.jpg", "HDMI, Mechanic T-824"]),
  ]),

  page("Xbox Series S – HDMI-Diodenwerte", "Xbox Series S", { brand: "Microsoft", family: "Xbox", model: "Series S" }, [
    hdmiTable("HDMI, Diodenmodus", [["Mechanic T-824", HDMI.seriesS]]),
    para(HDMI_NOTE),
    ...pictures(["Xbox_Series_S-HDMI-Mechnic-Readings.jpg", "HDMI, Mechanic T-824"]),
  ]),

  page("Xbox One X – HDMI-Diodenwerte", "Xbox One X", { brand: "Microsoft", family: "Xbox", model: "One X" }, [
    hdmiTable("HDMI, Diodenmodus", [
      ["HDMI-Ausgang", HDMI.oneXOut],
      ["HDMI-Eingang", HDMI.oneXIn],
    ]),
    para(HDMI_NOTE),
    ...pictures(
      ["Xbox_One_X-HDMI-Mechnic-Readings.jpg", "HDMI-Ausgang, Mechanic T-824"],
      ["Xbox_One_X-INPUT_-_HDMI-Mechnic-Readings.jpg", "HDMI-Eingang, Mechanic T-824"],
    ),
  ]),

  page("Xbox One S – HDMI-Diodenwerte", "Xbox One S", { brand: "Microsoft", family: "Xbox", model: "One S" }, [
    hdmiTable("HDMI, Diodenmodus", [["HDMI-Eingang", HDMI.oneSIn]]),
    para(`${HDMI_NOTE} Für den HDMI-Ausgang der One S gibt es auf repair.wiki noch kein Messbild.`),
    ...pictures(
      ["Xbox_One_S-INPUT_-_HDMI-Mechnic-Readings.jpg", "HDMI-Eingang, Mechanic T-824"],
      ["Xbox_One_S_HDMI_In_Mechanic_T-824_Tail_Insertion_Tool_Diode_Mode_Readings.jpg", "HDMI-Eingang, Nahaufnahme"],
    ),
  ]),

  page("HDMI-Diodenwerte – Konsolen im Vergleich", "Category:Game Consoles", { brand: "", family: "", model: "" }, [
    note(`${HDMI_NOTE} Alle Werte mit demselben Tester – hier lassen sich Konsolen untereinander vergleichen.`),
    hdmiTable("Sony", [
      ["PS5", HDMI.ps5],
      ["PS4 Pro", HDMI.ps4Pro],
      ["PS4 Slim", HDMI.ps4Slim],
    ]),
    hdmiTable("Microsoft", [
      ["Series X", HDMI.seriesX],
      ["Series S", HDMI.seriesS],
      ["One X", HDMI.oneXOut],
      ["One X Eingang", HDMI.oneXIn],
      ["One S Eingang", HDMI.oneSIn],
    ]),
  ]),

  page("DualSense – USB-C und Versionen", "Sony Dualsense Controller", { brand: "Sony", family: "DualSense", model: "" }, [
    usbTable("USB-C, Diodenmodus", [
      ["Mechanic T824", mechanicUsbC("GND OL OL .60 1.30 .54 .53 OL .60 OL OL GND GND OL OL .60 OL .53 .54 1.30 .60 OL OL GND")],
    ]),
    {
      type: "table",
      header: true,
      caption: "Version erkennen",
      rows: [
        ["Platine", "R1-Taste abgehebelt", "Tasten-Folie"],
        ["BDM-010", "–", "V1.0"],
        ["BDM-020", "Feder links", "V2.0"],
        ["BDM-030", "Feder rechts", "V3.0"],
        ["BDM-040", "Feder rechts", "V3.0"],
      ],
    },
    para(
      "Die Boardnummer steht auch auf der Platine. Trigger-Flexkabel gibt es in V1.0, V2.0 und V3.0; die Unterschiede sind im Bild markiert.",
    ),
    ...pictures(
      ["Dualsense.jpg", "USB-C, Mechanic T824"],
      ["Dualsense_trigger.png", "Version an R1 und Platine erkennen"],
      ["Flex_dualsense.png", "Tasten-Folien V1.0–V3.0"],
      ["Captura_de_ecrã_2025-08-05,_às_12.28.38.jpg", "Trigger-Flexkabel V1.0–V3.0"],
    ),
  ]),

  page("Xbox Wireless Controller – USB-C Diodenwerte", "Xbox Wireless Controller", { brand: "Microsoft", family: "Xbox Controller", model: "Wireless" }, [
    usbTable("USB-C, Diodenmodus", [
      ["Mechanic T824", mechanicUsbC("GND OL OL .26 1.29 .27 .26 OL .26 OL OL GND GND OL OL .26 OL .26 .27 1.29 .26 OL OL GND")],
    ]),
    ...pictures(["Xboxxcontroller.jpg", "USB-C, Mechanic T824"]),
  ]),

  page(
    "Xbox Elite Series 2 – USB-C Diodenwerte",
    "Xbox Elite Wireless Controller Series 2",
    { brand: "Microsoft", family: "Xbox Controller", model: "Elite Series 2" },
    [
      usbTable("USB-C, Diodenmodus", [
        ["Mechanic T824", mechanicUsbC("GND OL OL .26 1.29 .55 .55 OL .26 OL OL GND GND OL OL .26 OL .55 .55 1.29 .26 OL OL GND")],
      ]),
      ...pictures(["Elite_series_2_diode_readings.jpg", "USB-C, Mechanic T824"]),
    ],
  ),

  page("Game Boy Advance SP – Messwerte", "Gameboy Advance SP", { brand: "Nintendo", family: "Game Boy", model: "Advance SP" }, [
    para("Platine AGT-CPU-01. Diodenmodus, gemessen am PMIC U3 (Mitsumi)."),
    {
      type: "table",
      header: true,
      caption: "U3 PMIC, Diodenmodus, Seiten wie im Bild (U3-Beschriftung unten links)",
      rows: [
        ["Pos.", "Oben\nlinks→rechts", "Links\noben→unten", "Rechts\noben→unten", "Unten\nlinks→rechts"],
        ...Array.from({ length: 12 }, (_, i) => [
          String(i + 1),
          combine([values(".455 .477 .477 .646 .517 .528 .002 .002 .361 .482 .361 .064")[i]]),
          combine([values(".570 .498 .537 .535 OL .537 .538 .531 .531 .531 .538 .536")[i]]),
          combine([values(".064 .292 .002 .292 .539 .064 .146 .002 .146 .538 .402 .510")[i]]),
          combine([values(".535 .537 .481 .431 .362 .362 .002 .527 .532 .535 .486 .203")[i]]),
        ]),
      ],
    },
    {
      type: "table",
      header: true,
      caption: "Trimmpoti VR1, Widerstand in der Schaltung",
      rows: [
        ["Pins", "Wert"],
        ["1–2", "10.4 Ω"],
        ["3–2", "24.8 Ω"],
        ["3–1", "27.3 Ω"],
      ],
    },
    ...pictures(
      ["U3_PMIC_Diode_Readings.jpg", "U3 PMIC"],
      ["TrimPot_Values.jpg", "Trimmpoti VR1"],
      ["Side_A_Resistor_Values.jpg", "Widerstandswerte Seite A (nur im Bild)"],
      ["Side_A_Diode_Readings.jpg", "Diodenwerte Seite A (nur im Bild)"],
      ["Side_B_Diode_Readings.jpg", "Diodenwerte Seite B (nur im Bild)"],
      ["LCD_Connector_Diode_Readings.jpg", "LCD-Anschluss (nur im Bild)"],
    ),
  ]),

  page("Nintendo DS Lite – Ladebuchse und Sicherungen", "Nintendo DS Lite", { brand: "Nintendo", family: "DS", model: "DS Lite" }, [
    para(
      "Platine C/USG-CPU-10. Im Bild markiert: Digitizer-Anschluss P6, EM10 und Sicherung F1 direkt an der Ladebuchse P9, Sicherung F2 bei P7.",
    ),
    note(
      "EM10 im Durchgangsmodus: Die beiden Anschlüsse entlang der langen Seite sind verbunden, quer dazu nicht. Ist EM10 quer durchgängig oder längs offen, ist er defekt.",
      "tip",
    ),
    ...pictures(
      ["Nintendo_DS_Lite_PCB_Bottom_annotated.jpg", "Unterseite: Digitizer P6, EM10, F1, F2"],
      ["Nintendo_DS_Lite_EM10_check.jpg", "EM10 prüfen"],
    ),
  ]),
];
