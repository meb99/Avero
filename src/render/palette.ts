import type { Layer } from "../core/types";

/** RGBA, 0–255 per channel. */
export type RGBA = readonly [number, number, number, number];

export interface Palette {
  background: RGBA;
  boardFill: RGBA;
  boardEdge: RGBA;
  partFill: RGBA;
  partOutline: RGBA;
  partSelectedFill: RGBA;
  partSelectedOutline: RGBA;
  /** Outline of parts that touch the highlighted net. */
  partOnNetOutline: RGBA;
  pinSignal: RGBA;
  pinPower: RGBA;
  pinGround: RGBA;
  pinUnconnected: RGBA;
  /** Pin 1 of a part with more than two pins, as FlexBV marks it. */
  pinFirst: RGBA;
  pinOfSelectedPart: RGBA;
  pinHighlight: RGBA;
  pinSelected: RGBA;
  ratsnest: RGBA;
  nail: RGBA;
  via: RGBA;
  /** Body fill per package family, so parts are told apart at a glance. */
  packageFill: Record<"passive" | "inductor" | "diode" | "crystal" | "ic" | "connector", RGBA>;
  /** Pads of estimated footprints. */
  padMark: RGBA;
  /** Markers of parts with known position only: chips and small parts. */
  markerChip: RGBA;
  markerSmall: RGBA;
  /** Copper tracks of the side in view. */
  trace: RGBA;
  /** Trace colors: top, bottom, then inner layers in turn. */
  layerTop: RGBA;
  layerBottom: RGBA;
  layerInner: readonly RGBA[];
  label: string;
  /** Names of chips and other big parts. */
  labelChip: string;
  labelHalo: string;
  /** Name tags of parts on the highlighted net. */
  labelNetBg: string;
  labelNetText: string;
  labelPin: string;
  selectionRing: string;
}

/**
 * The board as FlexBV draws it ("olive"): a dark olive board, grey part bodies and pins,
 * pin 1 of a chip in red, part names in orange, the highlighted net in lavender with
 * lavender connection lines, test points as gold dots, the selected part outlined in red.
 * Power pins are grey like the rest: colour is kept for what is selected.
 */
const OLIVE = {
  boardFill: [37, 34, 28, 255],
  boardEdge: [92, 88, 70, 255],
  partFill: [58, 58, 58, 235],
  partOutline: [122, 122, 122, 255],
  // Only the red outline marks the selected part, as in FlexBV.
  partSelectedFill: [224, 30, 30, 0],
  partSelectedOutline: [224, 30, 30, 255],
  partOnNetOutline: [212, 196, 74, 255],
  pinSignal: [114, 114, 114, 255],
  pinPower: [114, 114, 114, 255],
  pinGround: [95, 111, 96, 255],
  pinUnconnected: [74, 74, 74, 255],
  pinFirst: [214, 64, 64, 255],
  pinOfSelectedPart: [150, 150, 150, 255],
  pinHighlight: [169, 156, 247, 255],
  pinSelected: [222, 214, 255, 255],
  ratsnest: [138, 124, 240, 230],
  nail: [184, 150, 46, 255],
  via: [95, 110, 105, 255],
  trace: [196, 128, 64, 150],
  markerChip: [200, 200, 200, 255],
  packageFill: {
    passive: [106, 74, 58, 235],
    inductor: [76, 76, 76, 240],
    diode: [53, 80, 168, 240],
    crystal: [189, 189, 168, 230],
    ic: [38, 38, 38, 245],
    connector: [90, 90, 90, 110],
  },
  padMark: [138, 138, 106, 255],
  markerSmall: [138, 138, 138, 230],
  layerTop: [239, 83, 80, 255],
  layerBottom: [66, 133, 244, 255],
  layerInner: [
    [255, 193, 7, 255],
    [102, 187, 106, 255],
    [186, 104, 200, 255],
    [38, 198, 218, 255],
    [255, 138, 101, 255],
    [212, 225, 87, 255],
    [240, 98, 146, 255],
    [121, 134, 203, 255],
  ],
  label: "#e8963a",
  labelChip: "#e8963a",
  labelHalo: "rgba(0, 0, 0, 0.55)",
  labelPin: "#f2f2f2",
  labelNetBg: "#a99cf7",
  labelNetText: "#111111",
  selectionRing: "#ffffff",
} as const satisfies Omit<Palette, "background">;

