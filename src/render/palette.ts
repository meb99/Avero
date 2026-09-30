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
  nail: RGBA;
  via: RGBA;
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
  nail: [255, 167, 38, 255],
  via: [120, 144, 156, 255],
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
  nail: [230, 81, 0, 255],
  via: [120, 144, 156, 255],
  label: "#1f2933",
  labelHalo: "rgba(255, 255, 255, 0.85)",
  labelPin: "#ffffff",
  selectionRing: "#111111",
};
