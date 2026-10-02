/**
 * Where a pin of a part is in the schematic: of all places the part's
 * designator appears, the one with the pin's net written next to it, and
 * the pin number between the two (pin numbers sit at the end of the pin,
 * net labels on the wire leaving it).
 */
import type { Box, Word, WordIndex } from "./textIndex";

export interface PinSpot {
  /** Index into the designator occurrences. */
  hit: number;
  /** The pin number at the symbol, when found. */
  pin?: Word;
  /** The net label on the pin's wire, when found. */
  net?: Word;
}

const center = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const distance = (a: Box, b: Box) => {
  const p = center(a);
  const q = center(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/** A pin number that is unlikely to be anything else near the symbol: BGA balls (A12) or long numbers. */
const distinctive = (pin: string) => /[A-Z]/i.test(pin) || pin.length >= 3;

/**
 * `partHits` are the designator's occurrences (as the schematic view lists
 * them), `nets` the names the pin's net may have in the schematic.
 */
export function findPinSpot(index: WordIndex, partHits: readonly Word[], pin: string, nets: readonly string[]): PinSpot | null {
  const pinKey = pin.trim().toUpperCase();
  const netKeys = new Set(nets.map((n) => n.trim().toUpperCase()).filter(Boolean));
  let best: { spot: PinSpot; score: number } | null = null;
  partHits.forEach((part, hit) => {
    // Text height (the short side, text may run vertically) as the unit:
    // symbols are some tens of text lines across.
    const unit = Math.max(Math.min(part.box.x1 - part.box.x0, part.box.y1 - part.box.y0), 1e-3);
    const reach = unit * 45;
    const near = index.onPage(part.page).filter((w) => w !== part && distance(w.box, part.box) <= reach);
    const netWords = near.filter((w) => netKeys.has(w.key)).sort((a, b) => distance(a.box, part.box) - distance(b.box, part.box));
    const pinWords = pinKey ? near.filter((w) => w.key === pinKey) : [];
    let spot: PinSpot | null = null;
    let score = Infinity;
    // Best: a pin number with the net label right beside it (its own row,
    // when several pins share the net).
    for (const pinWord of pinWords) {
      const net = netWords.reduce<Word | undefined>((b, w) => (!b || distance(w.box, pinWord.box) < distance(b.box, pinWord.box) ? w : b), undefined);
      if (!net) break;
      const d = distance(net.box, pinWord.box) / unit;
      if (d <= 25 && d + distance(pinWord.box, part.box) / unit / 100 < score) {
        spot = { hit, pin: pinWord, net };
        score = d + distance(pinWord.box, part.box) / unit / 100;
      }
    }
    if (!spot && netWords.length) {
      // The net at the symbol without a readable pin number.
      spot = { hit, net: netWords[0] };
      score = 50 + distance(netWords[0].box, part.box) / unit;
    } else if (!spot && pinWords.length && distinctive(pinKey)) {
      const pinWord = [...pinWords].sort((a, b) => distance(a.box, part.box) - distance(b.box, part.box))[0];
      spot = { hit, pin: pinWord };
      // Weaker evidence than a net label.
      score = 100 + distance(pinWord.box, part.box) / unit;
    }
    if (spot && (!best || score < best.score)) best = { spot, score };
  });
  return best ? (best as { spot: PinSpot }).spot : null;
}
