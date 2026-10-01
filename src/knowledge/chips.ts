/**
 * Chips that come up often in repairs, with what the maker's datasheet or
 * product page says about them. Only facts checked against that source are
 * kept here; a chip without a public datasheet says so.
 */

export interface ChipInfo {
  /** Part number as printed in device names (ISL88739AHRZ-T_QFN32 …). */
  match: RegExp;
  name: string;
  maker: string;
  /** What the chip does on the board. */
  role: string;
  facts: [string, string][];
  /** Maker's product page or datasheet. */
  url: string;
  /** Where it is typically found, when known. */
  usedIn?: string;
}

export const CHIPS: ChipInfo[] = [
  // --- Notebook charging and system power
  {
    match: /\bISL88739A/i,
    name: "ISL88739A",
    maker: "Renesas",
    role: "Akku-Laderegler (Hybrid Power Boost oder Narrow VDC), SMBus",
    facts: [
      ["Eingang", "8–22 V"],
      ["Akku", "2–4 Zellen"],
      ["Schutz", "PROCHOT# bei Unterspannung, Überstrom Netzteil/Akku, Übertemperatur"],
      ["Gehäuse", "QFN-32, 4 × 4 mm"],
    ],
    url: "https://www.renesas.com/en/products/isl88739a",
  },
  {
    match: /\bISL95520/i,
    name: "ISL95520",
    maker: "Renesas",
    role: "Akku-Laderegler (Hybrid Power Boost oder Narrow VDC), SMBus",
    facts: [
      ["Eingang", "4,75–25 V"],
      ["Akku", "2–4 Zellen, Ladespannung in 16-mV-Schritten"],
      ["Schaltfrequenz", "350–1000 kHz"],
      ["Gehäuse", "QFN-32, 4 × 4 mm"],
    ],
    url: "https://www.renesas.com/en/product/ISL95520",
  },
  {
    match: /\bRT6575[CD]/i,
    name: "RT6575C/D",
    maker: "Richtek",
    role: "Systemversorgung: zwei Abwärtsregler plus feste 5-V- und 3,3-V-Linearregler",
    facts: [
      ["Abwärtsregler", "2 × einstellbar 2–5,5 V"],
      ["Linearregler", "5 V und 3,3 V, je bis 100 mA"],
      ["Sonstiges", "Einschaltreihenfolge, Power-Good, Soft-Start, Entladung beim Abschalten"],
      ["Gehäuse", "WQFN-20, 3 × 3 mm"],
    ],
    url: "https://richtek.com/Products/Switching%20Regulators/Single-Phase%20Step-Down%20Controller/RT6575CRT6575D?sc_lang=en",
  },
  {
    match: /\bRT8207P/i,
    name: "RT8207P",
    maker: "Richtek",
    role: "Speicherversorgung DDR: Abwärtsregler für VDDQ, Regler für VTT und VTTREF",
    facts: [
      ["VTT", "Linearregler, 1,5 A Quelle/Senke"],
      ["Schlafzustände", "S3: VTT hochohmig; S4/S5: VDDQ, VTT, VTTREF entladen"],
      ["Speicher", "DDR2 bis DDR4, LPDDR3/LPDDR4"],
      ["Gehäuse", "WQFN-20, 3 × 3 mm"],
    ],
    url: "https://www.richtek.com/assets/product_file/RT8207P/DS8207P-03.pdf",
  },
  {
    match: /\bRT8845B/i,
    name: "RT8845B",
    maker: "Richtek",
    role: "Mehrphasen-Controller (4/3/2/1 Phasen) für Grafik- und Prozessor-Kernspannung",
    facts: [["Gehäuse", "WQFN-32, 4 × 4 mm"]],
    url: "https://www.richtek.com/Products/Switching%20Regulators/Multi-Phase%20Step-Down%20Controller/RT8845B?sc_lang=en",
  },
  {
    match: /\bRT9069/i,
    name: "RT9069",
    maker: "Richtek",
    role: "Linearregler (LDO) mit Enable",
    facts: [
      ["Eingang", "3,5–36 V"],
      ["Ruhestrom", "ab 2 µA"],
    ],
    url: "https://www.richtek.com/en/Products/Linear%20Regulator/Single%20Output%20Linear%20Regulator/RT9069.aspx",
  },
  {
    match: /\bNCP81611/i,
    name: "NCP81611",
    maker: "onsemi",
    role: "Mehrphasen-Controller (bis 4 Phasen) für Prozessor- oder Grafik-Kernspannung, PWM_VID und I²C",
    facts: [["Gehäuse", "QFN-40"]],
    url: "https://www.onsemi.com/products/power-management/dc-dc-power-conversion/controllers/ncp81611",
  },
  {
    match: /\bNCP81253/i,
    name: "NCP81253",
    maker: "onsemi",
    role: "MOSFET-Treiber für High- und Low-Side eines Abwärtswandlers, Bootdiode integriert",
    facts: [
      ["Schutz", "Unterspannungsabschaltung: Ausgänge bleiben low"],
      ["Gehäuse", "DFN-8, 2 × 2 mm"],
    ],
    url: "https://www.farnell.com/datasheets/2118312.pdf",
  },
  {
    match: /\bNCP303151/i,
    name: "NCP303151",
    maker: "onsemi",
    role: "Leistungsstufe: Treiber plus High- und Low-Side-MOSFET, mit Strommessung",
    facts: [
      ["Strom", "bis 50 A Mittelwert"],
      ["MOSFETs", "30 V"],
      ["Schaltfrequenz", "bis 1 MHz"],
      ["PWM-Eingang", "3,3 V oder 5 V"],
    ],
    url: "https://www.onsemi.com/products/power-management/integrated-driver-mosfet/ncp303151",
  },
  {
    match: /\bNCP302045/i,
    name: "NCP302045",
    maker: "onsemi",
    role: "Leistungsstufe: Treiber plus High- und Low-Side-MOSFET",
    facts: [
      ["Strom", "bis 45 A Mittelwert, 75 A Spitze"],
      ["Schaltfrequenz", "bis 2 MHz"],
      ["PWM-Eingang", "3,3 V oder 5 V"],
      ["Schutz", "Temperaturwarnung und -abschaltung"],
    ],
    url: "https://www.onsemi.com/pdf/datasheet/ncp302045-d.pdf",
  },
  {
    match: /\bNCP45491/i,
    name: "NCP45491",
    maker: "onsemi",
    role: "Überwacht Spannung und Strom von bis zu vier Versorgungen und gibt sie gemultiplext aus",
    facts: [["Gehäuse", "QFN-32, 4 × 4 mm"]],
    url: "https://www.onsemi.com/pdf/datasheet/ncp45491-d.pdf",
  },
  {
    match: /\bSY8286/i,
    name: "SY8286",
    maker: "Silergy",
    role: "Abwärtswandler mit integrierten MOSFETs, Power-Good",
    facts: [
      ["Eingang", "4–23 V (SY8286A)"],
      ["Strom", "6 A"],
      ["Schaltfrequenz", "600 kHz"],
      ["Gehäuse", "QFN-20, 3 × 3 mm"],
    ],
    url: "https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/SY8286ARAC_C178251.pdf",
  },
  {
    match: /\bSY8386/i,
    name: "SY8386",
    maker: "Silergy",
    role: "Abwärtswandler mit integrierten MOSFETs",
    facts: [["Strom", "6 A"]],
    url: "https://www.silergy.com/productsview/SY8386TRHC",
  },
  {
    match: /\bSY828[48]/i,
    name: "SY8284 / SY8288",
    maker: "Silergy",
    role: "Abwärtswandler mit integrierten MOSFETs",
    facts: [],
    url: "https://silergy.com/productsview/SY8284BRAC",
  },
  {
    match: /\bTPS2546/i,
    name: "TPS2546",
    maker: "Texas Instruments",
    role: "USB-Ladeport-Controller mit Leistungsschalter und USB-2.0-Datenumschalter (D+/D−); Laden auch im Aus-Zustand (S4/S5)",
    facts: [],
    url: "https://www.ti.com/product/TPS2546-Q1",
  },
  {
    match: /\bTPS22966/i,
    name: "TPS22966",
    maker: "Texas Instruments",
    role: "Doppelter Lastschalter (zwei N-MOSFETs) mit Einschaltrampe",
    facts: [
      ["Eingang", "0,8–5,5 V"],
      ["Strom", "6 A je Kanal"],
      ["Ausgang aus", "Entladung über 220 Ω"],
    ],
    url: "https://www.ti.com/product/TPS22966",
  },
  {
    match: /\bKB9542/i,
    name: "KB9542",
    maker: "ENE",
    role: "Embedded Controller (EC) des Notebooks",
    facts: [
      ["Datenblatt", "nicht öffentlich"],
      ["Gehäuse", "LQFP-128"],
    ],
    url: "https://www.ene.com.tw/",
  },

  // --- Consoles
  {
    match: /\bB?M92T36/i,
    name: "M92T36",
    maker: "ROHM",
    role: "USB-C Power Delivery: handelt mit Netzteil oder Dock die Spannung aus",
    facts: [["CC-Pin", "max. 6 V"]],
    url: "https://www.chargerlab.com/the-reasons-behind-the-nintendo-switch-bricking-situation",
    usedIn: "Nintendo Switch, Switch Lite, Switch OLED",
  },
  {
    match: /\bBQ24193/i,
    name: "BQ24193",
    maker: "Texas Instruments",
    role: "Akku-Laderegler für 1 Zelle mit Power-Path und USB-OTG",
    facts: [
      ["Eingang", "3,9–17 V, max. 22 V"],
      ["Ladestrom", "bis 4,5 A"],
    ],
    url: "https://www.ti.com/product/BQ24193",
    usedIn: "Nintendo Switch",
  },
  {
    match: /\bMAX17050/i,
    name: "MAX17050",
    maker: "Maxim (Analog Devices)",
    role: "Ladestandsmessung (Fuel Gauge)",
    facts: [],
    url: "https://repair.wiki/w/Nintendo_Switch",
    usedIn: "Nintendo Switch",
  },
  {
    match: /\bMAX77620/i,
    name: "MAX77620",
    maker: "Maxim (Analog Devices)",
    role: "System-PMIC",
    facts: [["Ausstattung", "13 Spannungsregler, 8 GPIOs, RTC, Einschaltreihenfolge"]],
    url: "https://www.kernel.org/doc/Documentation/devicetree/bindings/mfd/max77620.txt",
    usedIn: "Nintendo Switch (Seite B)",
  },
  {
    match: /\bMAX77621/i,
    name: "MAX77621",
    maker: "Maxim (Analog Devices)",
    role: "Dreiphasiger Abwärtswandler für CPU und RAM",
    facts: [["Strom", "bis 16 A"]],
    url: "https://lab.nexedi.cn/kirr/linux/-/commit/0f7d6ece6363f315b3b830dc19e6732537719224",
    usedIn: "Nintendo Switch",
  },
  {
    match: /\bPI3USB30532/i,
    name: "PI3USB30532",
    maker: "Diodes Inc.",
    role: "Umschalter USB 3 / DisplayPort an der USB-C-Buchse",
    facts: [["Versorgung", "3,0–3,6 V"]],
    url: "https://diodes.com/part/PI3USB30532",
    usedIn: "Nintendo Switch (Bild am Dock)",
  },
  {
    match: /\bMN864739/i,
    name: "MN864739",
    maker: "Panasonic",
    role: "HDMI-Encoder",
    facts: [["Datenblatt", "nicht öffentlich"]],
    url: "https://www.5g-m.com/en/spare-parts-playstation-5/32346-hdmi-ic-mn864739-ps5.html",
    usedIn: "PlayStation 5",
  },
  {
    match: /\b(SN75)?TDP158/i,
    name: "TDP158",
    maker: "Texas Instruments",
    role: "HDMI-Redriver (TMDS) bis 6 Gbit/s",
    facts: [["Versorgung", "VDD 1,1 V, VCC 3,3 V"]],
    url: "https://www.ti.com/product/TDP158",
    usedIn: "Xbox One X",
  },
  {
    match: /\bNB7NQ?621M/i,
    name: "NB7NQ621M",
    maker: "onsemi",
    role: "HDMI-2.1-Redriver (linear, 4 Kanäle), I²C",
    facts: [["Versorgung", "3,3 V"]],
    url: "https://www.onsemi.com/products/signal-conditioning-control/redrivers/nb7nq621m",
    usedIn: "Xbox Series X / S (Aufschrift NB7N621M)",
  },
];

/** The chip a part's device name names, if Avero knows it. */
export function chipFor(device: string | undefined): ChipInfo | undefined {
  if (!device) return undefined;
  return CHIPS.find((c) => c.match.test(device));
}
