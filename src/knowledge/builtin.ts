/**
 * Reference values that ship with Avero, read off the measurement pictures
 * of repair.wiki. Like their source, the values in this file are licensed
 * under CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
 */
import type { KnowledgePage } from "./store";

const SWITCH_OLED = "https://repair.wiki/w/Nintendo_Switch_OLED";

/** Pages built into Avero; they show like imported pages but cannot be removed. */
export const BUILTIN_PAGES: KnowledgePage[] = [
  {
    title: "Nintendo Switch OLED – USB-C Diodenwerte",
    url: SWITCH_OLED,
    categories: ["Nintendo Switch OLED", "Referenzwerte"],
    device: { brand: "Nintendo", family: "Switch", model: "OLED" },
    imported: "2026-10-01T00:00:00Z",
    source: "repair.wiki",
    license: "CC BY-SA 3.0",
    builtin: true,
    blocks: [
      {
        type: "note",
        kind: "warning",
        text: "Jeder Tester misst mit eigenem Strom: VBUS zeigt 0,53 auf Mechanic und JCID, aber 0,81 auf YCS TNS 360 und iBridge. Nur mit der Spalte des eigenen Testers vergleichen.",
      },
      {
        type: "paragraph",
        text: "Gute Switch OLED (HEG-CPU-01), USB-C-Buchse im Diodenmodus über Tail-Plug-Tester gemessen. Zwei Werte (A / B) stehen dort, wo die beiden Seiten der Buchse verschieden messen. OL = offen, TX/RX sind auf der Switch nicht belegt.",
      },
      {
        type: "table",
        header: true,
        caption: "USB-C, Diodenmodus",
        rows: [
          ["Signal (Pins)", "Mechanic T824", "Mechanic T824SE", "JCID CD01", "Qianli iBridge A3", "YCS TNS 360", "YCS Tail Plug", "2UUL PW31"],
          ["VBUS\nA4 A9 B4 B9", "0.53", "0.53", "0.528", "0.814", "0.812", "0.519–0.529", "0.520–0.529"],
          ["CC1\nA5", "0.50", "0.50", "0.506", "0.504", "0.502", "0.485", "0.484"],
          ["CC2\nB5", "0.50", "0.50", "0.506", "0.504", "0.502", "0.493", "0.492"],
          ["D+\nA6 B6", "0.46", "0.46 / 0.47", "0.476", "0.482 / 0.483", "0.481", "0.456 / 0.464", "0.454 / 0.462"],
          ["D−\nA7 B7", "0.46", "0.46 / 0.47", "0.476", "0.483", "0.481", "0.454 / 0.464", "0.454 / 0.462"],
          ["SBU1\nA8", "0.75", "0.75", "0.753", "0.762", "0.759", "0.738", "0.739"],
          ["SBU2\nB8", "0.75", "0.75", "0.752", "0.762", "0.759", "0.745", "0.749"],
          ["TX/RX\nA2 A3 A10 A11\nB2 B3 B10 B11", "OL", "OL", "OL", "OL", "OL", "OL", "OL"],
          ["GND\nA1 A12 B1 B12", "GND", "GND", "0", "GND", "GND", "GND", "GND"],
        ],
      },
      {
        type: "note",
        kind: "note",
        text: "Ein weiteres Mechanic-Foto einer ausgebauten Platine zeigt VBUS 0.50, CC1/CC2 0.51, D+/D− 0.78 und SBU1/SBU2 0.73. D+/D− weichen dort deutlich von den übrigen Messungen (um 0.46–0.48) ab. Bei Abweichungen ein bekannt gutes Gerät mit demselben Tester gegenmessen.",
      },
      { type: "heading", level: 2, text: "Messbilder" },
      {
        type: "paragraph",
        text: "Werte aus diesen Bildern abgelesen; im Zweifel gilt das Bild. Die Werte für Display- und Spielkarten-Anschluss stehen nur im Bild.",
      },
      {
        type: "gallery",
        items: [
          { file: "Nintendo Switch OLED Diode Readings Mechanic T824.jpg", caption: "Mechanic T824" },
          { file: "Nintendo Switch OLED Diode Readings Mechanic T824SE.jpg", caption: "Mechanic T824SE" },
          { file: "Nintendo Switch OLED Diode Readings JCS CD01.jpg", caption: "JCID CD01" },
          { file: "Nintendo Switch OLED Diode Readings Qianli iBridge.jpg", caption: "Qianli iBridge A3" },
          { file: "Nintendo Switch OLED Diode Readings YCS TNS 360.jpg", caption: "YCS TNS 360" },
          { file: "Nintendo Switch OLED Diode Readings YCS Tail Plug Tester.jpg", caption: "YCS Tail Plug Tester" },
          { file: "Nintendo Switch OLED Diode Readings 2UUL PW31.jpg", caption: "2UUL PW31" },
          { file: "Switch OLED Mechanic Readings.jpg", caption: "Mechanic, ausgebaute Platine" },
          { file: "Switch-oled-display-connector-diode-readings.jpg", caption: "Display- und Spielkarten-Anschluss, Diodenwerte je Pin" },
        ],
      },
    ],
  },
];