/** Olive on a dark grey ground, for the dark appearance. */
export const DARK: Palette = { ...OLIVE, background: [30, 30, 30, 255] };

/** Olive on FlexBV's light grey ground: the standard look with the light appearance. */
export const LIGHT: Palette = { ...OLIVE, background: [214, 214, 214, 255] };

/** Colors for nets pinned at the same time, in pinning order. */
export const PIN_COLORS: readonly RGBA[] = [
  [236, 72, 153, 255],
  [34, 197, 94, 255],
  [59, 130, 246, 255],
  [168, 85, 247, 255],
  [6, 182, 212, 255],
  [249, 115, 22, 255],
];

/** Color of trace layer `index`. */
export function layerColor(p: Palette, layers: readonly Layer[], index: number): RGBA {
  const layer = layers[index];
  if (!layer || layer.side === "top") return p.layerTop;
  if (layer.side === "bottom") return p.layerBottom;
  let inner = 0;
  for (let i = 0; i < index; i++) if (layers[i].side === "both") inner++;
  return p.layerInner[inner % p.layerInner.length];
}

/** The colours one may change in the settings, most visible first. */
export const EDITABLE_COLORS = [
  "background",
  "boardFill",
  "boardEdge",
  "partFill",
  "partOutline",
  "partSelectedOutline",
  "pinSignal",
  "pinPower",
  "pinGround",
  "pinFirst",
  "pinHighlight",
  "partOnNetOutline",
  "ratsnest",
  "nail",
  "via",
  "trace",
  "label",
  "labelChip",
] as const;

export type EditableColor = (typeof EDITABLE_COLORS)[number];
/** Own colours as #rrggbb, per key. */
export type OwnColors = Partial<Record<EditableColor, string>>;

const HEX = /^#[0-9a-f]{6}$/i;

const hexOf = (c: RGBA | string): string => {
  if (typeof c === "string") {
    if (HEX.test(c)) return c.toLowerCase();
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
    return m ? hexOf([+m[1], +m[2], +m[3], 255]) : "#ffffff";
  }
  return `#${[c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
};

/** A palette colour as #rrggbb, for a colour field. */
export function colorHex(p: Palette, key: EditableColor): string {
  return hexOf(p[key] as RGBA | string);
}

/** The palette with own colours applied; RGBA keys keep their transparency. */
export function withColors(base: Palette, colors: OwnColors | undefined): Palette {
  if (!colors) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of EDITABLE_COLORS) {
    const hex = colors[key];
    if (!hex || !HEX.test(hex)) continue;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const was = base[key] as RGBA | string;
    out[key] = typeof was === "string" ? hex : ([r, g, b, was[3]] as RGBA);
  }
  return out as unknown as Palette;
}

/** Ready-made sets: high contrast for bright workshops and small screens. */
export const COLOR_PRESETS: Record<"contrast", { dark: OwnColors; light: OwnColors }> = {
  contrast: {
    dark: {
      background: "#000000",
      boardFill: "#000000",
      boardEdge: "#ffffff",
      partOutline: "#e6e6e6",
      pinSignal: "#3ddc84",
      pinPower: "#ff3b30",
      pinGround: "#8e8e93",
      pinHighlight: "#ffff00",
      partOnNetOutline: "#ffff00",
      ratsnest: "#00e5ff",
      label: "#ffffff",
      labelChip: "#ff9cff",
    },
    light: {
      background: "#ffffff",
      boardFill: "#ffffff",
      boardEdge: "#000000",
      partOutline: "#000000",
      pinSignal: "#007a3d",
      pinPower: "#d70015",
      pinGround: "#3a3a3c",
      pinHighlight: "#c800c8",
      partOnNetOutline: "#c800c8",
      ratsnest: "#0040dd",
      label: "#000000",
      labelChip: "#5b00b5",
    },
  },
};
