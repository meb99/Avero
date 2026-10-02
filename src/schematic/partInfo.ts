/**
 * Facts about parts and nets read from the schematic's own text: the value
 * printed next to a part ("10UF  20%  25V  X5R-CERM  0603" under C3090, or
 * "10U_0603_25V6K" beside PC301), the part number of a chip ("LT3957"), and
 * the voltage a net is drawn with ("VOLTAGE=3.3V" under PP3V3_S5).
 *
 * Text is matched by position. Every value-like word goes to the part name
 * nearest to it, so a value between two capacitors is never given to both;
 * text above or left of a name counts as farther away, because schematics
 * print values below or beside the name.
 */
import type { Box, Word, WordIndex } from "./textIndex";

export interface SchematicPart {
  /** Schematic page (0-based) the facts come from. */
  page: number;
  /** "10 µF", "4.7 kΩ", "6.8 µH" or a chip's part number. */
  value?: string;
  partNumber?: string;
  /** Voltage, current or power rating: "25V", "4.0A", "1/16W". */
  rating?: string;
  tolerance?: string;
  dielectric?: string;
  package?: string;
  /** CRITICAL, not fitted (NOSTUFF, DNP) and the like. */
  flags: string[];
}

export interface SchematicFacts {
  parts: Map<string, SchematicPart>;
  /** Net name → voltage drawn on the schematic ("3.3V"). */
  netVoltages: Map<string, string>;
}

type Kind = "C" | "R" | "L" | "chip" | "other";

/** Kind of part by its name: C12, PC301 (Compal's power parts start with P), FB3, U7, PQ12 … */
export function partKind(name: string): Kind {
  const letters = /^[A-Z]+/.exec(name.toUpperCase())?.[0] ?? "";
  const base = letters.length > 1 && letters.startsWith("P") && /^(C|R|L|U|Q|D|J)$/.test(letters.slice(1)) ? letters.slice(1) : letters;
  if (/^(C|CE|CB|EC)$/.test(base)) return "C";
  if (/^(R|RN|RP)$/.test(base)) return "R";
  if (/^(L|FB|FL|BEAD)$/.test(base)) return "L";
  if (/^(U|IC|Q|D|ZD|Y|X|LED|VR)$/.test(base)) return "chip";
  return "other";
}

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const CAP = new RegExp(`^${NUM}(PF|NF|UF|µF|P|N|U)$`);
const RES = new RegExp(`^${NUM}(K|KOHM|M|MOHM|R|OHM|OHMS|Ω)?$`);
const RES_INFIX = /^(\d+)([KMR])(\d+)$/; // 4K7, 4R7
const IND = new RegExp(`^${NUM}(UH|NH|MH|U|N)$`);
const RATING = new RegExp(`^${NUM}(V|A|W|KV)(?:\\d[A-Z])?$`);
const FRACTION_WATT = /^1\/\d+W$/;
const TOLERANCE = new RegExp(`^${NUM}%$`);
const DIELECTRIC = /^(X5R|X7R|X6S|X7S|X5S|X8R|NP0|NPO|C0G|COG|Y5V|Z5U)(-CERM)?$/;
const PACKAGE = /^(01005|0?201|0?402|0?603|0?805|1206|1210|1812|2010|2512|(QFN|DFN|SON|SOT|SOIC|TSSOP|MSOP|BGA|LGA|WLCSP|CSP|SC70|PAK)[\dA-Z-]*)$/;
const FLAG = /^(CRITICAL|NOSTUFF|NO_STUFF|NO-STUFF|DNP|@DNP|NOPOP|NI|DNI)$/;
const PART_NUMBER = /^(?=(?:.*[A-Z]){2})(?=(?:.*\d){2})[A-Z][A-Z0-9-]{3,}[A-Z0-9]$/;
const VOLTS = /^[+-]?\d+(?:\.\d+)?V$/;
/** Words around a chip that are not its part number. */
const NOT_A_PART_NUMBER = /^(PP|VCC|VDD|VSS|GND|SHEET|REV|PAGE|DATE|SIZE|DWG|VOLTAGE|MIN_|MAX_)/;

const UNITS: Record<string, string> = { P: "pF", PF: "pF", N: "nF", NF: "nF", U: "µF", UF: "µF", "µF": "µF" };
const IND_UNITS: Record<string, string> = { U: "µH", UH: "µH", N: "nH", NH: "nH", MH: "mH" };

