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
 * Dark, after FlexBV: a near-black board, light grey part outlines on solid
 * grey bodies, grey-green pins, red power pins, the highlighted net in
 * warm yellow with white connection lines, part names in lavender.
 */
export const DARK: Palette = {
  background: [6, 7, 9, 255],
  boardFill: [27, 28, 31, 255],
  boardEdge: [168, 170, 176, 255],
  partFill: [64, 67, 74, 150],
  partOutline: [150, 155, 164, 255],
  partSelectedFill: [190, 90, 255, 70],
  partSelectedOutline: [214, 120, 255, 255],
  partOnNetOutline: [255, 212, 64, 255],
  pinSignal: [140, 162, 142, 255],
  pinPower: [236, 64, 64, 255],
  pinGround: [92, 100, 96, 255],
  pinUnconnected: [58, 62, 64, 255],
  pinOfSelectedPart: [214, 120, 255, 255],
  pinHighlight: [255, 212, 64, 255],
  pinSelected: [255, 255, 255, 255],
  ratsnest: [255, 255, 255, 190],
  nail: [255, 160, 30, 255],
  via: [130, 140, 150, 255],
  trace: [196, 128, 64, 150],
  markerChip: [235, 235, 240, 255],
  packageFill: {
    passive: [176, 140, 88, 230],
    inductor: [118, 124, 134, 235],
    diode: [92, 92, 100, 240],
    crystal: [180, 186, 194, 230],
    ic: [52, 55, 62, 245],
    connector: [200, 204, 210, 70],
  },
  padMark: [214, 184, 110, 255],
  markerSmall: [176, 190, 197, 230],
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
  label: "#e4e8ee",
  labelChip: "#c9b8ff",
  labelHalo: "rgba(0, 0, 0, 0.9)",
  labelPin: "#0a0b0d",
  labelNetBg: "#ffd440",
  labelNetText: "#111111",
  selectionRing: "#ffffff",
};

/**
 * Light, with the same contrast: a white board, dark outlines and pins,
 * and the highlighted net in strong magenta instead of a pale yellow.
 */
export const LIGHT: Palette = {
  background: [214, 217, 222, 255],
  boardFill: [252, 252, 250, 255],
  boardEdge: [40, 44, 52, 255],
  partFill: [150, 156, 166, 120],
  partOutline: [46, 52, 62, 255],
  partSelectedFill: [0, 98, 230, 55],
  partSelectedOutline: [0, 98, 230, 255],
  partOnNetOutline: [214, 0, 120, 255],
  pinSignal: [52, 78, 104, 255],
  pinPower: [214, 0, 0, 255],
  pinGround: [120, 128, 138, 255],
  pinUnconnected: [184, 190, 198, 255],
  pinOfSelectedPart: [0, 98, 230, 255],
  pinHighlight: [230, 0, 130, 255],
  pinSelected: [0, 0, 0, 255],
  ratsnest: [200, 0, 115, 210],
  nail: [222, 90, 0, 255],
  via: [100, 116, 128, 255],
  trace: [176, 96, 30, 160],
  markerChip: [25, 25, 25, 255],
  packageFill: {
    passive: [184, 132, 62, 235],
    inductor: [86, 94, 104, 240],
    diode: [60, 60, 68, 240],
    crystal: [138, 146, 156, 240],
    ic: [36, 40, 48, 240],
    connector: [80, 86, 96, 60],
  },
  padMark: [150, 112, 30, 255],
  markerSmall: [70, 96, 110, 235],
  layerTop: [200, 30, 30, 255],
  layerBottom: [15, 90, 190, 255],
  layerInner: [
    [214, 130, 0, 255],
    [36, 120, 44, 255],
    [130, 30, 160, 255],
    [0, 120, 130, 255],
    [200, 60, 16, 255],
    [120, 110, 16, 255],
    [180, 20, 84, 255],
    [50, 66, 160, 255],
  ],
  label: "#111418",
  labelChip: "#3b1f9e",
  labelHalo: "rgba(255, 255, 255, 0.92)",
  labelPin: "#ffffff",
  labelNetBg: "#d60082",
  labelNetText: "#ffffff",
  selectionRing: "#000000",
};

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
