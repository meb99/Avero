import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { convertXzzFiles, pickXzz } from "./conversion";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe("XZZ conversion", () => {
  it("cancelling the picker starts no work", async () => {
    vi.mocked(open).mockResolvedValue(null);
    expect(await pickXzz("Browse files")).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, filters: [{ name: "XinZhiZao PCB", extensions: ["pcb"] }] }));
  });

  it("keeps successful outputs, reports per-file errors and continues a batch", async () => {
    const output = { path: "/library/Board.cad", duplicate: false, parts: 2, pins: 8 };
    vi.mocked(invoke).mockResolvedValueOnce(output).mockRejectedValueOnce("invalid input").mockResolvedValueOnce({ ...output, duplicate: true });
    const progress = vi.fn();
    const result = await convertXzzFiles(["/one.pcb", "/bad.pcb", "/one.pcb"], " Nintendo/Switch ", "", progress);
    expect(result.files).toEqual([output, { ...output, duplicate: true }]);
    expect(result.errors).toEqual(["bad.pcb: invalid input"]);
    expect(progress.mock.calls).toEqual([[1, 3, "/one.pcb"], [2, 3, "/bad.pcb"], [3, 3, "/one.pcb"]]);
    expect(invoke).toHaveBeenNthCalledWith(1, "convert_xzz_file", { path: "/one.pcb", folder: "Nintendo/Switch", xzzKey: null });
  });
});
