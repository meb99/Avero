/**
 * Brands, device families and models for sorting the library as
 * Brand › Family › Model (e.g. Sony › PlayStation › PS4), plus a guess from
 * file and folder names. The catalog only feeds suggestions; any text works.
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
    { name: "PlayStation", models: ["PS1", "PS2", "PS3", "PS4", "PS4 Slim", "PS4 Pro", "PS5", "PS5 Slim", "PS5 Pro"] },
    { name: "PSP", models: ["PSP 1000", "PSP 2000", "PSP 3000", "PSP Go"] },
    { name: "PS Vita", models: ["PCH-1000", "PCH-2000"] },
    { name: "Xperia" },
  ],
  Nintendo: [
    { name: "Switch", models: ["Switch", "Switch Lite", "Switch OLED", "Switch 2"] },
    { name: "3DS", models: ["3DS", "3DS XL", "New 3DS", "New 3DS XL", "2DS", "New 2DS XL"] },
    { name: "Wii U" },
    { name: "Wii" },
    { name: "Game Boy", models: ["Game Boy", "Color", "Advance", "Advance SP"] },
  ],
  Microsoft: [
    { name: "Xbox", models: ["Xbox", "360", "One", "One S", "One X", "Series S", "Series X"] },
    { name: "Surface", models: ["Pro", "Laptop", "Book", "Go"] },
  ],
  Apple: [{ name: "iPhone" }, { name: "iPad" }, { name: "MacBook Air" }, { name: "MacBook Pro" }, { name: "iMac" }, { name: "Mac mini" }],
  Samsung: [{ name: "Galaxy S" }, { name: "Galaxy A" }, { name: "Galaxy Note" }, { name: "Galaxy Tab" }, { name: "Notebook" }],
  Lenovo: [{ name: "ThinkPad" }, { name: "IdeaPad" }, { name: "Legion" }, { name: "Yoga" }],
  Dell: [{ name: "Latitude" }, { name: "XPS" }, { name: "Inspiron" }, { name: "Precision" }, { name: "Vostro" }, { name: "Alienware" }],
  HP: [{ name: "EliteBook" }, { name: "ProBook" }, { name: "Pavilion" }, { name: "Envy" }, { name: "Omen" }, { name: "Spectre" }],
  ASUS: [{ name: "ROG" }, { name: "TUF" }, { name: "ZenBook" }, { name: "VivoBook" }, { name: "ExpertBook" }],
  Acer: [{ name: "Aspire" }, { name: "Nitro" }, { name: "Predator" }, { name: "Swift" }],
  MSI: [{ name: "Katana" }, { name: "Stealth" }, { name: "Raider" }, { name: "Modern" }],
  Google: [{ name: "Pixel" }],
  Xiaomi: [{ name: "Redmi" }, { name: "Mi" }],
  Huawei: [{ name: "P" }, { name: "Mate" }, { name: "MateBook" }],
};

type Rule = [RegExp, (m: RegExpMatchArray) => Category];

const c = (brand: string, family = "", model = ""): Category => ({ brand, family, model });
const num = (m: RegExpMatchArray, i = 1) => (m[i] ?? "").toUpperCase();

// Most specific first.
const RULES: Rule[] = [
  [/switch[\s_-]*lite/, () => c("Nintendo", "Switch", "Switch Lite")],
  [/switch[\s_-]*oled/, () => c("Nintendo", "Switch", "Switch OLED")],
  [/switch[\s_-]*2\b/, () => c("Nintendo", "Switch", "Switch 2")],
  [/nintendo[\s_-]*switch|\bswitch\b.*\b(logic|mainboard|motherboard)|\bhac-/, () => c("Nintendo", "Switch", "Switch")],
  [/new[\s_-]*3ds[\s_-]*xl/, () => c("Nintendo", "3DS", "New 3DS XL")],
  [/\b3ds\b/, () => c("Nintendo", "3DS")],
  [/wii[\s_-]*u\b/, () => c("Nintendo", "Wii U")],
  [/\bps5[\s_-]*pro\b/, () => c("Sony", "PlayStation", "PS5 Pro")],
  [/\bps5\b|\bcfi-\d/, () => c("Sony", "PlayStation", "PS5")],
  [/\bps4[\s_-]*pro\b|cuh-7\d/, () => c("Sony", "PlayStation", "PS4 Pro")],
  [/\bps4\b|\bcuh-\d/, () => c("Sony", "PlayStation", "PS4")],
  [/\bps3\b|\bcech-/, () => c("Sony", "PlayStation", "PS3")],
  [/\bps2\b|scph-[37]/, () => c("Sony", "PlayStation", "PS2")],
  [/\bpsp\b/, () => c("Sony", "PSP")],
  [/\bvita\b|\bpch-\d/, () => c("Sony", "PS Vita")],
  [/xbox[\s_-]*series[\s_-]*x/, () => c("Microsoft", "Xbox", "Series X")],
  [/xbox[\s_-]*series[\s_-]*s/, () => c("Microsoft", "Xbox", "Series S")],
  [/xbox[\s_-]*one[\s_-]*x/, () => c("Microsoft", "Xbox", "One X")],
  [/xbox[\s_-]*one[\s_-]*s/, () => c("Microsoft", "Xbox", "One S")],
  [/xbox[\s_-]*one/, () => c("Microsoft", "Xbox", "One")],
  [/xbox[\s_-]*360/, () => c("Microsoft", "Xbox", "360")],
  [/iphone[\s_-]*(\d{1,2}(?:[\s_-]*(?:pro[\s_-]*max|pro|plus|mini))?)/, (m) => c("Apple", "iPhone", `iPhone ${m[1].replace(/[\s_-]+/g, " ").replace(/\b[a-z]/g, (ch) => ch.toUpperCase())}`)],
  [/\biphone\b/, () => c("Apple", "iPhone")],
  [/\bipad\b/, () => c("Apple", "iPad")],
  [/macbook[\s_-]*air/, () => c("Apple", "MacBook Air")],
  [/macbook[\s_-]*pro/, () => c("Apple", "MacBook Pro")],
  [/\b820-\d{4,5}/, () => c("Apple")],
  [/latitude[\s_-]*([a-z]?\d{4})/, (m) => c("Dell", "Latitude", num(m))],
  [/\bxps[\s_-]*(\d{2,4})/, (m) => c("Dell", "XPS", num(m))],
  [/inspiron[\s_-]*(\d{4})/, (m) => c("Dell", "Inspiron", num(m))],
  [/precision[\s_-]*(\d{4})/, (m) => c("Dell", "Precision", num(m))],
  [/alienware/, () => c("Dell", "Alienware")],
  [/thinkpad[\s_-]*([a-z]\d{2,3}[a-z]?)/, (m) => c("Lenovo", "ThinkPad", num(m))],
  [/thinkpad|\bnm-[a-z]\d{3}/, () => c("Lenovo", "ThinkPad")],
  [/ideapad/, () => c("Lenovo", "IdeaPad")],
  [/legion/, () => c("Lenovo", "Legion")],
  [/galaxy[\s_-]*(s\d{1,2})/, (m) => c("Samsung", "Galaxy S", `Galaxy ${num(m)}`)],
  [/galaxy|\bsm-[a-z]\d{3}/, () => c("Samsung")],
  [/elitebook/, () => c("HP", "EliteBook")],
  [/probook/, () => c("HP", "ProBook")],
  [/pavilion/, () => c("HP", "Pavilion")],
  [/\bomen\b/, () => c("HP", "Omen")],
  [/\brog\b|strix|zephyrus/, () => c("ASUS", "ROG")],
  [/zenbook/, () => c("ASUS", "ZenBook")],
  [/vivobook/, () => c("ASUS", "VivoBook")],
  [/\btuf\b/, () => c("ASUS", "TUF")],
  [/aspire/, () => c("Acer", "Aspire")],
  [/predator/, () => c("Acer", "Predator")],
  [/\bpixel\b/, () => c("Google", "Pixel")],
];

/** Best guess from file and folder names; empty fields where unsure. */
export function guessCategory(texts: string[]): Category {
  const text = texts.join(" ").toLowerCase();
  for (const [pattern, make] of RULES) {
    const m = text.match(pattern);
    if (m) return make(m);
  }
  return c("");
}

/** A category from a folder path like `Sony/PlayStation/PS4`. */
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
