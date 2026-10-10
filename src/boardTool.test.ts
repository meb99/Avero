import { describe, expect, it } from "vitest";
import {
  abandonedPhoto,
  alignTool,
  changeAlignment,
  drawPoint,
  drawTool,
  MARKER_TOOL,
  moveTool,
  NO_TOOL,
  openArea,
  rulerPoint,
  rulerTool,
  takesClicks,
  toggleMarker,
  toggleRuler,
  type PhotoAlignment,
} from "./boardTool";

const p = (x: number, y = 0) => ({ x, y });
const alignment = (fresh: boolean, picked = 2): PhotoAlignment => ({
  side: "top",
  file: "photo.jpg",
  image: {} as HTMLCanvasElement,
  fresh,
  count: 2,
  photoPoints: [p(1), p(2)].slice(0, picked),
  boardPoints: [],
});

describe("board tool", () => {
  it("toggles the marker and the ruler", () => {
    expect(toggleMarker(NO_TOOL)).toEqual(MARKER_TOOL);
    expect(toggleMarker(MARKER_TOOL)).toEqual(NO_TOOL);
    // One tool at a time: the ruler replaces the marker.
    expect(toggleRuler(MARKER_TOOL, "bottom")).toEqual({ kind: "ruler", side: "bottom", points: [] });
    expect(toggleRuler(rulerTool("top"), "top")).toEqual(NO_TOOL);
  });

  it("measures two points, then starts over on the side clicked", () => {
    let tool = rulerPoint(rulerTool("top"), p(1), "bottom");
    tool = rulerPoint(tool, p(2), "top");
    expect(tool).toEqual({ kind: "ruler", side: "bottom", points: [p(1), p(2)] });
    expect(rulerPoint(tool, p(3), "top")).toEqual({ kind: "ruler", side: "top", points: [p(3)] });
    expect(rulerPoint(MARKER_TOOL, p(3), "top")).toBe(MARKER_TOOL);
  });

  it("finishes a line after two points, an area only by hand", () => {
    const first = drawPoint(drawTool("line", "top"), p(1), "bottom", "U7.3 · PP3V3");
    expect(first.finished).toBeUndefined();
    const second = drawPoint(first.tool, p(2), "top", "");
    expect(second.tool).toEqual(NO_TOOL);
    expect(second.finished).toEqual({ kind: "line", side: "bottom", points: [p(1), p(2)], ends: ["U7.3 · PP3V3", ""] });

    let area = drawTool("area", "top");
    for (const x of [1, 2, 3, 4]) area = drawPoint(area, p(x), "top", "").tool;
    expect(openArea(area)?.points).toHaveLength(4);
    expect(openArea(drawTool("line", "top"))).toBeNull();
  });

  it("gives clicks to the tool in use", () => {
    expect(takesClicks(NO_TOOL)).toBe(false);
    expect(takesClicks(MARKER_TOOL, true)).toBe(true);
    expect(takesClicks(moveTool("d1"))).toBe(true);
    expect(takesClicks(moveTool("d1"), true)).toBe(false);
    // The alignment wants board points only once the photo's points are picked.
    expect(takesClicks(alignTool(alignment(true, 1)))).toBe(false);
    expect(takesClicks(alignTool(alignment(true, 2)))).toBe(true);
    expect(takesClicks(alignTool(alignment(true, 2)), true)).toBe(false);
  });

  it("changes only an alignment in progress", () => {
    const tool = changeAlignment(alignTool(alignment(false)), (a) => ({ ...a, boardPoints: [p(5)] }));
    expect(tool.kind === "align" && tool.alignment.boardPoints).toEqual([p(5)]);
    expect(changeAlignment(MARKER_TOOL, (a) => a)).toBe(MARKER_TOOL);
  });

  it("leaves a photo imported for an unfinished alignment to be deleted", () => {
    const fresh = alignTool(alignment(true));
    expect(abandonedPhoto(fresh, rulerTool("top"))).toBe("photo.jpg");
    expect(abandonedPhoto(fresh, NO_TOOL)).toBe("photo.jpg");
    expect(abandonedPhoto(fresh, changeAlignment(fresh, (a) => ({ ...a, boardPoints: [p(1)] })))).toBeNull();
    expect(abandonedPhoto(alignTool(alignment(false)), NO_TOOL)).toBeNull();
    expect(abandonedPhoto(drawTool("line", "top"), NO_TOOL)).toBeNull();
  });
});