interface Found {
  field: "value" | "partNumber" | "rating" | "tolerance" | "dielectric" | "package" | "flag";
  text: string;
}

/** What a word (or one piece of "10U_0603_25V6K") says about a part of `kind`. */
export function classify(token: string, kind: Kind): Found | null {
  const t = token.toUpperCase();
  if (FLAG.test(t)) return { field: "flag", text: t.replace(/^@/, "") };
  if (TOLERANCE.test(t)) return { field: "tolerance", text: t };
  if (DIELECTRIC.test(t)) return { field: "dielectric", text: t.replace(/-CERM$/, "") };
  if (PACKAGE.test(t)) return { field: "package", text: /^\d{3}$/.test(t) ? `0${t}` : t };
  if (FRACTION_WATT.test(t)) return { field: "rating", text: t };
  const rating = RATING.exec(t);
  if (rating) return { field: "rating", text: `${rating[1]}${rating[2] === "KV" ? "kV" : rating[2]}` };
  if (kind === "C") {
    const m = CAP.exec(t);
    if (m) return { field: "value", text: `${m[1]} ${UNITS[m[2]]}` };
  }
  if (kind === "R") {
    const infix = RES_INFIX.exec(t);
    if (infix) return { field: "value", text: `${infix[1]}.${infix[3]} ${infix[2] === "R" ? "Ω" : `${infix[2] === "K" ? "k" : "M"}Ω`}` };
    const m = RES.exec(t);
    // A bare 1 or 2 next to a resistor is its pin number.
    if (m && (m[2] || !/^[12]$/.test(t))) {
      const unit = m[2] ?? "";
      const prefix = unit.startsWith("K") ? "k" : unit.startsWith("M") ? "M" : "";
      return { field: "value", text: `${m[1]} ${prefix}Ω` };
    }
  }
  if (kind === "L") {
    const m = IND.exec(t);
    if (m) return { field: "value", text: `${m[1]} ${IND_UNITS[m[2]]}` };
    if (/^\d+(OHM|Ω)$/.test(t)) return { field: "value", text: `${t.replace(/OHM$/, "")} Ω` };
  }
  if (PART_NUMBER.test(t) && !NOT_A_PART_NUMBER.test(t) && !/^\d/.test(t)) return { field: "partNumber", text: t };
  return null;
}

/** Pieces of combined value words: "10U_0603_25V6K", "0.1U/10V_4", "6.8UH-4.0A". */
function pieces(key: string, kind: Kind): string[] {
  const parts = key.split(/[_/]/).filter(Boolean);
  const out = parts.length > 1 ? [key, ...parts] : [key];
  if (kind === "L" && key.includes("-")) out.push(...key.split("-"));
  return out;
}

const height = (b: Box) => Math.max(1, Math.min(b.x1 - b.x0, b.y1 - b.y0));

/**
 * Distance from a part name to a word, larger for words above or left of
 * it: values sit below or to the right of the name.
 */
function reach(name: Box, word: Box): number {
  const dx = word.x0 > name.x1 ? word.x0 - name.x1 : name.x0 > word.x1 ? (name.x0 - word.x1) * 1.6 : 0;
  // Above the name only the line right on top counts ("CRITICAL"); further up is the part above.
  const dy = word.y0 > name.y1 ? word.y0 - name.y1 : name.y0 > word.y1 ? (name.y0 - word.y1) * 4 : 0;
  return Math.hypot(dx, dy);
}

/**
 * Reads the facts of all parts and nets the board knows from the indexed
 * schematic. `partNames` and `netNames` are upper case.
 */
