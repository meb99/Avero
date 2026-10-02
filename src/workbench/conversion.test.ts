import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { convertXzzFiles, pickXzz, pickXzzFolder } from "./conversion";

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
    const result = await convertXzzFiles(["/one.pcb", "/bad.pcb", "/two.pcb"], " Nintendo/Switch ", "", progress);
    expect(result.files).toEqual([output, { ...output, duplicate: true }]);
    expect(result.errors).toEqual(["bad.pcb: invalid input"]);
    expect(progress.mock.calls).toEqual([[0, 3, ""], [1, 3, "/one.pcb"], [2, 3, "/bad.pcb"], [3, 3, "/two.pcb"]]);
    expect(result.remaining).toBe(0);
    expect(invoke).toHaveBeenNthCalledWith(1, "convert_xzz_file", { path: "/one.pcb", folder: "Nintendo/Switch", xzzKey: null });
  });

  it("runs two files at once, deduplicates selections, and keeps selection order", async () => {
    const completions = new Map<string, (value: unknown) => void>();
    vi.mocked(invoke).mockImplementation((_command, args) => new Promise((resolve) => completions.set((args as { path: string }).path, resolve)));
    const progress = vi.fn();
    const running = convertXzzFiles(["/first.pcb", "/second.pcb", "/third.pcb", "/first.pcb"], "", "", progress);
    expect(invoke).toHaveBeenCalledTimes(2);
    const file = (name: string) => ({ path: `${name}.cad`, duplicate: false, parts: 1, pins: 2 });
    completions.get("/second.pcb")!(file("second"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    completions.get("/third.pcb")!(file("third"));
    completions.get("/first.pcb")!(file("first"));
    const result = await running;
    expect(result.files.map((f) => f.path)).toEqual(["first.cad", "second.cad", "third.cad"]);
    expect(progress.mock.calls.map(([n]) => n)).toEqual([0, 1, 2, 3]);
  });

  it("stops queued work and finishes the current files", async () => {
    const finishes: ((value: unknown) => void)[] = [];
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
    const controller = new AbortController();
    const running = convertXzzFiles(["/a.pcb", "/b.pcb", "/c.pcb"], "", "", vi.fn(), controller.signal);
    controller.abort();
    finishes.forEach((finish, i) => finish({ path: `${i}.cad`, duplicate: false, parts: 1, pins: 1 }));
    const result = await running;
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.files).toHaveLength(2);
    expect(result.remaining).toBe(1);
  });

  it("selects a folder and asks native code to find XZZ files; cancellation starts no work", async () => {
    vi.mocked(open).mockResolvedValueOnce("/boards").mockResolvedValueOnce(null);
    vi.mocked(invoke).mockResolvedValue(["/boards/one.pcb", "/boards/sub/two.pcb"]);
    expect(await pickXzzFolder("Folder")).toHaveLength(2);
    expect(invoke).toHaveBeenCalledWith("find_xzz_files", { path: "/boards" });
    expect(await pickXzzFolder("Folder")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
