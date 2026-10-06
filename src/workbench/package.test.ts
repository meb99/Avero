import { describe, expect, it } from "vitest";
import { photosOf } from "./package";
import { parseNotes } from "./notes";

describe("board packages", () => {
  it("take every photo the notes use, once", () => {
    const n = parseNotes(
      JSON.stringify({
        version: 1,
        key: "B",
        reference: {},
        photos: { top: { file: "/p/top.jpg", matrix: [1, 0, 0, 1, 0, 0], opacity: 0.8 } },
        cases: [{ id: "c1", title: "A", created: "x", notes: "", readings: {}, photos: ["/p/a.jpg", "/p/top.jpg"] }],
        markers: [{ id: "m1", x: 0, y: 0, side: "top", text: "t", created: "x", photos: ["/p/m.jpg"] }],
      }),
    )!;
    expect(photosOf(n).sort()).toEqual(["/p/a.jpg", "/p/m.jpg", "/p/top.jpg"]);
  });
});