export function readSchematicFacts(index: WordIndex, partNames: ReadonlySet<string>, netNames: ReadonlySet<string>): SchematicFacts {
  const parts = new Map<string, SchematicPart>();
  const netVotes = new Map<string, Map<string, number>>();

  for (const page of index.pages()) {
    const words = index.onPage(page);
    const names = words.filter((w) => partNames.has(w.key));
    // Per part name occurrence: the facts found around it.
    const found = new Map<Word, { facts: Map<Found["field"], { text: string; d: number }>; flags: Set<string> }>();

    if (names.length > 0) {
      // Part names in a coarse grid, so each word only looks at names nearby.
      const cell = 40;
      const grid = new Map<number, Word[]>();
      const keyOf = (cx: number, cy: number) => cy * 100003 + cx;
      for (const n of names) {
        for (let cy = Math.floor(n.box.y0 / cell); cy <= Math.floor(n.box.y1 / cell); cy++)
          for (let cx = Math.floor(n.box.x0 / cell); cx <= Math.floor(n.box.x1 / cell); cx++) {
            const list = grid.get(keyOf(cx, cy));
            if (list) list.push(n);
            else grid.set(keyOf(cx, cy), [n]);
          }
      }
      for (const w of words) {
        if (partNames.has(w.key) || netNames.has(w.key)) continue;
        const h = height(w.box);
        const range = h * 7;
        // The nearest part name, if close enough (text above or left counts double).
        let best: Word | undefined;
        let bestD = Infinity;
        const reachOut = range * 2;
        for (let cy = Math.floor((w.box.y0 - reachOut) / cell); cy <= Math.floor((w.box.y1 + reachOut) / cell); cy++)
          for (let cx = Math.floor((w.box.x0 - reachOut) / cell); cx <= Math.floor((w.box.x1 + reachOut) / cell); cx++)
            for (const n of grid.get(keyOf(cx, cy)) ?? []) {
              const d = reach(n.box, w.box);
              if (d < bestD) {
                bestD = d;
                best = n;
              }
            }
        if (!best || bestD > Math.max(range, height(best.box) * 7)) continue;
        const kind = partKind(best.key);
        let entry = found.get(best);
        for (const piece of pieces(w.key, kind)) {
          const f = classify(piece, kind);
          if (!f) continue;
          // Part numbers only for chips, and only right by the name.
          if (f.field === "partNumber" && (kind !== "chip" || bestD > height(best.box) * 3)) continue;
          if (!entry) found.set(best, (entry = { facts: new Map(), flags: new Set() }));
          if (f.field === "flag") entry.flags.add(f.text);
          else {
            const old = entry.facts.get(f.field);
            if (!old || bestD < old.d) entry.facts.set(f.field, { text: f.text, d: bestD });
          }
        }
      }
    }

    // A name drawn several times: keep the place with the most facts.
    for (const [w, entry] of found) {
      const score = entry.facts.size + entry.flags.size;
      const current = parts.get(w.key);
      const currentScore = current ? Object.keys(current).filter((k) => k !== "page" && k !== "flags").length + current.flags.length : -1;
      if (score <= currentScore) continue;
      const fact = (f: Found["field"]) => entry.facts.get(f)?.text;
      parts.set(w.key, {
        page,
        ...(fact("value") && { value: fact("value") }),
        ...(fact("partNumber") && { partNumber: fact("partNumber") }),
        ...(fact("rating") && { rating: fact("rating") }),
        ...(fact("tolerance") && { tolerance: fact("tolerance") }),
        ...(fact("dielectric") && { dielectric: fact("dielectric") }),
        ...(fact("package") && { package: fact("package") }),
        flags: [...entry.flags],
      });
    }

    // "VOLTAGE=3.3V" (split at "=") right under a net label.
    const labels = words.filter((w) => netNames.has(w.key));
    for (const v of words) {
      if (v.key !== "VOLTAGE") continue;
      const h = height(v.box);
      const value = words.find(
        (w) => VOLTS.test(w.key) && w.box.x0 >= v.box.x1 - 1 && w.box.x0 - v.box.x1 < h * 2 && Math.abs(w.box.y0 - v.box.y0) < h * 0.6,
      );
      if (!value) continue;
      let owner: Word | undefined;
      let ownerD = Infinity;
      for (const l of labels) {
        // The label sits above the property line, a few lines up at most.
        const up = v.box.y0 - l.box.y1;
        if (up < -h * 0.3 || up > h * 5) continue;
        const d = up + Math.abs(l.box.x0 - v.box.x0) * 0.5;
        if (d < ownerD) {
          ownerD = d;
          owner = l;
        }
      }
      if (!owner) continue;
      const votes = netVotes.get(owner.key) ?? new Map<string, number>();
      votes.set(value.key, (votes.get(value.key) ?? 0) + 1);
      netVotes.set(owner.key, votes);
    }
  }

  const netVoltages = new Map<string, string>();
  for (const [net, votes] of netVotes) netVoltages.set(net, [...votes].sort((a, b) => b[1] - a[1])[0][0]);
  return { parts, netVoltages };
}
