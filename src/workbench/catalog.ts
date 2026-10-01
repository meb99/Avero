/**
 * Brands, device families and models for sorting the library as
 * Brand › Family › Model (e.g. Sony › PlayStation › 5), plus a guess from
 * file names, folder names and schematic text: board numbers (EDM-010,
 * HAC-CPU-01, 820-02100, NM-B481), model numbers (CFI-1216A, SM-A515F,
 * A2338) and product names. The catalog only feeds suggestions; any text works.
 */

export interface Category {
  brand: string;
  family: string;
  model: string;
}

interface Family {
  name: string;
  models?: string[];
}

export const CATALOG: Record<string, Family[]> = {
  Sony: [
    { name: "PlayStation", models: ["1", "2", "3", "4", "4 Slim", "4 Pro", "5", "5 Slim", "5 Pro"] },
    { name: "PSP", models: ["1000", "2000", "3000", "Go", "Street"] },
    { name: "PS Vita", models: ["1000", "2000"] },
    { name: "Xperia" },
  ],
  Nintendo: [
    { name: "Switch", models: ["Original", "Lite", "OLED", "2"] },
    { name: "3DS", models: ["3DS", "3DS XL", "2DS", "New 3DS", "New 3DS XL", "New 2DS XL"] },
    { name: "DS", models: ["DS", "DS Lite", "DSi", "DSi XL"] },
    { name: "Wii U" },
    { name: "Wii" },
    { name: "GameCube" },
    { name: "Game Boy", models: ["Original", "Pocket", "Color", "Advance", "Advance SP", "Micro"] },
    { name: "SNES" },
    { name: "NES" },
    { name: "N64" },
  ],
  Microsoft: [
    { name: "Xbox", models: ["Original", "360", "One", "One S", "One X", "Series S", "Series X"] },
    { name: "Surface", models: ["Pro", "Laptop", "Book", "Go"] },
  ],
  Apple: [
    { name: "iPhone" },
    { name: "iPad" },
    { name: "MacBook Air" },
    { name: "MacBook Pro" },
    { name: "MacBook" },
    { name: "iMac" },
    { name: "Mac mini" },
    { name: "Apple Watch" },
  ],
  Samsung: [
    { name: "Galaxy S" },
    { name: "Galaxy A" },
    { name: "Galaxy M" },
    { name: "Galaxy Note" },
    { name: "Galaxy Z" },
    { name: "Galaxy Tab" },
    { name: "Galaxy Watch" },
    { name: "Notebook" },
  ],
  Google: [{ name: "Pixel" }],
  Xiaomi: [{ name: "Xiaomi" }, { name: "Redmi" }, { name: "POCO" }],
  Huawei: [{ name: "P" }, { name: "Mate" }, { name: "Nova" }, { name: "MateBook" }],
  OnePlus: [{ name: "OnePlus" }, { name: "Nord" }],
  Motorola: [{ name: "Moto" }],
  Lenovo: [{ name: "ThinkPad" }, { name: "IdeaPad" }, { name: "Legion" }, { name: "Yoga" }, { name: "ThinkBook" }, { name: "Notebook" }],
  Dell: [{ name: "Latitude" }, { name: "XPS" }, { name: "Inspiron" }, { name: "Precision" }, { name: "Vostro" }, { name: "Alienware" }],
  HP: [
    { name: "EliteBook" },
    { name: "ProBook" },
    { name: "ZBook" },
    { name: "Pavilion" },
    { name: "Envy" },
    { name: "Omen" },
    { name: "Victus" },
    { name: "Spectre" },
  ],
  ASUS: [{ name: "ROG" }, { name: "TUF" }, { name: "ZenBook" }, { name: "VivoBook" }, { name: "ExpertBook" }, { name: "Grafikkarten" }],
  Acer: [{ name: "Aspire" }, { name: "Nitro" }, { name: "Predator" }, { name: "Swift" }, { name: "TravelMate" }, { name: "Extensa" }],
  MSI: [{ name: "Notebook" }, { name: "Mainboard" }, { name: "Grafikkarten" }],
  Gigabyte: [{ name: "Aorus" }, { name: "Grafikkarten" }],
  Razer: [{ name: "Blade" }],
  Valve: [{ name: "Steam Deck" }],
  Meta: [{ name: "Quest", models: ["1", "2", "3", "Pro"] }],
  NVIDIA: [{ name: "Grafikkarten" }],
  AMD: [{ name: "Grafikkarten" }],
  EVGA: [{ name: "Grafikkarten" }],
  Zotac: [{ name: "Grafikkarten" }],
  Palit: [{ name: "Grafikkarten" }],
  Sapphire: [{ name: "Grafikkarten" }],
  PowerColor: [{ name: "Grafikkarten" }],
  XFX: [{ name: "Grafikkarten" }],
};

interface Rule {
  pattern: RegExp;
  make(m: RegExpMatchArray): Category;
  /**
   * Weak rules (a brand name alone, short codes) only apply to file and
   * folder names, never to schematic text, which names many brands (memory
   * makers, chip vendors) besides the device's own.
   */
  weak?: boolean;
}

