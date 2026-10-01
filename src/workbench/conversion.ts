import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ConvertedFile {
  path: string;
  duplicate: boolean;
  parts: number;
  pins: number;
}

export interface ConversionResult {
  files: ConvertedFile[];
  errors: string[];
}

/** Native file browser; cancelling it performs no conversion. */
export async function pickXzz(title: string): Promise<string[]> {
  const picked = await open({
    title, multiple: true, directory: false,
    filters: [{ name: "XinZhiZao PCB", extensions: ["pcb"] }],
  });
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
}

/** Each file runs on a native worker. Keep successful outputs when another fails. */
export async function convertXzzFiles(
  paths: string[], folder: string, xzzKey: string,
  progress: (index: number, total: number, path: string) => void,
): Promise<ConversionResult> {
  const result: ConversionResult = { files: [], errors: [] };
  for (const [i, path] of paths.entries()) {
    progress(i + 1, paths.length, path);
    try {
      result.files.push(await invoke<ConvertedFile>("convert_xzz_file", {
        path, folder: folder.trim() || null, xzzKey: xzzKey.trim() || null,
      }));
    } catch (error) {
      const name = path.split(/[\\/]/).pop() ?? path;
      result.errors.push(`${name}: ${String(error)}`);
    }
  }
  return result;
}
