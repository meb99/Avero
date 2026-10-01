/**
 * Chips that come up often in repairs, with what the maker's datasheet or
 * product page says about them. Only facts checked against that source are
 * kept here; a chip without a public datasheet says so.
 */

/** One pin as the datasheet names it. */
export interface ChipPin {
  name: string;
  /** What the pin does, short. */
  role: string;
  /** Ground pin: used to check that the board numbers pins like the datasheet. */
  ground?: boolean;
  /** Supply or rail pin: its net is named after the rail, not after the pin. */
  power?: boolean;
  /** Other names the pin's net may carry on a board (LGATE → LG, DRVL). */
  aka?: string[];
  /** What should be there, when the datasheet says. */
  expect?: string;
}

export interface Pinout {
  /** Datasheet and package the numbering is from. */
  source: string;
  pins: Record<string, ChipPin>;
  /** Exposed pad without a number in the datasheet. */
  pad?: ChipPin;
}

type PinEntry = [numbers: string, name: string, role: string, extra?: Partial<ChipPin>];

/** Pins from table rows; "2-5,19" stands for 2, 3, 4, 5 and 19. */
function pinout(source: string, rows: PinEntry[], pad?: ChipPin): Pinout {
  const pins: Record<string, ChipPin> = {};
  for (const [numbers, name, role, extra] of rows)
    for (const part of numbers.split(",")) {
      const [a, b] = part.trim().split("-").map(Number);
      for (let n = a; n <= (b || a); n++) pins[String(n)] = { name, role, ...extra };
    }
  return { source, pins, ...(pad && { pad }) };
}

const G = { ground: true } as const;
const P = { power: true } as const;
const GATE_LOW = { aka: ["LG", "LGATE", "DRVL", "GL", "LDRV"] };
const GATE_HIGH = { aka: ["UG", "UGATE", "DRVH", "GH", "HDRV"] };
const BOOT = { aka: ["BST", "BOOT", "BS", "BTST"] };
const SWITCH_NODE = { aka: ["LX", "PHASE", "SW", "VSW"] };

/** What a chip does in a power path, for the fault-finding guide. */
export type ChipKind = "charger" | "system" | "ddr" | "vcore" | "driver" | "stage" | "buck" | "ldo" | "switch" | "usb" | "ec" | "pd" | "monitor" | "pmic" | "gauge" | "video";

export interface ChipInfo {
  /** Part number as printed in device names (ISL88739AHRZ-T_QFN32 …). */
  match: RegExp;
  kind: ChipKind;
  name: string;
  maker: string;
  /** What the chip does on the board. */
  role: string;
  facts: [string, string][];
  /** Maker's product page or datasheet. */
  url: string;
  /** Where it is typically found, when known. */
  usedIn?: string;
  /** Pin functions from the datasheet, checked against each board before they are shown. */
  pinout?: Pinout;
}