const c = (brand: string, family = "", model = ""): Category => ({ brand, family, model });
const up = (s: string | undefined) => (s ?? "").toUpperCase();
/** "13 pro max" -> "13 Pro Max". */
const title = (s: string | undefined) =>
  (s ?? "")
    .trim()
    .replace(/[\s_-]+/g, " ")
    .replace(/\b([a-z])([a-z]*)/g, (_, a: string, b: string) => a.toUpperCase() + b);

/** Apple model numbers (A1466, A2338) of Macs. */
const APPLE_A: Record<string, [family: string, label?: string]> = {
  A1181: ["MacBook"],
  A1342: ["MacBook"],
  A1534: ["MacBook"],
  A1278: ["MacBook Pro"],
  A1286: ["MacBook Pro"],
  A1297: ["MacBook Pro"],
  A1398: ["MacBook Pro"],
  A1425: ["MacBook Pro"],
  A1502: ["MacBook Pro"],
  A1706: ["MacBook Pro"],
  A1707: ["MacBook Pro"],
  A1708: ["MacBook Pro"],
  A1989: ["MacBook Pro"],
  A1990: ["MacBook Pro"],
  A2141: ["MacBook Pro"],
  A2159: ["MacBook Pro"],
  A2251: ["MacBook Pro"],
  A2289: ["MacBook Pro"],
  A2338: ["MacBook Pro"],
  A2442: ["MacBook Pro"],
  A2485: ["MacBook Pro"],
  A2779: ["MacBook Pro"],
  A2780: ["MacBook Pro"],
  A2918: ["MacBook Pro"],
  A2991: ["MacBook Pro"],
  A2992: ["MacBook Pro"],
  A1237: ["MacBook Air"],
  A1304: ["MacBook Air"],
  A1369: ["MacBook Air"],
  A1370: ["MacBook Air"],
  A1465: ["MacBook Air"],
  A1466: ["MacBook Air"],
  A1932: ["MacBook Air"],
  A2179: ["MacBook Air"],
  A2337: ["MacBook Air"],
  A2681: ["MacBook Air"],
  A2941: ["MacBook Air"],
  A3113: ["MacBook Air"],
  A3114: ["MacBook Air"],
  A1311: ["iMac"],
  A1312: ["iMac"],
  A1418: ["iMac"],
  A1419: ["iMac"],
  A2115: ["iMac"],
  A2116: ["iMac"],
  A2438: ["iMac"],
  A2439: ["iMac"],
  A1347: ["Mac mini"],
  A1993: ["Mac mini"],
  A2348: ["Mac mini"],
  A2686: ["Mac mini"],
  A2816: ["Mac mini"],
};

/** Logic board numbers (820-…) whose Mac model is well known. */
const APPLE_820: Record<string, string> = {
  "820-2879": "A1278",
  "820-2936": "A1278",
  "820-3115": "A1278",
  "820-3332": "A1398",
  "820-3662": "A1398",
  "820-00138": "A1398",
  "820-3476": "A1502",
  "820-4924": "A1502",
  "820-3435": "A1465",
  "820-3437": "A1466",
  "820-00165": "A1708",
  "820-00840": "A1708",
  "820-00239": "A1706",
  "820-00281": "A1707",
  "820-01041": "A1990",
  "820-01521": "A1932",
  "820-01598": "A1989",
  "820-01949": "A2159",
  "820-01958": "A2179",
  "820-01987": "A2289",
};

function appleModel(a: string): Category | undefined {
  const known = APPLE_A[a];
  return known ? c("Apple", known[0], a) : undefined;
}

const GPU_BRANDS = /\b(asus|msi|gigabyte|evga|zotac|palit|sapphire|powercolor|xfx|nvidia|amd)\b/;
const GPU_BRAND_NAMES: Record<string, string> = {
  asus: "ASUS",
  msi: "MSI",
  gigabyte: "Gigabyte",
  evga: "EVGA",
  zotac: "Zotac",
  palit: "Palit",
  sapphire: "Sapphire",
  powercolor: "PowerColor",
  xfx: "XFX",
  nvidia: "NVIDIA",
  amd: "AMD",
};

/** Applies a rule only when the whole text also matches `also`. */
function withContext(pattern: RegExp, also: RegExp): RegExp {
  return new RegExp(`(?=[\\s\\S]*${also.source})[\\s\\S]*?${pattern.source}`);
}

