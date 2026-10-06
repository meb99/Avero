import { describe, expect, it } from "vitest";
import { boardToVideo, calibrate, screenToVideo, thumbDifference, videoToBoard, videoToScreen } from "./cameraOverlay";

const video = { width: 1920, height: 1080 };
const box = { x: 40, y: 10, width: 960, height: 540 };

describe("camera overlay", () => {
  it("goes from video to screen and back at any zoom, mirror and turn", () => {
    for (const view of [
      { zoom: 1, mirror: false, turns: 0 },
      { zoom: 2.5, mirror: true, turns: 1 },
      { zoom: 4, mirror: false, turns: 3 },
      { zoom: 1.3, mirror: true, turns: 2 },
    ]) {
      const p = { x: 812, y: 333 };
      const s = videoToScreen(p, video, box, view);
      const back = screenToVideo(s, video, box, view);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
    // Unzoomed and straight: just the layout box.
    expect(videoToScreen({ x: 0, y: 0 }, video, box, { zoom: 1, mirror: false, turns: 0 })).toEqual({ x: 40, y: 10 });
    // Mirrored: the left edge shows on the right.
    expect(videoToScreen({ x: 0, y: 0 }, video, box, { zoom: 1, mirror: true, turns: 0 }).x).toBeCloseTo(1000);
  });

  it("calibrates on four pins and hits them again, the bottom side mirrored as well", () => {
    // The camera sees the board turned, shifted and mirrored (bottom side).
    const toVideo = (b: { x: number; y: number }) => ({ x: 1500 - b.y * 0.8, y: 200 + b.x * 0.8 });
    const board = [
      { x: 100, y: 100 },
      { x: 900, y: 120 },
      { x: 880, y: 700 },
      { x: 120, y: 650 },
    ];
    const cal = calibrate(board.map(toVideo), board)!;
    expect(cal).not.toBeNull();
    const pin = { x: 412, y: 377 };
    const hit = videoToBoard(cal, toVideo(pin));
    expect(hit.x).toBeCloseTo(pin.x, 6);
    expect(hit.y).toBeCloseTo(pin.y, 6);
    const v = boardToVideo(cal)!(pin);
    expect(v.x).toBeCloseTo(toVideo(pin).x, 6);
    // Three of four points on one line: no calibration.
    expect(calibrate([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 5, y: 0 }], board)).toBeNull();
  });

  it("notices movement, not a brighter lamp", () => {
    const picture = Array.from({ length: 32 * 24 }, (_, i) => (i % 32) * 6 + ((i / 32) | 0) * 2);
    const brighter = picture.map((v) => v + 30);
    const moved = picture.map((_, i) => picture[(i + 5) % picture.length]);
    expect(thumbDifference(picture, brighter)).toBeLessThan(1);
    expect(thumbDifference(picture, moved)).toBeGreaterThan(14);
  });
});
