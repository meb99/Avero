import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Board, LoadError, LoadResult } from "./types";

/** Where a board came from, for the title bar and recent files. */
export interface BoardSource {
  name: string;
  path?: string;
  projectMember?: string;
}

export interface Loaded {
  result: LoadResult;
  source: BoardSource;
}

/** Extensions offered in the open dialog. Keep in sync with avero_formats::formats::SUPPORTED. */
export const BOARD_EXTENSIONS = ["brd", "bdv", "asc", "bvr", "bvr3", "cad", "gcd", "gencad", "cst", "pcb", "fz", "cae", "kicad_pcb", "pcbdoc", "fab", "txt", "gr", "averopkg", "averoboard", "tvw", "hyp", "bv", "epro", "epcb", "odb", "zip", "tgz", "tar", "gz"];

export interface ProjectMember { id:string;name:string;format:string }
type ProjectPrompt=(name:string,choices:ProjectMember[])=>Promise<string|null>;
let projectPrompt:ProjectPrompt|null=null;
let pendingProject:Promise<unknown>=Promise.resolve();
export function setProjectPrompt(prompt:ProjectPrompt|null):void{projectPrompt=prompt;}
export const isProjectPath=(path:string)=>/\.(epro|epcb|odb|zip|tgz|tar|tar\.gz)$/i.test(path);
function chooseProject(name:string,members:ProjectMember[]):Promise<string|null>{
  const choice=pendingProject.then(()=>projectPrompt?.(name,members)??null);
  pendingProject=choice.catch(()=>null);
  return choice;
}
export async function pickProjectFolder(title:string):Promise<string|undefined>{const path=await open({title,directory:true,multiple:false});return typeof path==="string"?path:undefined;}

async function load(command: string, args: Record<string, unknown>): Promise<LoadResult> {
  try {
    return { ok: true, board: await invoke<Board>(command, args) };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e) return { ok: false, error: e as LoadError };
    return { ok: false, error: { code: "io", message: String(e) } };
  }
}

/** Parses a file natively in Rust (which also resolves ASC companion files). */
/** Keys for encrypted formats, as typed in the settings. */
export interface FormatKeys {
  xzzKey?: string;
  fzKey?: string;
}

export async function loadPath(path: string, keys: FormatKeys = {}, projectFolder=false, requestedMember?:string): Promise<Loaded> {
  let name = path.split("/").pop() ?? path;
  let projectMember:string|undefined;
  const args:Record<string,unknown> = { path, xzzKey: keys.xzzKey || null, fzKey: keys.fzKey || null };
  if(projectFolder || isProjectPath(path)) {
    try {
      const members=await invoke<ProjectMember[]>("project_members",{path});
      if(members.length>1){const choice=members.some((m)=>m.id===requestedMember)?requestedMember:await chooseProject(name,members);if(!choice)return{result:{ok:false,error:{code:"cancelled",message:"Project selection cancelled"}},source:{name,path}};projectMember=choice;}
      else if(members.length===1)projectMember=members[0].id;
      if(projectMember){args.projectMember=projectMember;const selected=members.find((m)=>m.id===projectMember);name=`${name} · ${selected?.name??projectMember}`;}
    }catch(e){return{result:{ok:false,error:e&&typeof e==="object"&&"code"in e?e as LoadError:{code:"io",message:String(e)}},source:{name,path}};}
  }
  return { result: await load("open_board", args), source: { name, path, ...(projectMember&&{projectMember}) } };
}

export async function loadDemo(): Promise<Loaded> {
  return { result: await load("open_demo", {}), source: { name: "Avero Demo" } };
}

/** Native open panel. Resolves to `undefined` when cancelled. */
export async function pickPath(title: string, kind: "any" | "pdf"): Promise<string | undefined> {
  const filters =
    kind === "pdf"
      ? [{ name: "PDF", extensions: ["pdf"] }]
      : [
          { name: "Boardview / PDF", extensions: [...BOARD_EXTENSIONS, "pdf"] },
          { name: "Boardview", extensions: BOARD_EXTENSIONS },
          { name: "PDF", extensions: ["pdf"] },
        ];
  const picked = await open({ title, multiple: false, directory: false, filters });
  return typeof picked === "string" ? picked : undefined;
}

/** Native open panel for a photo. */
export async function pickImage(title: string, defaultPath?: string): Promise<string | undefined> {
  const picked = await open({
    title,
    defaultPath,
    multiple: false,
    directory: false,
    filters: [{ name: "Foto", extensions: ["jpg", "jpeg", "png", "heic", "webp"] }],
  });
  return typeof picked === "string" ? picked : undefined;
}

/** Raw bytes of a file, transferred as binary. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }));
}

/**
 * Asks where to save and writes the bytes there. Resolves to the chosen
 * path, or `undefined` when cancelled.
 */
export async function saveBytes(
  bytes: Uint8Array,
  title: string,
  defaultName: string,
  filter: { name: string; extensions: string[] },
): Promise<string | undefined> {
  const path = await save({ title, defaultPath: defaultName, filters: [filter] });
  if (!path) return undefined;
  await invoke("write_binary", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  return path;
}

/** Schematic PDFs in the board's folder, best match first. */
export function schematicsFor(boardPath: string): Promise<string[]> {
  return invoke<string[]>("schematics_for", { boardPath });
}

/** Files dropped onto the window. */
export function onFileDrop(handler: (paths: string[]) => void, hover: (over: boolean) => void): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") hover(true);
    else if (p.type === "leave") hover(false);
    else if (p.type === "drop") {
      hover(false);
      handler(p.paths);
    }
  });
}

/**
 * Files opened from Finder ("Open With", double-click, drop on the Dock
 * icon). Paths that arrived before the UI was ready are delivered first.
 */
export async function onFinderOpen(handler: (paths: string[]) => void): Promise<() => void> {
  const unlisten = await listen<string[]>("open-paths", (e) => handler(e.payload));
  const pending = await invoke<string[]>("take_pending_paths");
  if (pending.length > 0) handler(pending);
  return unlisten;
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  await getCurrentWindow().setTitle(title);
}