// Most specific first; the first match wins.
const RULES: Rule[] = [
  // --- Sony PlayStation: model numbers (CFI/CUH/CECH/SCPH) and board numbers.
  { pattern: /\bps5[\s-]*pro\b|playstation[\s-]*5[\s-]*pro|\bcfi-7\d{3}/, make: () => c("Sony", "PlayStation", "5 Pro") },
  { pattern: /\bps5[\s-]*slim\b|playstation[\s-]*5[\s-]*slim|\bcfi-2\d{3}|\bedm-03\d/, make: () => c("Sony", "PlayStation", "5 Slim") },
  { pattern: /\bps5\b|playstation[\s-]*5|\bcfi-1[0-2]\d{2}|\bedm-0[12]\d/, make: () => c("Sony", "PlayStation", "5") },
  { pattern: /\bps4[\s-]*pro\b|playstation[\s-]*4[\s-]*pro|\bcuh-7\d{3}|\bnv[gm]-0\d\d/, make: () => c("Sony", "PlayStation", "4 Pro") },
  { pattern: /\bps4[\s-]*slim\b|playstation[\s-]*4[\s-]*slim|\bcuh-2\d{3}/, make: () => c("Sony", "PlayStation", "4 Slim") },
  { pattern: /\bps4\b|playstation[\s-]*4|\bcuh-1\d{3}|\bsa[a-d]-0\d\d/, make: () => c("Sony", "PlayStation", "4") },
  {
    pattern: /\bps3\b|playstation[\s-]*3|\bcech-|\b(cok|sem|dia|dyn|jsd|jtp|msx|mpx|npx|pqx)-00\d/,
    make: () => c("Sony", "PlayStation", "3"),
  },
  { pattern: /playstation[\s-]*2|\bscph-\d{5}/, make: () => c("Sony", "PlayStation", "2") },
  // PS2 is also the PC keyboard bus (PS2_CLK) in schematics.
  { pattern: /\bps2\b/, make: () => c("Sony", "PlayStation", "2"), weak: true },
  { pattern: /\bpsone\b|playstation[\s-]*1\b|\bscph-\d{4}\b/, make: () => c("Sony", "PlayStation", "1") },
  { pattern: /\bps1\b|\bpsx\b/, make: () => c("Sony", "PlayStation", "1"), weak: true },
  { pattern: /psp[\s-]*go\b|\bpsp-n1\d{3}|\bta-091\b/, make: () => c("Sony", "PSP", "Go") },
  { pattern: /psp[\s-]*street|\bpsp-e1\d{3}|\bta-09[67]\b/, make: () => c("Sony", "PSP", "Street") },
  { pattern: /\bpsp[\s-]*([123])\d{3}\b/, make: (m) => c("Sony", "PSP", `${m[1]}000`) },
  { pattern: /\bta-0(79|81|82|86)\b/, make: () => c("Sony", "PSP", "1000") },
  { pattern: /\bta-0(85|88)\b/, make: () => c("Sony", "PSP", "2000") },
  { pattern: /\bta-0(90|92|93|95)\b/, make: () => c("Sony", "PSP", "3000") },
  { pattern: /\bpsp\b/, make: () => c("Sony", "PSP"), weak: true },
  { pattern: /\bpch-([12])\d{3}/, make: (m) => c("Sony", "PS Vita", `${m[1]}000`) },
  { pattern: /ps[\s-]*vita/, make: () => c("Sony", "PS Vita") },
  { pattern: /\bvita\b/, make: () => c("Sony", "PS Vita"), weak: true },
  { pattern: /\bxperia\b/, make: () => c("Sony", "Xperia") },

  // --- Nintendo: model codes (HAC-001, HDH-001, HEG-001, CTR-001 …).
  { pattern: /switch[\s-]*lite|\bhdh-(?:cpu-0\d|0\d\d)/, make: () => c("Nintendo", "Switch", "Lite") },
  { pattern: /switch[\s-]*oled|\bheg-(?:cpu-0\d|0\d\d)/, make: () => c("Nintendo", "Switch", "OLED") },
  { pattern: /switch[\s-]*2\b|\bbee-(?:cpu-0\d|0\d\d)/, make: () => c("Nintendo", "Switch", "2") },
  {
    pattern: /nintendo[\s-]*switch|\bhac-(?:cpu-0\d|0\d\d)/,
    make: () => c("Nintendo", "Switch", "Original"),
  },
  // Schematics say "switch" and "board" everywhere: names only.
  { pattern: /\bswitch\b.*\b(logic|mainboard|motherboard|board)\b/, make: () => c("Nintendo", "Switch", "Original"), weak: true },
  { pattern: /new[\s-]*(?:nintendo[\s-]*)?2ds[\s-]*xl|\bjan-0\d\d/, make: () => c("Nintendo", "3DS", "New 2DS XL") },
  { pattern: /new[\s-]*(?:nintendo[\s-]*)?3ds[\s-]*(xl|ll)|\bred-0\d\d/, make: () => c("Nintendo", "3DS", "New 3DS XL") },
  { pattern: /new[\s-]*(?:nintendo[\s-]*)?3ds|\bktr-0\d\d/, make: () => c("Nintendo", "3DS", "New 3DS") },
  { pattern: /\b3ds[\s-]*(xl|ll)\b|\bspr-0\d\d/, make: () => c("Nintendo", "3DS", "3DS XL") },
  { pattern: /\bftr-0\d\d/, make: () => c("Nintendo", "3DS", "2DS") },
  { pattern: /\b2ds\b/, make: () => c("Nintendo", "3DS", "2DS"), weak: true },
  { pattern: /\bctr-0\d\d/, make: () => c("Nintendo", "3DS", "3DS") },
  { pattern: /\b3ds\b/, make: () => c("Nintendo", "3DS", "3DS"), weak: true },
  { pattern: /\bdsi[\s-]*(xl|ll)\b|\butl-0\d\d/, make: () => c("Nintendo", "DS", "DSi XL") },
  { pattern: /\btwl-0\d\d/, make: () => c("Nintendo", "DS", "DSi") },
  // DSI is also the MIPI display bus in schematics.
  { pattern: /\bdsi\b/, make: () => c("Nintendo", "DS", "DSi"), weak: true },
  { pattern: /\bds[\s-]*lite\b|\busg-0\d\d/, make: () => c("Nintendo", "DS", "DS Lite") },
  { pattern: /nintendo[\s-]*ds\b|\bntr-0\d\d/, make: () => c("Nintendo", "DS", "DS") },
  { pattern: /wii[\s-]*u\b|\bwup-0\d\d/, make: () => c("Nintendo", "Wii U") },
  { pattern: /\brvl-0\d\d/, make: () => c("Nintendo", "Wii") },
  { pattern: /\bwii\b/, make: () => c("Nintendo", "Wii"), weak: true },
  { pattern: /gamecube|\bdol-0\d\d/, make: () => c("Nintendo", "GameCube") },
  { pattern: /advance[\s-]*sp\b|\bgba[\s-]*sp\b|\bags-0\d\d/, make: () => c("Nintendo", "Game Boy", "Advance SP") },
  { pattern: /game[\s-]*boy[\s-]*advance|\bagb-0\d\d/, make: () => c("Nintendo", "Game Boy", "Advance") },
  { pattern: /\bgba\b/, make: () => c("Nintendo", "Game Boy", "Advance"), weak: true },
  { pattern: /game[\s-]*boy[\s-]*color|\bcgb-0\d\d/, make: () => c("Nintendo", "Game Boy", "Color") },
  { pattern: /\bgbc\b/, make: () => c("Nintendo", "Game Boy", "Color"), weak: true },
  { pattern: /game[\s-]*boy[\s-]*micro|\boxy-0\d\d/, make: () => c("Nintendo", "Game Boy", "Micro") },
  { pattern: /game[\s-]*boy[\s-]*pocket|\bmgb-0\d\d/, make: () => c("Nintendo", "Game Boy", "Pocket") },
  { pattern: /\bgame[\s-]*boy\b|\bdmg-0\d\d/, make: () => c("Nintendo", "Game Boy", "Original") },
  { pattern: /\bsnes\b|super[\s-]*(?:nintendo|famicom)|\bshvc-|\bsnsp?-/, make: () => c("Nintendo", "SNES") },
  { pattern: /\bn64\b|nintendo[\s-]*64|\bnus-0\d\d/, make: () => c("Nintendo", "N64") },
  { pattern: /\bfamicom\b|\bnes-0\d\d|\bhvc-0\d\d/, make: () => c("Nintendo", "NES") },
  { pattern: /\bnes\b/, make: () => c("Nintendo", "NES"), weak: true },

  // --- Microsoft Xbox: names, code names and model numbers.
  { pattern: /xbox[\s-]*series[\s-]*x|\bxsx\b|\banaconda\b|model[\s-]*1882\b/, make: () => c("Microsoft", "Xbox", "Series X") },
  { pattern: /xbox[\s-]*series[\s-]*s|\bxss\b|\blockhart\b|model[\s-]*1883\b/, make: () => c("Microsoft", "Xbox", "Series S") },
  { pattern: /xbox[\s-]*one[\s-]*x|\bscorpio\b|model[\s-]*1787\b/, make: () => c("Microsoft", "Xbox", "One X") },
  { pattern: /xbox[\s-]*one[\s-]*s|model[\s-]*1681\b/, make: () => c("Microsoft", "Xbox", "One S") },
  { pattern: /xbox[\s-]*one|\bdurango\b|model[\s-]*1540\b/, make: () => c("Microsoft", "Xbox", "One") },
  {
    pattern: withContext(/\b(xenon|zephyr|falcon|jasper|trinity|corona|winchester)\b/, /(?:xbox|\b360\b)/),
    make: () => c("Microsoft", "Xbox", "360"),
  },
  { pattern: /xbox[\s-]*360/, make: () => c("Microsoft", "Xbox", "360") },
  { pattern: /surface[\s-]*pro[\s-]*(\d+|x)\b/, make: (m) => c("Microsoft", "Surface", `Pro ${up(m[1])}`) },
  { pattern: /surface[\s-]*(laptop|book|go)(?:[\s-]*(\d))?/, make: (m) => c("Microsoft", "Surface", title(`${m[1]} ${m[2] ?? ""}`)) },

  // --- Other consoles and handhelds.
  { pattern: /steam[\s-]*deck/, make: () => c("Valve", "Steam Deck") },
  { pattern: /rog[\s-]*ally(?:[\s-]*(x))?/, make: (m) => c("ASUS", "ROG", m[1] ? "Ally X" : "Ally") },
  { pattern: /(?:oculus|meta)[\s-]*quest[\s-]*(\d|pro)?/, make: (m) => c("Meta", "Quest", m[1] ? title(m[1]) : "") },

  // --- Apple: product names, model numbers (A2338), board numbers (820-…).
  {
    pattern: /iphone[\s-]*(se(?:[\s-]*\d)?|x[rs]?(?:[\s-]*max)?|\d{1,2}(?:[\s-]*(?:pro[\s-]*max|pro|plus|mini|e))?)\b/,
    make: (m) => c("Apple", "iPhone", title(m[1]).replace(/^X([rs])/i, (_, s: string) => `X${s.toUpperCase()}`).replace(/^Se/, "SE")),
  },
  { pattern: /\biphone\b/, make: () => c("Apple", "iPhone") },
  { pattern: /ipad[\s-]*(pro|air|mini)?/, make: (m) => c("Apple", "iPad", m[1] ? title(m[1]) : "") },
  { pattern: /apple[\s-]*watch/, make: () => c("Apple", "Apple Watch") },
  { pattern: /\b(a1[1-9]\d\d|a2\d{3}|a3[01]\d\d)\b/, make: (m) => appleModel(up(m[1])) ?? c("") },
  {
    pattern: /\b(820-\d{4,5})\b/,
    make: (m) => {
      const a = APPLE_820[m[1]];
      return (a && appleModel(a)) || c("Apple", "MacBook", m[1]);
    },
  },
  { pattern: /macbook[\s-]*air/, make: () => c("Apple", "MacBook Air") },
  { pattern: /macbook[\s-]*pro/, make: () => c("Apple", "MacBook Pro") },
  { pattern: /\bmacbook\b/, make: () => c("Apple", "MacBook") },
  { pattern: /\bimac\b/, make: () => c("Apple", "iMac") },
  { pattern: /mac[\s-]*mini/, make: () => c("Apple", "Mac mini") },

  // --- Phones by model number and name.
  { pattern: /\bsm-a(\d{3}[a-z]?)/, make: (m) => c("Samsung", "Galaxy A", `A${up(m[1])}`) },
  { pattern: /\bsm-m(\d{3}[a-z]?)/, make: (m) => c("Samsung", "Galaxy M", `M${up(m[1])}`) },
  { pattern: /\bsm-([gs]9\d\d[a-z]?)/, make: (m) => c("Samsung", "Galaxy S", up(m[1])) },
  { pattern: /\bsm-(n9\d\d[a-z]?)/, make: (m) => c("Samsung", "Galaxy Note", up(m[1])) },
  { pattern: /\bsm-(f\d{3}[a-z]?)/, make: (m) => c("Samsung", "Galaxy Z", up(m[1])) },
  { pattern: /\bsm-([tx]\d{3}[a-z]?)/, make: (m) => c("Samsung", "Galaxy Tab", up(m[1])) },
  { pattern: /\bsm-(r\d{3}[a-z]?)/, make: (m) => c("Samsung", "Galaxy Watch", up(m[1])) },
  {
    pattern: /galaxy[\s-]*(s\d{1,2}(?:[\s-]*(?:ultra|plus|\+|fe|edge))?)\b/,
    make: (m) => c("Samsung", "Galaxy S", title(m[1].replace("+", " plus")).replace(/^S/, "S")),
  },
  { pattern: /galaxy[\s-]*(a\d{1,2}[a-z]?)\b/, make: (m) => c("Samsung", "Galaxy A", up(m[1])) },
  { pattern: /galaxy[\s-]*note[\s-]*(\d{1,2})/, make: (m) => c("Samsung", "Galaxy Note", m[1]) },
  { pattern: /galaxy[\s-]*z[\s-]*(fold|flip)[\s-]*(\d)?/, make: (m) => c("Samsung", "Galaxy Z", title(`${m[1]} ${m[2] ?? ""}`)) },
  { pattern: /galaxy[\s-]*tab/, make: () => c("Samsung", "Galaxy Tab") },
  { pattern: /\bgalaxy\b/, make: () => c("Samsung"), weak: true },
  { pattern: /pixel[\s-]*(\d{1,2}a?(?:[\s-]*(?:pro|xl|fold))?)\b/, make: (m) => c("Google", "Pixel", title(m[1])) },
  { pattern: /redmi[\s-]*(note[\s-]*\d{1,2}(?:[\s-]*pro)?|\d{1,2}[a-z]?)/, make: (m) => c("Xiaomi", "Redmi", title(m[1])) },
  { pattern: /\bpoco[\s-]*([a-z]\d{1,2}(?:[\s-]*pro)?)/, make: (m) => c("Xiaomi", "POCO", up(m[1])) },
  { pattern: /xiaomi[\s-]*(?:mi[\s-]*)?(\d{1,2}[a-z]?(?:[\s-]*(?:pro|ultra|lite))?)\b/, make: (m) => c("Xiaomi", "Xiaomi", title(m[1])) },
  { pattern: /huawei[\s-]*(p\d{2}|mate[\s-]*\d{2}|nova[\s-]*\d{1,2})/, make: (m) => {
    const name = title(m[1]);
    return c("Huawei", name.startsWith("Mate") ? "Mate" : name.startsWith("Nova") ? "Nova" : "P", name);
  } },
  { pattern: /oneplus[\s-]*(nord[\s-]*\w+|\d{1,2}t?(?:[\s-]*pro)?)/, make: (m) => c("OnePlus", /nord/.test(m[1]) ? "Nord" : "OnePlus", title(m[1])) },
  { pattern: /\bmoto[\s-]*([egz]\d{0,3}\w*)/, make: (m) => c("Motorola", "Moto", up(m[1])) },

  // --- Notebooks by series and model.
  { pattern: /latitude[\s-]*([a-z]?\d{4})/, make: (m) => c("Dell", "Latitude", up(m[1])) },
  { pattern: /\bxps[\s-]*(\d{2,4})/, make: (m) => c("Dell", "XPS", m[1]) },
  { pattern: /inspiron[\s-]*(\d{4})/, make: (m) => c("Dell", "Inspiron", m[1]) },
  { pattern: /precision[\s-]*(\d{4})/, make: (m) => c("Dell", "Precision", m[1]) },
  { pattern: /vostro[\s-]*(\d{4})/, make: (m) => c("Dell", "Vostro", m[1]) },
  { pattern: /alienware[\s-]*(m\d{2}|x\d{2}|area[\s-]*51m)?/, make: (m) => c("Dell", "Alienware", up(m[1])) },
  { pattern: /\blatitude\b/, make: () => c("Dell", "Latitude") },
  { pattern: /thinkpad[\s-]*(x1[\s-]*(?:carbon|yoga|extreme)(?:[\s-]*(?:gen[\s-]*)?\d{1,2})?)/, make: (m) => c("Lenovo", "ThinkPad", title(m[1]).replace(/^X1/, "X1")) },
  { pattern: /thinkpad[\s-]*([tlpexw]\d{2,3}[a-z]?s?)\b/, make: (m) => c("Lenovo", "ThinkPad", up(m[1])) },
  { pattern: /thinkpad/, make: () => c("Lenovo", "ThinkPad") },
  { pattern: /thinkbook[\s-]*(\d{2}[a-z]?)?/, make: (m) => c("Lenovo", "ThinkBook", up(m[1])) },
  { pattern: /ideapad[\s-]*((?:slim|gaming|flex)?[\s-]*\d[\w-]*)?/, make: (m) => c("Lenovo", "IdeaPad", title(m[1])) },
  { pattern: /legion[\s-]*((?:pro[\s-]*)?\d[\w]*|y\d{3}\w*)?/, make: (m) => c("Lenovo", "Legion", title(m[1])) , weak: true },
  { pattern: /\byoga[\s-]*(\d{3,4}\w*|slim[\s-]*\d)?/, make: (m) => c("Lenovo", "Yoga", title(m[1])) , weak: true },
  // LCFC builds Lenovo notebooks only.
  { pattern: /\b(nm-[a-z]\d{3})\b/, make: (m) => c("Lenovo", "Notebook", up(m[1])) },
  { pattern: /elitebook[\s-]*(\d{3,4}[\s-]*g\d{1,2})?/, make: (m) => c("HP", "EliteBook", up(m[1]).replace(/[\s-]+/g, " ")) },
  { pattern: /probook[\s-]*(\d{3,4}[\s-]*g\d{1,2})?/, make: (m) => c("HP", "ProBook", up(m[1]).replace(/[\s-]+/g, " ")) },
  { pattern: /zbook[\s-]*(\w+(?:[\s-]*g\d{1,2})?)?/, make: (m) => c("HP", "ZBook", title(m[1])) },
  { pattern: /pavilion[\s-]*(\w+)?/, make: (m) => c("HP", "Pavilion", up(m[1])) , weak: true },
  { pattern: /\benvy[\s-]*(x360|\d{2})?/, make: (m) => c("HP", "Envy", up(m[1])) , weak: true },
  { pattern: /\bomen[\s-]*(\d{2})?/, make: (m) => c("HP", "Omen", m[1] ?? "") , weak: true },
  { pattern: /\bvictus[\s-]*(\d{2})?/, make: (m) => c("HP", "Victus", m[1] ?? "") , weak: true },
  { pattern: /spectre[\s-]*(x360)?/, make: (m) => c("HP", "Spectre", up(m[1])) , weak: true },
  { pattern: /\b(ux\d{3}[a-z]{0,3})\b/, make: (m) => c("ASUS", "ZenBook", up(m[1])) },
  { pattern: /zenbook/, make: () => c("ASUS", "ZenBook") },
  { pattern: withContext(/\b((?:ga|gu|gx|gv|gz|gl|g)\d{3}[a-z]{0,3})\b/, /\b(?:asus|rog)\b/), make: (m) => c("ASUS", "ROG", up(m[1])) },
  { pattern: /\b((?:fx|fa)\d{3}[a-z]{0,3})\b/, make: (m) => c("ASUS", "TUF", up(m[1])) },
  { pattern: withContext(/\b((?:x|k|s|f)\d{3}[a-z]{1,3})\b/, /\b(?:asus)\b/), make: (m) => c("ASUS", "VivoBook", up(m[1])) },
  { pattern: /vivobook/, make: () => c("ASUS", "VivoBook") },
  { pattern: /expertbook/, make: () => c("ASUS", "ExpertBook") },
  { pattern: /\b(an\d{3}-\d{2})\b/, make: (m) => c("Acer", "Nitro", up(m[1])) },
  { pattern: /\b(ph\d{3}-\d{2})\b/, make: (m) => c("Acer", "Predator", up(m[1])) },
  { pattern: /\b(sf\d{3}-\d{2})\b/, make: (m) => c("Acer", "Swift", up(m[1])) },
  { pattern: /\b(tmp\d{3}-\d{2})\b/, make: (m) => c("Acer", "TravelMate", up(m[1])) },
  { pattern: /\b(ex\d{3}-\d{2})\b/, make: (m) => c("Acer", "Extensa", up(m[1])) },
  { pattern: /\b(a\d{3}-\d{2})\b/, make: (m) => c("Acer", "Aspire", up(m[1])), weak: true },
  { pattern: /acer[\s-]*nitro|\bnitro[\s-]*\d\b/, make: () => c("Acer", "Nitro"), weak: true },
  { pattern: /\bpredator\b/, make: () => c("Acer", "Predator") },
  { pattern: /acer[\s-]*swift/, make: () => c("Acer", "Swift") },
  { pattern: /travelmate/, make: () => c("Acer", "TravelMate") },
  { pattern: /\bextensa\b/, make: () => c("Acer", "Extensa") },
  { pattern: /\baspire\b/, make: () => c("Acer", "Aspire") },
  { pattern: /\b(ms-1[0-9a-z]{3})\b/, make: (m) => c("MSI", "Notebook", up(m[1])) },
  { pattern: /\b(ms-7[0-9a-z]{3})\b/, make: (m) => c("MSI", "Mainboard", up(m[1])) },
  {
    pattern: /\bmsi\b[\s\S]*?\b(katana|stealth|raider|titan|vector|sword|cyborg|crosshair|pulse|prestige|modern|bravo|alpha|delta|gf\d{2}|gl\d{2}|ge\d{2}|gs\d{2}|gp\d{2})\b/,
    make: (m) => c("MSI", "Notebook", title(m[1]).replace(/^(G[a-z])/i, (s) => s.toUpperCase())),
  },
  { pattern: /razer[\s-]*blade[\s-]*(\d{2})?|\brz09-/, make: (m) => c("Razer", "Blade", m[1] ?? "") },
  { pattern: /\baorus\b/, make: () => c("Gigabyte", "Aorus") },

  // --- Graphics cards, after notebooks (which often name their GPU too).
  {
    pattern: /\b(rtx|gtx)[\s-]*(\d{3,4})[\s-]*(ti|super)?\b/,
    make: (m) => {
      return c("NVIDIA", "Grafikkarten", `${up(m[1])} ${m[2]}${m[3] ? ` ${title(m[3])}` : ""}`);
    },
  },
  { pattern: /\brx[\s-]*(\d{3,4})[\s-]*(xtx|xt|gre)?\b/, make: (m) => c("AMD", "Grafikkarten", `RX ${m[1]}${m[2] ? ` ${up(m[2])}` : ""}`) },

  // Gaming names shared by notebooks and graphics cards.
  { pattern: /\b(?:rog|strix|zephyrus)\b/, make: () => c("ASUS", "ROG"), weak: true },
  { pattern: /\btuf\b/, make: () => c("ASUS", "TUF"), weak: true },


  // --- Brand names alone: file names only.
  { pattern: /\bsamsung\b/, make: () => c("Samsung"), weak: true },
  { pattern: /\blenovo\b/, make: () => c("Lenovo"), weak: true },
  { pattern: /\bdell\b/, make: () => c("Dell"), weak: true },
  { pattern: /\bhp\b|hewlett/, make: () => c("HP"), weak: true },
  { pattern: /\basus\b/, make: () => c("ASUS"), weak: true },
  { pattern: /\bacer\b/, make: () => c("Acer"), weak: true },
  { pattern: /\bmsi\b/, make: () => c("MSI"), weak: true },
  { pattern: /\bhuawei\b/, make: () => c("Huawei"), weak: true },
  { pattern: /\bxiaomi\b/, make: () => c("Xiaomi"), weak: true },
];