export const CHIPS: ChipInfo[] = [
  // --- Notebook charging and system power
  {
    match: /\bISL88739A/i,
    name: "ISL88739A",
    kind: "charger",
    maker: "Renesas",
    role: "Akku-Laderegler (Hybrid Power Boost oder Narrow VDC), SMBus",
    facts: [
      ["Eingang", "8–22 V"],
      ["Akku", "2–4 Zellen"],
      ["Schutz", "PROCHOT# bei Unterspannung, Überstrom Netzteil/Akku, Übertemperatur"],
      ["Gehäuse", "QFN-32, 4 × 4 mm"],
    ],
    url: "https://www.renesas.com/en/products/isl88739a",
    pinout: pinout(
      "Renesas FN8953 Rev. 1.00, QFN-32 4×4",
      [
        ["1", "ACIN", "Netzteil-Spannungserkennung", { expect: "2–3,5 V = Netzteil gültig; über 3,5 V Überspannung (ASGATE schaltet ab)" }],
        ["2", "ACOK", "Open-Drain: Netzteil bereit", { aka: ["ACOK", "AC_IN", "ACIN", "ACPRN"], expect: "Low, solange das Netzteil nicht bereit ist" }],
        ["3", "SDA", "SMBus-Daten"],
        ["4", "SCL", "SMBus-Takt"],
        ["5", "PROCHOT#", "Open-Drain: drosselt die CPU", { expect: "Low bei Netzteil-/Akku-Überstrom, niedriger Systemspannung oder NTC unter 170 mV" }],
        ["6", "AMON", "Netzteil-Strommonitor", { expect: "32 × (CSIP − CSIN)" }],
        ["7", "BMON", "Akku-Entladestrommonitor", { expect: "32 × (CSON − CSOP)" }],
        ["8", "NC", "nicht belegt"],
        ["9", "PROG", "Widerstand nach GND: HPB/NVDC, Zellenzahl, Shunt-Werte"],
        ["10", "COMP", "Fehlerverstärker-Ausgang (Kompensation)"],
        ["11", "CCLIM", "Schwelle für Ladestrom-Überstrom"],
        ["12", "FSET", "Widerstand nach GND: Schaltfrequenz", { aka: ["FSET", "FSW"] }],
        ["13", "BATGONE", "Akku vorhanden?", { expect: "High = Akku entfernt, Low = Akku da" }],
        ["14", "CSON", "Akkustrom-Shunt −, misst auch Systemspannung (NVDC)"],
        ["15", "CSOP", "Akkustrom-Shunt +"],
        ["16", "ACLIM", "Hardware-Grenze Netzteilstrom"],
        ["17", "NTC", "Thermistor, 10 µA Quelle", { expect: "unter 170 mV löst PROCHOT# aus" }],
        ["18", "DCIN", "Eingang des internen 5-V-LDO (Diode-OR Netzteil/Akku)", P],
        ["19", "VDD", "5-V-Versorgung der Steuerung", { ...P, expect: "5 V" }],
        ["20", "VDDP", "Ausgang interner 5-V-LDO, Treiberversorgung", { ...P, expect: "5 V" }],
        ["21", "LGATE", "Gate Low-Side-MOSFET", GATE_LOW],
        ["22", "PHASE", "Schaltknoten", SWITCH_NODE],
        ["23", "UGATE", "Gate High-Side-MOSFET", GATE_HIGH],
        ["24", "BOOT", "Bootstrap-Kondensator", BOOT],
        ["25", "BGATE", "Gate Akku-MOSFET (BATFET)"],
        ["26", "VBAT", "Akkuspannung, Rückleitung BGATE", P],
        ["27", "QPCP", "Ladungspumpe +", { aka: ["QPCP", "OPCP"] }],
        ["28", "QPCN", "Ladungspumpe −", { aka: ["QPCN", "OPCN"] }],
        ["29", "CMSRC", "gemeinsame Source der ASGATE-MOSFETs"],
        ["30", "ASGATE", "Gate der Netzteil-Trenn-MOSFETs"],
        ["31", "CSIN", "Netzteilstrom-Shunt −"],
        ["32", "CSIP", "Netzteilstrom-Shunt +, misst auch Eingangsspannung"],
      ],
      { name: "GND", role: "Masse (Bodenpad)", ground: true },
    ),
  },
  {
    match: /\bISL95520/i,
    name: "ISL95520",
    kind: "charger",
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
    kind: "system",
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
    kind: "ddr",
    maker: "Richtek",
    role: "Speicherversorgung DDR: Abwärtsregler für VDDQ, Regler für VTT und VTTREF",
    facts: [
      ["VTT", "Linearregler, 1,5 A Quelle/Senke"],
      ["Schlafzustände", "S3: VTT hochohmig; S4/S5: VDDQ, VTT, VTTREF entladen"],
      ["Speicher", "DDR2 bis DDR4, LPDDR3/LPDDR4"],
      ["Gehäuse", "WQFN-20, 3 × 3 mm"],
    ],
    url: "https://www.richtek.com/assets/product_file/RT8207P/DS8207P-03.pdf",
    pinout: pinout("Richtek DS8207P-03, WQFN-20L 3×3", [
      ["1", "VTTGND", "Masse des VTT-Reglers", G],
      ["2", "VTTSNS", "Messeingang VTT", P],
      ["3,21", "GND", "Masse (21 = Bodenpad)", G],
      ["4", "VTTREF", "Referenzausgang", { expect: "½ VDDQ" }],
      ["5", "VDDQ", "Referenz für VTT/VTTREF, Rückführung VDDQ", { ...P, expect: "DDR3 1,5 V, DDR2 1,8 V, sonst 0,75–3,3 V über Teiler" }],
      ["6", "FB", "VDDQ-Einstellung: GND = DDR3, VDD = DDR2, sonst Teiler"],
      ["7", "S3", "Steuereingang S3", { aka: ["S3", "EN"] }],
      ["8", "S5", "Steuereingang S5", { aka: ["S5", "EN"] }],
      ["9", "TON", "Einschaltzeit über Widerstand nach VIN"],
      ["10", "PGOOD", "Open-Drain: VDDQ im Sollbereich", { aka: ["PGOOD", "PG", "PWRGD", "POK"], expect: "High, wenn VDDQ stimmt" }],
      ["11", "VDD", "Versorgung Analogteil", P],
      ["12", "VDDP", "Versorgung Low-Side-Treiber", P],
      ["13", "CS", "Stromgrenze über Widerstand nach VDD"],
      ["14", "PGND", "Masse Low-Side-MOSFET", G],
      ["15", "LGATE", "Gate Low-Side-MOSFET", GATE_LOW],
      ["16", "PHASE", "Schaltknoten", SWITCH_NODE],
      ["17", "UGATE", "Gate High-Side-MOSFET", GATE_HIGH],
      ["18", "BOOT", "Bootstrap-Kondensator", BOOT],
      ["19", "VLDOIN", "Versorgung VTT-Regler", P],
      ["20", "VTT", "Ausgang VTT", { ...P, expect: "½ VDDQ" }],
    ]),
  },
  {
    match: /\bRT8845B/i,
    name: "RT8845B",
    kind: "vcore",
    maker: "Richtek",
    role: "Mehrphasen-Controller (4/3/2/1 Phasen) für Grafik- und Prozessor-Kernspannung",
    facts: [["Gehäuse", "WQFN-32, 4 × 4 mm"]],
    url: "https://www.richtek.com/Products/Switching%20Regulators/Multi-Phase%20Step-Down%20Controller/RT8845B?sc_lang=en",
  },
  {
    match: /\bRT9069/i,
    name: "RT9069",
    kind: "ldo",
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
    kind: "vcore",
    maker: "onsemi",
    role: "Mehrphasen-Controller (bis 4 Phasen) für Prozessor- oder Grafik-Kernspannung, PWM_VID und I²C",
    facts: [["Gehäuse", "QFN-40"]],
    url: "https://www.onsemi.com/products/power-management/dc-dc-power-conversion/controllers/ncp81611",
  },
  {
    match: /\bNCP81253/i,
    name: "NCP81253",
    kind: "driver",
    maker: "onsemi",
    role: "MOSFET-Treiber für High- und Low-Side eines Abwärtswandlers, Bootdiode integriert",
    facts: [
      ["Schutz", "Unterspannungsabschaltung: Ausgänge bleiben low"],
      ["Gehäuse", "DFN-8, 2 × 2 mm"],
    ],
    url: "https://www.farnell.com/datasheets/2118312.pdf",
    pinout: pinout("onsemi NCP81253, DFN-8 2×2", [
      ["1", "BST", "Bootstrap-Versorgung High-Side-Treiber", BOOT],
      ["2", "PWM", "Steuereingang: High = DRVH an, Mitte = beide aus, Low = DRVL an"],
      ["3", "EN", "Freigabe: High = an, Mitte = beide Gates aus, Low = aus", { aka: ["EN", "DRON"] }],
      ["4", "VCC", "Versorgung", P],
      ["5", "DRVL", "Gate Low-Side-MOSFET", GATE_LOW],
      ["6", "GND", "Masse", G],
      ["7", "SW", "Schaltknoten", SWITCH_NODE],
      ["8", "DRVH", "Gate High-Side-MOSFET", GATE_HIGH],
      ["9", "FLAG", "Wärmepad, ohne elektrische Verbindung, an Masse", G],
    ]),
  },
  {
    match: /\bNCP303151/i,
    name: "NCP303151",
    kind: "stage",
    maker: "onsemi",
    role: "Leistungsstufe: Treiber plus High- und Low-Side-MOSFET, mit Strommessung",
    facts: [
      ["Strom", "bis 50 A Mittelwert"],
      ["MOSFETs", "30 V"],
      ["Schaltfrequenz", "bis 1 MHz"],
      ["PWM-Eingang", "3,3 V oder 5 V"],
      ["Versorgung", "VCC/PVCC 4,5–5,5 V (typ. 5 V), Unterspannungsabschaltung 4,1 V"],
    ],
    url: "https://www.onsemi.com/products/power-management/integrated-driver-mosfet/ncp303151",
    pinout: pinout("onsemi NCP303151, PQFN 5×6", [
      ["1,31", "NC", "nicht belegt"],
      ["2", "AGND", "Analogmasse", G],
      ["3", "VCC", "Versorgung Steuerung", { ...P, expect: "4,5–5,5 V" }],
      ["4", "PVCC", "Versorgung Low-Side-Treiber und Bootdiode", { ...P, expect: "4,5–5,5 V" }],
      ["5,40", "PGND", "Masse für PVCC-Kondensator", G],
      ["6,41", "GL", "Gate Low-Side (Messpunkt)", GATE_LOW],
      ["7-9,20-24", "PGND", "Leistungsmasse", G],
      ["10-19", "SW", "Schaltknoten", SWITCH_NODE],
      ["25-30", "VIN", "Eingangsspannung", P],
      ["32", "PHASE", "Rückleitung Bootstrap-Kondensator", SWITCH_NODE],
      ["33", "BOOT", "Bootstrap-Versorgung", BOOT],
      ["34", "PWM", "PWM-Eingang"],
      ["35", "DISB#", "Freigabe: High = Treiber an", { aka: ["DISB", "DRON", "EN"] }],
      ["36", "FAULT", "Fehlermeldung", { aka: ["FAULT", "FLT"] }],
      ["37", "ZCD_EN", "Nullstrom-Erkennung an"],
      ["38", "IMON", "Strommonitor-Ausgang", { aka: ["IMON", "CSP", "CS"] }],
      ["39", "REFIN", "Referenz für IMON"],
    ]),
  },
  {
    match: /\bNCP302045/i,
    name: "NCP302045",
    kind: "stage",
    maker: "onsemi",
    role: "Leistungsstufe: Treiber plus High- und Low-Side-MOSFET",
    facts: [
      ["Strom", "bis 45 A Mittelwert, 75 A Spitze"],
      ["Schaltfrequenz", "bis 2 MHz"],
      ["PWM-Eingang", "3,3 V oder 5 V"],
      ["Schutz", "Temperaturwarnung und -abschaltung"],
      ["Versorgung", "VCC/VCCD 4,5–5,5 V (typ. 5 V); VIN 4,5–20 V"],
    ],
    url: "https://www.onsemi.com/pdf/datasheet/ncp302045-d.pdf",
    pinout: pinout("onsemi NCP302045, PQFN-31 5×5", [
      ["1", "PWM", "PWM-Eingang, Nullstrom-Erkennung"],
      ["2", "SMOD#", "Skip-Modus (3 Zustände)"],
      ["3", "VCC", "Versorgung Steuerung", { ...P, expect: "4,5–5,5 V" }],
      ["4,32", "CGND", "Signalmasse (32 = Pad)", G],
      ["5", "BOOT", "Bootstrap-Versorgung", BOOT],
      ["6", "NC", "nicht belegt"],
      ["7", "PHASE", "Rückleitung Bootstrap-Kondensator", SWITCH_NODE],
      ["8-11", "VIN", "Eingangsspannung", { ...P, expect: "4,5–20 V" }],
      ["12-15,28", "PGND", "Leistungsmasse", G],
      ["16-26", "VSW", "Schaltknoten", SWITCH_NODE],
      ["27,33", "GL", "Gate Low-Side (33 = Pad)", GATE_LOW],
      ["29", "VCCD", "Treiberversorgung", { ...P, expect: "4,5–5,5 V" }],
      ["30", "DISB#", "Freigabe: High = Treiber an", { aka: ["DISB", "DRON", "EN"] }],
      ["31", "THWN", "Open-Drain: Temperaturwarnung (Low)"],
    ]),
  },
  {
    match: /\bNCP45491/i,
    name: "NCP45491",
    kind: "monitor",
    maker: "onsemi",
    role: "Überwacht Spannung und Strom von bis zu vier Versorgungen und gibt sie gemultiplext aus",
    facts: [["Gehäuse", "QFN-32, 4 × 4 mm"]],
    url: "https://www.onsemi.com/pdf/datasheet/ncp45491-d.pdf",
  },
  {
    match: /\bSY8286/i,
    name: "SY8286",
    kind: "buck",
    maker: "Silergy",
    role: "Abwärtswandler mit integrierten MOSFETs, Power-Good",
    facts: [
      ["Eingang", "4–23 V (SY8286A)"],
      ["Strom", "6 A"],
      ["Schaltfrequenz", "600 kHz"],
      ["Gehäuse", "QFN-20, 3 × 3 mm"],
    ],
    url: "https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/SY8286ARAC_C178251.pdf",
    pinout: pinout(
      "Silergy AN_SY8286A Rev. 0.9C, QFN3x3-20",
      [
        ["1", "BS", "Bootstrap, 0,1 µF nach LX", BOOT],
        ["2-5", "IN", "Eingang", P],
        ["6,19,20", "LX", "Schaltknoten (Spule)", SWITCH_NODE],
        ["7,8,18", "GND", "Masse", G],
        ["9", "PG", "Open-Drain Power-Good", { aka: ["PG", "PGOOD", "PWRGD"], expect: "High bei 90–120 % der Sollspannung" }],
        ["10,16", "NC", "nicht belegt"],
        ["11", "EN", "Freigabe: High = an", { expect: "High = an, nicht offen lassen" }],
        ["12", "MODE", "Leichtlast: Low = PFM, High = PWM"],
        ["13", "ILMT", "Stromgrenze"],
        ["14", "FB", "Rückführung vom Spannungsteiler"],
        ["15", "BYP", "externer 3,3-V-Bypass-Eingang", { ...P, expect: "3,3 V oder offen" }],
        ["17", "VCC", "interner 3,3-V-LDO", { aka: ["VCC", "LDO"], expect: "3,3 V" }],
      ],
      { name: "GND", role: "Masse (Bodenpad)", ground: true },
    ),
  },
  {
    match: /\bSY8386/i,
    name: "SY8386",
    kind: "buck",
    maker: "Silergy",
    role: "Abwärtswandler mit integrierten MOSFETs",
    facts: [["Strom", "6 A"]],
    url: "https://www.silergy.com/productsview/SY8386TRHC",
  },
  {
    match: /\bSY828[48]/i,
    name: "SY8284 / SY8288",
    kind: "buck",
    maker: "Silergy",
    role: "Abwärtswandler mit integrierten MOSFETs",
    facts: [],
    url: "https://silergy.com/productsview/SY8284BRAC",
  },
  {
    match: /\bTPS2546/i,
    name: "TPS2546",
    kind: "usb",
    maker: "Texas Instruments",
    role: "USB-Ladeport-Controller mit Leistungsschalter und USB-2.0-Datenumschalter (D+/D−); Laden auch im Aus-Zustand (S4/S5)",
    facts: [],
    url: "https://www.ti.com/product/TPS2546-Q1",
    pinout: pinout(
      "TI TPS2546 (SLVSBJ2C), QFN-16",
      [
        ["1", "IN", "Eingang und Versorgung", P],
        ["2", "DM_OUT", "D− zum USB-Host"],
        ["3", "DP_OUT", "D+ zum USB-Host"],
        ["4", "ILIM_SEL", "Lademodus, Stromgrenze, Lasterkennung"],
        ["5", "EN", "Freigabe: Low = Schalter aus, OUT wird entladen"],
        ["6", "CTL1", "Lademodus"],
        ["7", "CTL2", "Lademodus"],
        ["8", "CTL3", "Lademodus"],
        ["9", "STATUS", "Open-Drain: Last erkannt (Low)"],
        ["10", "DP_IN", "D+ zur Buchse"],
        ["11", "DM_IN", "D− zur Buchse"],
        ["12", "OUT", "Ausgang Leistungsschalter (VBUS der Buchse)", P],
        ["13", "FAULT", "Open-Drain: Übertemperatur oder Stromgrenze (Low)"],
        ["14", "GND", "Masse", G],
        ["15", "ILIM_LO", "Widerstand: untere Stromgrenze"],
        ["16", "ILIM_HI", "Widerstand: obere Stromgrenze"],
      ],
      { name: "GND", role: "Wärmepad, intern an GND", ground: true },
    ),
  },
  {
    match: /\bTPS22966/i,
    name: "TPS22966",
    kind: "switch",
    maker: "Texas Instruments",
    role: "Doppelter Lastschalter (zwei N-MOSFETs) mit Einschaltrampe",
    facts: [
      ["Eingang", "0,8–5,5 V"],
      ["Strom", "6 A je Kanal"],
      ["Ausgang aus", "Entladung über 220 Ω"],
    ],
    url: "https://www.ti.com/product/TPS22966",
    pinout: pinout(
      "TI TPS22966 (SLVSBH4F), WSON-14",
      [
        ["1,2", "VIN1", "Eingang Schalter 1", { ...P, expect: "0,8 V bis VBIAS" }],
        ["3", "ON1", "Schalter 1 an (High)", { aka: ["ON1", "ON", "EN"] }],
        ["4", "VBIAS", "Versorgung", { ...P, expect: "2,5–5,5 V" }],
        ["5", "ON2", "Schalter 2 an (High)", { aka: ["ON2", "ON", "EN"] }],
        ["6,7", "VIN2", "Eingang Schalter 2", { ...P, expect: "0,8 V bis VBIAS" }],
        ["8,9", "VOUT2", "Ausgang Schalter 2", P],
        ["10", "CT2", "Anstiegszeit Schalter 2 (Kondensator)"],
        ["11", "GND", "Masse", G],
        ["12", "CT1", "Anstiegszeit Schalter 1 (Kondensator)"],
        ["13,14", "VOUT1", "Ausgang Schalter 1", P],
      ],
      { name: "GND", role: "Wärmepad, an GND", ground: true },
    ),
  },
  {
    match: /\bKB9542/i,
    name: "KB9542",
    kind: "ec",
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
    kind: "pd",
    maker: "ROHM",
    role: "USB-C Power Delivery: handelt mit Netzteil oder Dock die Spannung aus",
    facts: [["CC-Pin", "max. 6 V"]],
    url: "https://www.chargerlab.com/the-reasons-behind-the-nintendo-switch-bricking-situation",
    usedIn: "Nintendo Switch, Switch Lite, Switch OLED",
  },
  {
    match: /\bBQ24193/i,
    name: "BQ24193",
    kind: "charger",
    maker: "Texas Instruments",
    role: "Akku-Laderegler für 1 Zelle mit Power-Path und USB-OTG",
    facts: [
      ["Eingang", "3,9–17 V, max. 22 V"],
      ["Ladestrom", "bis 4,5 A"],
    ],
    url: "https://www.ti.com/product/BQ24193",
    usedIn: "Nintendo Switch",
    pinout: pinout(
      "TI bq24193 (SLUSBG7A), QFN-24",
      [
        ["1,24", "VBUS", "Ladeeingang", P],
        ["2", "PSEL", "Quelle: High = USB-Host, Low = Netzteil"],
        ["3", "PG", "Open-Drain: Eingang gut (Low)", { aka: ["PG", "PGOOD"] }],
        ["4", "STAT", "Open-Drain: Low = lädt, High = fertig/aus, blinkt 1 Hz bei Fehler"],
        ["5", "SCL", "I²C-Takt"],
        ["6", "SDA", "I²C-Daten"],
        ["7", "INT", "Open-Drain: Interrupt (256-µs-Puls, Low)"],
        ["8", "OTG", "USB-Stromgrenze im Buck-Betrieb, Freigabe Boost (OTG)"],
        ["9", "CE", "Laden freigeben (Low)"],
        ["10", "ILIM", "Widerstand nach GND: max. Eingangsstrom", { expect: "regelt auf 1 V" }],
        ["11", "TS1", "Thermistor 1 (mit TS2 verbunden)"],
        ["12", "TS2", "Thermistor 2 (mit TS1 verbunden)"],
        ["13,14", "BAT", "Akku +", P],
        ["15,16", "SYS", "Systemversorgung", P],
        ["17,18", "PGND", "Leistungsmasse", G],
        ["19,20", "SW", "Schaltknoten", SWITCH_NODE],
        ["21", "BTST", "Bootstrap, 47 nF nach SW", BOOT],
        ["22", "REGN", "Treiberversorgung, Bias für TS1/TS2", P],
        ["23", "PMID", "Mittelknoten Rückstrom-MOSFET/High-Side", P],
      ],
      { name: "PGND", role: "Wärmepad, an PGND", ground: true },
    ),
  },
  {
    match: /\bMAX17050/i,
    name: "MAX17050",
    kind: "gauge",
    maker: "Maxim (Analog Devices)",
    role: "Ladestandsmessung (Fuel Gauge)",
    facts: [],
    url: "https://repair.wiki/w/Nintendo_Switch",
    usedIn: "Nintendo Switch",
  },
  {
    match: /\bMAX77620/i,
    name: "MAX77620",
    kind: "pmic",
    maker: "Maxim (Analog Devices)",
    role: "System-PMIC",
    facts: [["Ausstattung", "13 Spannungsregler, 8 GPIOs, RTC, Einschaltreihenfolge"]],
    url: "https://www.kernel.org/doc/Documentation/devicetree/bindings/mfd/max77620.txt",
    usedIn: "Nintendo Switch (Seite B)",
  },
  {
    match: /\bMAX77621/i,
    name: "MAX77621",
    kind: "buck",
    maker: "Maxim (Analog Devices)",
    role: "Dreiphasiger Abwärtswandler für CPU und RAM",
    facts: [["Strom", "bis 16 A"]],
    url: "https://lab.nexedi.cn/kirr/linux/-/commit/0f7d6ece6363f315b3b830dc19e6732537719224",
    usedIn: "Nintendo Switch",
  },
  {
    match: /\bPI3USB30532/i,
    name: "PI3USB30532",
    kind: "video",
    maker: "Diodes Inc.",
    role: "Umschalter USB 3 / DisplayPort an der USB-C-Buchse",
    facts: [["Versorgung", "3,0–3,6 V"]],
    url: "https://diodes.com/part/PI3USB30532",
    usedIn: "Nintendo Switch (Bild am Dock)",
  },
  {
    match: /\bMN864739/i,
    name: "MN864739",
    kind: "video",
    maker: "Panasonic",
    role: "HDMI-Encoder",
    facts: [["Datenblatt", "nicht öffentlich"]],
    url: "https://www.5g-m.com/en/spare-parts-playstation-5/32346-hdmi-ic-mn864739-ps5.html",
    usedIn: "PlayStation 5",
  },
  {
    match: /\b(SN75)?TDP158/i,
    name: "TDP158",
    kind: "video",
    maker: "Texas Instruments",
    role: "HDMI-Redriver (TMDS) bis 6 Gbit/s",
    facts: [["Versorgung", "VDD 1,1 V, VCC 3,3 V"]],
    url: "https://www.ti.com/product/TDP158",
    usedIn: "Xbox One X",
  },
  {
    match: /\bNB7NQ?621M/i,
    name: "NB7NQ621M",
    kind: "video",
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
