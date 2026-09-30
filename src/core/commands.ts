/** An entry of the command palette. */
export interface Command {
  id: string;
  label: string;
  /** Keyboard shortcut shown on the right, e.g. "⌘O". */
  shortcut?: string;
  /** Hidden when false, e.g. board commands without a board. */
  enabled?: boolean;
  run(): void;
}

/**
 * Commands whose label contains every word of the query, in any order.
 * Labels starting with the query come first; otherwise the given order holds.
 */
export function matchCommands(commands: readonly Command[], query: string): Command[] {
  const available = commands.filter((c) => c.enabled !== false);
  const q = query.trim().toLocaleLowerCase();
  if (!q) return available;
  const words = q.split(/\s+/);
  const hits = available.filter((c) => {
    const label = c.label.toLocaleLowerCase();
    return words.every((w) => label.includes(w));
  });
  const starts = (c: Command) => (c.label.toLocaleLowerCase().startsWith(q) ? 0 : 1);
  return hits.map((c, i) => ({ c, i })).sort((a, b) => starts(a.c) - starts(b.c) || a.i - b.i).map((x) => x.c);
}
