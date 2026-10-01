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
  labelHalo: string;
  labelPin: string;
  selectionRing: string;
}

export const DARK: Palette = {
  background: [14, 16, 20, 255],
  boardFill: [20, 33, 27, 255],
  boardEdge: [201, 180, 88, 255],
  partFill: [140, 155, 170, 22],
  partOutline: [112, 124, 138, 255],
  partSelectedFill: [79, 195, 247, 46],
  partSelectedOutline: [79, 195, 247, 255],
  partOnNetOutline: [255, 213, 79, 170],
  pinSignal: [143, 163, 184, 255],
  pinPower: [229, 115, 115, 255],
  pinGround: [74, 85, 99, 255],
  pinUnconnected: [52, 58, 68, 255],
  pinOfSelectedPart: [79, 195, 247, 255],
  pinHighlight: [255, 213, 79, 255],
  pinSelected: [255, 255, 255, 255],
  ratsnest: [255, 213, 79, 150],
  nail: [255, 167, 38, 255],
  via: [120, 144, 156, 255],
  trace: [196, 128, 64, 150],
  markerChip: [245, 245, 245, 255],
  packageFill: {
    passive: [196, 156, 98, 210],
    inductor: [120, 128, 138, 220],
    diode: [96, 96, 104, 230],
    crystal: [190, 196, 204, 220],
    ic: [44, 48, 56, 235],
    connector: [210, 214, 220, 60],
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
  label: "#dfe6ec",
  labelHalo: "rgba(10, 12, 16, 0.85)",
  labelPin: "#0e1014",
  selectionRing: "#ffffff",
};

export const LIGHT: Palette = {
  background: [238, 240, 243, 255],
  boardFill: [219, 233, 223, 255],
  boardEdge: [138, 109, 0, 255],
  partFill: [70, 85, 100, 20],
  partOutline: [107, 119, 132, 255],
  partSelectedFill: [2, 119, 189, 40],
  partSelectedOutline: [2, 119, 189, 255],
  partOnNetOutline: [214, 140, 0, 190],
  pinSignal: [77, 99, 120, 255],
  pinPower: [198, 40, 40, 255],
  pinGround: [150, 160, 172, 255],
  pinUnconnected: [196, 202, 210, 255],
  pinOfSelectedPart: [2, 119, 189, 255],
  pinHighlight: [245, 158, 11, 255],
  pinSelected: [20, 20, 20, 255],
  ratsnest: [214, 120, 0, 170],
  nail: [230, 81, 0, 255],
  via: [120, 144, 156, 255],
  trace: [184, 106, 40, 140],
  markerChip: [33, 33, 33, 255],
  packageFill: {
    passive: [190, 142, 76, 225],
    inductor: [96, 104, 114, 230],
    diode: [70, 70, 78, 235],
    crystal: [150, 158, 168, 230],
    ic: [40, 44, 52, 235],
    connector: [90, 96, 104, 50],
  },
  padMark: [176, 140, 56, 255],
  markerSmall: [84, 110, 122, 230],
  layerTop: [211, 47, 47, 255],
  layerBottom: [21, 101, 192, 255],
  layerInner: [
    [230, 145, 0, 255],
    [46, 125, 50, 255],
    [142, 36, 170, 255],
    [0, 131, 143, 255],
    [216, 67, 21, 255],
    [130, 119, 23, 255],
    [194, 24, 91, 255],
    [57, 73, 171, 255],
  ],
  label: "#1f2933",
  labelHalo: "rgba(255, 255, 255, 0.85)",
  labelPin: "#ffffff",
  selectionRing: "#111111",
};

/** Color of trace layer `index`. */
export function layerColor(p: Palette, layers: readonly Layer[], index: number): RGBA {
  const layer = layers[index];
  if (!layer || layer.side === "top") return p.layerTop;
  if (layer.side === "bottom") return p.layerBottom;
  let inner = 0;
  for (let i = 0; i < index; i++) if (layers[i].side === "both") inner++;
  return p.layerInner[inner % p.layerInner.length];
}
