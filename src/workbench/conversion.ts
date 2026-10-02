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
  remaining: number;
}

/** Include XZZ files in subfolders, without selecting other EDA .pcb files. */
export async function pickXzzFolder(title: string): Promise<string[] | null> {
  const picked = await open({ title, multiple: false, directory: true });
  return typeof picked === "string" ? invoke<string[]>("find_xzz_files", { path: picked }) : null;
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
  progress: (completed: number, total: number, path: string) => void,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  const unique = [...new Set(paths)];
  const files: (ConvertedFile | undefined)[] = new Array(unique.length);
  const errors: (string | undefined)[] = new Array(unique.length);
  let next = 0, completed = 0;
  progress(0, unique.length, "");
  const worker = async () => {
    while (next < unique.length && !signal?.aborted) {
      const i = next++;
      const path = unique[i];
      try {
        files[i] = await invoke<ConvertedFile>("convert_xzz_file", {
          path, folder: folder.trim() || null, xzzKey: xzzKey.trim() || null,
        });
      } catch (error) {
        const name = path.split(/[\\/]/).pop() ?? path;
        errors[i] = `${name}: ${String(error)}`;
      }
      progress(++completed, unique.length, path);
    }
  };
  // Two native workers keep the batch moving without loading every PCB at once.
  await Promise.all(Array.from({ length: Math.min(2, unique.length) }, worker));
  return {
    files: files.filter((file): file is ConvertedFile => file !== undefined),
    errors: errors.filter((error): error is string => error !== undefined),
    remaining: unique.length - completed,
  };
}