/** Lower case with separators unified, so `\b` works across `_`. */
function normalize(texts: string[]): string {
  return texts.join(" ").toLowerCase().replace(/[_/\\]+/g, " ");
}

export interface GuessOptions {
  /** Schematic text: skip weak rules (brand names alone). */
  strict?: boolean;
}

/** Best guess from file and folder names (or schematic text); empty fields where unsure. */
export function guessCategory(texts: string[], options: GuessOptions = {}): Category {
  const text = normalize(texts);
  for (const rule of RULES) {
    if (options.strict && rule.weak) continue;
    const m = text.match(rule.pattern);
    if (!m) continue;
    const cat = rule.make(m);
    if (!cat.brand) continue;
    // A graphics card names its maker; the GPU vendor is the fallback.
    if (cat.family === "Grafikkarten") {
      const maker = text.match(GPU_BRANDS);
      if (maker) return { ...cat, brand: GPU_BRAND_NAMES[maker[1]] };
    }
    return cat;
  }
  return c("");
}

/** A category from a folder path like `Sony/PlayStation/5`. */
export function categoryFromFolder(folder: string): Category {
  const [brand = "", family = "", model = ""] = folder.split("/").filter(Boolean);
  return { brand, family, model };
}

/** The folder path of a category; empty levels are left out. */
export function categoryFolder(cat: Category): string {
  return [cat.brand, cat.family, cat.model].map((s) => s.trim()).filter(Boolean).join("/");
}

