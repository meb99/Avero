import { readFileBytes } from "../core/loader";
import { categoryFolder, guessCategory, isSorted, matchExisting, type Category, type TreeNode } from "./catalog";
import { cachedIndex, storeIndex } from "./fulltext";
import type { LibraryEntry } from "./library";

/** Where one library entry should go, and why. */
export interface SortPlan {
  entry: LibraryEntry;
  category: Category;
  /** Folder below the library root, e.g. `Sony/PlayStation/5/EDM-020`. */
  target: string;
  /** The guess came from the file and folder names, or from schematic text. */
  from: "name" | "schematic";
}

/** Entries of the own library that are not in a category yet. */
export function unsortedEntries(entries: LibraryEntry[], root: string): LibraryEntry[] {
  return entries.filter((e) => e.root === root && !isSorted(e.folder));
}

/**
 * The plan for one entry: category from its names, or from the words of its
 * schematics when the names say nothing. The entry's own folder (usually the
 * board number) stays below the category, as with manual sorting.
 */
export function planFor(entry: LibraryEntry, tree: TreeNode[], schematicWords?: string[]): SortPlan | null {
  const files = [...entry.boards, ...entry.schematics, ...entry.unsupported];
  let category = guessCategory([entry.title, entry.folder, ...files.map((f) => f.name)]);
  let from: SortPlan["from"] = "name";
  if (!category.brand && schematicWords?.length) {
    category = guessCategory(schematicWords, { strict: true });
    from = "schematic";
  }
  if (!category.brand) return null;
  category = matchExisting(tree, category);
  const own = entry.folder.split("/").filter(Boolean).pop() || entry.title;
  // Below the category, keep the entry's own folder unless it only repeats
  // the model (SM-A515F under Galaxy A › A515F).
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const levels = [category.brand, category.family, category.model].map(compact);
  const repeats = levels.includes(compact(own)) || (levels[2].length >= 3 && compact(own).includes(levels[2]));
  const target = repeats ? categoryFolder(category) : [categoryFolder(category), own].join("/");
  return { entry, category, target, from };
}

/** How much schematic text is read per PDF for a guess. */
const MAX_WORDS = 4000;

/**
 * Words of the entry's schematics, from the full-text cache or read now (and
 * then cached, which also serves the library's content search).
 */
export async function schematicWords(entry: LibraryEntry, stop: () => boolean): Promise<string[]> {
  const words: string[] = [];
  for (const file of entry.schematics) {
    if (stop()) break;
    let index = await cachedIndex(file).catch(() => null);
    if (!index) {
      try {
        const { extractTextIndex } = await import("../schematic/document");
        index = await extractTextIndex(await readFileBytes(file.path), stop);
        if (index) await storeIndex(file, index).catch(() => {});
      } catch {
        index = null;
      }
    }
    if (index) words.push(...Object.keys(index.words).slice(0, MAX_WORDS));
  }
  return words;
}
