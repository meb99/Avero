import { visibleFrom, type BoardModel, type ViewSide } from "../core/board";
import type { NetKind, Selection } from "../core/types";
import type { Palette, RGBA } from "./palette";

export interface DisplayOptions {
  /** Show parts and pins of the far side faintly. */
  ghostOtherSide: boolean;
  showVias: boolean;
  /** Fade everything that is not part of the current selection. */
  dimUnselected: boolean;
}

/** Per-element colors for one frame, as GPU-ready byte arrays. */
export interface BoardStyle {
  pinColors: Uint8Array;
  testPointColors: Uint8Array;
  partFillColors: Uint8Array;
  partOutlineColors: Uint8Array;
  partOutlineWidths: Float32Array;
  highlightedNet: number | undefined;
  selectedPart: number | undefined;
}

const GHOST_ALPHA = 0.12;
const FAR_HIGHLIGHT_ALPHA = 0.45;
const DIM_ALPHA = 0.4;

function put(out: Uint8Array, i: number, c: RGBA, alpha = 1): void {
  out[i * 4] = c[0];
  out[i * 4 + 1] = c[1];
  out[i * 4 + 2] = c[2];
  out[i * 4 + 3] = Math.round(c[3] * alpha);
}

function pinBase(p: Palette, kind: NetKind): RGBA {
  switch (kind) {
    case "power":
      return p.pinPower;
    case "ground":
      return p.pinGround;
    case "unconnected":
      return p.pinUnconnected;
    default:
      return p.pinSignal;
  }
}

export function computeStyle(
  model: BoardModel,
  view: ViewSide,
  selection: Selection,
  options: DisplayOptions,
  palette: Palette,
): BoardStyle {
  const { pins, parts, testPoints, nets } = model;
  const net = model.selectedNet(selection);
  const selectedPart = model.selectedPart(selection);
  const hasFocus = selection.kind !== "none";
  const dim = hasFocus && options.dimUnselected ? DIM_ALPHA : 1;

  const partsOnNet = new Set<number>();
  if (net !== undefined) for (const pin of nets[net].pins) partsOnNet.add(pins[pin].part);

  const pinColors = new Uint8Array(pins.length * 4);
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const near = visibleFrom(pin.side, view);
    const onNet = net !== undefined && pin.net === net;
    const selected = selection.kind === "pin" && selection.pin === i;
    if (selected) {
      put(pinColors, i, palette.pinSelected, near ? 1 : FAR_HIGHLIGHT_ALPHA);
    } else if (onNet) {
      // Far-side members stay visible so you can see where the net goes.
      put(pinColors, i, palette.pinHighlight, near ? 1 : FAR_HIGHLIGHT_ALPHA);
    } else if (selectedPart === pin.part) {
      put(pinColors, i, palette.pinOfSelectedPart, near ? 1 : GHOST_ALPHA);
    } else if (near) {
      put(pinColors, i, pinBase(palette, nets[pin.net].kind), dim);
    } else {
      put(pinColors, i, pinBase(palette, nets[pin.net].kind), options.ghostOtherSide ? GHOST_ALPHA : 0);
    }
  }

  const testPointColors = new Uint8Array(testPoints.length * 4);
  for (let i = 0; i < testPoints.length; i++) {
    const t = testPoints[i];
    const base = t.kind === "via" ? palette.via : palette.nail;
    const near = visibleFrom(t.side, view);
    const shown = t.kind !== "via" || options.showVias;
    if (selection.kind === "testPoint" && selection.testPoint === i) {
      put(testPointColors, i, palette.pinSelected, near ? 1 : FAR_HIGHLIGHT_ALPHA);
    } else if (net !== undefined && t.net === net && (shown || near)) {
      put(testPointColors, i, palette.pinHighlight, near ? 1 : FAR_HIGHLIGHT_ALPHA);
    } else if (!shown) {
      put(testPointColors, i, base, 0);
    } else {
      put(testPointColors, i, base, near ? dim : options.ghostOtherSide ? GHOST_ALPHA : 0);
    }
  }

  const partFillColors = new Uint8Array(parts.length * 4);
  const partOutlineColors = new Uint8Array(parts.length * 4);
  const partOutlineWidths = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const near = visibleFrom(parts[i].side, view);
    const far = near ? 1 : options.ghostOtherSide ? GHOST_ALPHA : 0;
    partOutlineWidths[i] = 1;
    if (i === selectedPart) {
      put(partFillColors, i, palette.partSelectedFill, near ? 1 : FAR_HIGHLIGHT_ALPHA);
      put(partOutlineColors, i, palette.partSelectedOutline, near ? 1 : FAR_HIGHLIGHT_ALPHA);
      partOutlineWidths[i] = 2;
    } else if (partsOnNet.has(i)) {
      put(partFillColors, i, palette.partFill, far);
      put(partOutlineColors, i, palette.partOnNetOutline, near ? 1 : FAR_HIGHLIGHT_ALPHA);
      partOutlineWidths[i] = 1.5;
    } else {
      put(partFillColors, i, palette.partFill, near ? dim : far);
      put(partOutlineColors, i, palette.partOutline, near ? dim : far);
    }
  }

  return { pinColors, testPointColors, partFillColors, partOutlineColors, partOutlineWidths, highlightedNet: net, selectedPart };
}