/** Tree key of entries that are not sorted into a category yet. */
export const UNSORTED = "\u0000unsorted";

/** True for folders that already form a category: a known brand, or several levels. */
export function isSorted(folder: string): boolean {
  return isCategorized(folder) || folder.includes("/");
}

/** True when a folder path looks like a category (its brand is known). */
export function isCategorized(folder: string): boolean {
  const brand = folder.split("/")[0]?.toLowerCase();
  return !!brand && Object.keys(CATALOG).some((b) => b.toLowerCase() === brand);
}

export interface TreeNode {
  name: string;
  path: string;
  count: number;
  children: TreeNode[];
}

/** Category tree (three levels) from the entries' folders, with entry counts. */
export function buildTree(folders: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", count: 0, children: [] };
  for (const folder of folders) {
    let node = root;
    for (const part of folder.split("/").filter(Boolean).slice(0, 3)) {
      const path = node.path ? `${node.path}/${part}` : part;
      let child = node.children.find((c) => c.name.toLowerCase() === part.toLowerCase());
      if (!child) node.children.push((child = { name: part, path, count: 0, children: [] }));
      child.count++;
      node = child;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const n of nodes) sort(n.children);
  };
  sort(root.children);
  return root.children;
}

/** Model name without the family's own prefix: "PS5" ~ "5", "Switch Lite" ~ "Lite", "iPhone 13" ~ "13". */
function modelKey(model: string, family: string): string {
  const fam = family.toLowerCase();
  const prefixes = [fam, ...(fam === "playstation" ? ["ps", "playstation"] : [])];
  let key = model.toLowerCase().replace(/[\s_-]+/g, "");
  for (const p of prefixes) {
    const compact = p.replace(/[\s_-]+/g, "");
    if (compact && key.startsWith(compact) && key.length > compact.length) key = key.slice(compact.length);
  }
  return key;
}

