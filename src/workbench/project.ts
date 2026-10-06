/**
 * A device made of several boards (main board, HDMI or USB board, power
 * supply, dock, controller) joined by connectors and cables. Each board
 * keeps its own file and notes; the project only says which connector pin
 * meets which, pin by pin. Nets of the same name on two boards are never
 * joined by their name, only through a stated connection.
 */

export interface ProjectBoard {
  id: string;
  /** What the board is in the device, e.g. "Main board", "HDMI board". */
  name: string;
  path: string;
  revision?: string;
}

/** How the pins of two connectors meet. */
export type PinMapping =
  /** Pin n to pin n. */
  | { kind: "straight" }
  /** Pin n to pin count + 1 − n (a flat cable turned over). */
  | { kind: "reversed"; count: number }
  /** Stated pin by pin: "1" → "40", "A2" → "B11". */
  | { kind: "pins"; pairs: [string, string][] };

/** Two connectors joined, directly or through a cable. */
export interface ConnectorLink {
  id: string;
  a: { board: string; part: string };
  b: { board: string; part: string };
  mapping: PinMapping;
  /** The cable between, e.g. "FFC 40 pin, 0.5 mm". */
  cable?: string;
  /** How the connector is seen and where pin 1 is ("from the top, pin 1 at the notch"). */
  orientation?: string;
  note?: string;
}

export interface DeviceProject {
  id: string;
  name: string;
  boards: ProjectBoard[];
  links: ConnectorLink[];
}

/** The pin at the other end of a link, for a pin of one of its connectors. */
export function otherEnd(link: ConnectorLink, board: string, part: string, pin: string): { board: string; part: string; pin: string } | undefined {
  const fromA = link.a.board === board && link.a.part.toUpperCase() === part.toUpperCase();
  const fromB = link.b.board === board && link.b.part.toUpperCase() === part.toUpperCase();
  if (!fromA && !fromB) return undefined;
  const to = fromA ? link.b : link.a;
  const mapped = mapPin(link.mapping, pin, fromA);
  return mapped === undefined ? undefined : { board: to.board, part: to.part, pin: mapped };
}

/** A pin through the mapping, from side a to b (`forward`) or back. */
export function mapPin(mapping: PinMapping, pin: string, forward: boolean): string | undefined {
  switch (mapping.kind) {
    case "straight":
      return pin;
    case "reversed": {
      const n = Number(pin);
      if (!Number.isInteger(n) || n < 1 || n > mapping.count) return undefined;
      return String(mapping.count + 1 - n);
    }
    case "pins": {
      const key = pin.toUpperCase();
      const pair = mapping.pairs.find(([a, b]) => (forward ? a : b).toUpperCase() === key);
      return pair ? (forward ? pair[1] : pair[0]) : undefined;
    }
  }
}

/** Every place a board's connector pin continues to, through all links of the project. */
export function continuations(project: DeviceProject, board: string, part: string, pin: string) {
  return project.links.flatMap((link) => {
    const end = otherEnd(link, board, part, pin);
    return end ? [{ link, ...end }] : [];
  });
}

/** Reads "1=40, 2=39" or one pair per line into pin pairs; `undefined` when a pair is malformed. */
export function parsePairs(text: string): [string, string][] | undefined {
  const out: [string, string][] = [];
  for (const item of text.split(/[,;\n]+/)) {
    const t = item.trim();
    if (!t) continue;
    const m = /^([A-Za-z0-9_.+-]+)\s*(?:=|->|→|:)\s*([A-Za-z0-9_.+-]+)$/.exec(t);
    if (!m) return undefined;
    out.push([m[1], m[2]]);
  }
  return out.length ? out : undefined;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseMapping(v: unknown): PinMapping | undefined {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  if (m.kind === "straight") return { kind: "straight" };
  if (m.kind === "reversed" && Number.isInteger(m.count) && (m.count as number) > 0) return { kind: "reversed", count: m.count as number };
  if (m.kind === "pins" && Array.isArray(m.pairs)) {
    const pairs = m.pairs.filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && str(p[0]) && str(p[1]));
    return pairs.length ? { kind: "pins", pairs } : undefined;
  }
  return undefined;
}

/** Stored projects, checked; links to boards that are not in the project are dropped. */
export function parseProjects(value: unknown): DeviceProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((p): DeviceProject[] => {
    if (!p || typeof p !== "object") return [];
    const d = p as Record<string, unknown>;
    if (!str(d.id) || !str(d.name) || !Array.isArray(d.boards)) return [];
    const boards = d.boards.flatMap((b): ProjectBoard[] => {
      const x = b as Record<string, unknown>;
      return x && str(x.id) && str(x.name) && str(x.path) ? [{ id: x.id, name: x.name, path: x.path, ...(str(x.revision) && { revision: x.revision }) }] : [];
    });
    const ids = new Set(boards.map((b) => b.id));
    const links = (Array.isArray(d.links) ? d.links : []).flatMap((l): ConnectorLink[] => {
      const x = l as Record<string, unknown>;
      const end = (e: unknown) => {
        const v = e as Record<string, unknown> | undefined;
        return v && str(v.board) && str(v.part) && ids.has(v.board) ? { board: v.board, part: v.part } : undefined;
      };
      const a = end(x?.a);
      const b = end(x?.b);
      const mapping = parseMapping(x?.mapping);
      if (!x || !str(x.id) || !a || !b || !mapping) return [];
      return [
        {
          id: x.id,
          a,
          b,
          mapping,
          ...(str(x.cable) && { cable: x.cable }),
          ...(str(x.orientation) && { orientation: x.orientation }),
          ...(str(x.note) && { note: x.note }),
        },
      ];
    });
    return [{ id: d.id, name: d.name, boards, links }];
  });
}

/** The project a board file belongs to, and its id there. */
export function projectOf(projects: DeviceProject[], path: string | undefined): { project: DeviceProject; board: ProjectBoard } | undefined {
  if (!path) return undefined;
  for (const project of projects) {
    const board = project.boards.find((b) => b.path === path);
    if (board) return { project, board };
  }
  return undefined;
}

export const newProjectId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