/**
 * The category as the library already spells it: an existing folder with
 * the same brand, family or model (also "PS5" for "5") is reused, so new
 * files land next to the old ones.
 */
export function matchExisting(tree: TreeNode[], cat: Category): Category {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const brand = tree.find((n) => same(n.name, cat.brand));
  if (!brand) return cat;
  const family = brand.children.find((n) => same(n.name, cat.family));
  const model =
    family && cat.model ? family.children.find((n) => modelKey(n.name, family.name) === modelKey(cat.model, cat.family)) : undefined;
  return { brand: brand.name, family: family?.name ?? cat.family, model: model?.name ?? cat.model };
}

/** Suggestions for the three fields, from the catalog and what the library already has. */
export function suggestions(tree: TreeNode[], brand: string, family: string): { brands: string[]; families: string[]; models: string[] } {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];
  const brandNode = tree.find((n) => same(n.name, brand));
  const catalogBrand = Object.entries(CATALOG).find(([b]) => same(b, brand))?.[1] ?? [];
  const familyNode = brandNode?.children.find((n) => same(n.name, family));
  const catalogFamily = catalogBrand.find((f) => same(f.name, family));
  return {
    brands: uniq([...Object.keys(CATALOG), ...tree.map((n) => n.name)]),
    families: uniq([...catalogBrand.map((f) => f.name), ...(brandNode?.children.map((n) => n.name) ?? [])]),
    models: uniq([...(catalogFamily?.models ?? []), ...(familyNode?.children.map((n) => n.name) ?? [])]),
  };
}
