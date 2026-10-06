/**
 * Function groups: the parts that belong to one interface or function,
 * kept with the board's notes. For a found interface (HDMI, USB-C) they
 * record which of the suggested parts were confirmed or rejected and which
 * were added by hand; own groups ("Audio-Codec", "Lüfter") are any parts
 * gathered under a name.
 */
import type { BoardModel } from "../core/board";
import type { InterfaceKind, InterfaceView, MemberRole } from "../core/interfaces";

export type MemberState = "confirmed" | "rejected";

export interface GroupMember {
  part: string;
  role: MemberRole;
  state: MemberState;
}

export interface FunctionGroup {
  id: string;
  name: string;
  kind: InterfaceKind | "own";
  /** The connector of an interface group (by part name). */
  connector?: string;
  members: GroupMember[];
  /** What the confirmation rests on ("Schaltplan S. 52"). */
  source?: string;
  updated: string;
}

/** A part of an interface as shown: suggested by the copper, confirmed, rejected, or added by hand. */
export interface ShownMember {
  part: number;
  role: MemberRole;
  fns: string[];
  state: "suggested" | MemberState | "added";
}

let counter = 0;
const newId = () => `g${Date.now().toString(36)}${(counter++).toString(36)}`;
const now = () => new Date().toISOString();

/** The saved group of an interface (same kind and connector). */
export function groupOf(groups: readonly FunctionGroup[] | undefined, kind: InterfaceKind, connector: string): FunctionGroup | undefined {
  return groups?.find((g) => g.kind === kind && g.connector?.toUpperCase() === connector.toUpperCase());
}

/** The interface's parts with what was confirmed, rejected and added. */
export function shownMembers(model: BoardModel, view: InterfaceView, group: FunctionGroup | undefined): ShownMember[] {
  const saved = new Map((group?.members ?? []).map((m) => [m.part.toUpperCase(), m]));
  const out: ShownMember[] = view.members.map((m) => {
    const s = saved.get(model.parts[m.part].name.toUpperCase());
    return { part: m.part, role: s?.role ?? m.role, fns: m.fns, state: s?.state ?? "suggested" };
  });
  const found = new Set(view.members.map((m) => m.part));
  for (const m of group?.members ?? []) {
    const part = model.findPart(m.part);
    if (part === undefined || found.has(part) || m.state !== "confirmed") continue;
    out.push({ part, role: m.role, fns: [], state: "added" });
  }
  return out;
}

/** The group of an interface, made when it is first needed. */
function withInterfaceGroup(groups: FunctionGroup[] | undefined, kind: InterfaceKind, connector: string, change: (g: FunctionGroup) => FunctionGroup): FunctionGroup[] {
  const list = groups ?? [];
  const old = groupOf(list, kind, connector);
  const base: FunctionGroup = old ?? { id: newId(), name: `${kind === "hdmi" ? "HDMI" : "USB-C"} ${connector}`, kind, connector, members: [], updated: now() };
  const next = { ...change(base), updated: now() };
  return old ? list.map((g) => (g === old ? next : g)) : [...list, next];
}

/** Confirms or rejects one part of an interface (or, with `undefined`, takes the mark back). */
export function setMemberState(
  groups: FunctionGroup[] | undefined,
  kind: InterfaceKind,
  connector: string,
  member: { part: string; role: MemberRole },
  state: MemberState | undefined,
): FunctionGroup[] {
  return withInterfaceGroup(groups, kind, connector, (g) => {
    const others = g.members.filter((m) => m.part.toUpperCase() !== member.part.toUpperCase());
    return { ...g, members: state ? [...others, { ...member, state }] : others };
  });
}

/** Confirms every part still only suggested, with the source the confirmation rests on. */
export function confirmAll(groups: FunctionGroup[] | undefined, kind: InterfaceKind, connector: string, members: { part: string; role: MemberRole }[], source: string): FunctionGroup[] {
  return withInterfaceGroup(groups, kind, connector, (g) => {
    const known = new Set(g.members.map((m) => m.part.toUpperCase()));
    const added = members.filter((m) => !known.has(m.part.toUpperCase())).map((m) => ({ ...m, state: "confirmed" as const }));
    return { ...g, members: [...g.members, ...added], ...(source && { source }) };
  });
}

/** Saves parts as an own group under a name. */
export function addOwnGroup(groups: FunctionGroup[] | undefined, name: string, parts: { part: string; role: MemberRole }[], source?: string): FunctionGroup[] {
  const g: FunctionGroup = {
    id: newId(),
    name,
    kind: "own",
    members: parts.map((p) => ({ ...p, state: "confirmed" })),
    ...(source && { source }),
    updated: now(),
  };
  return [...(groups ?? []), g];
}

export function removeGroup(groups: FunctionGroup[] | undefined, id: string): FunctionGroup[] {
  return (groups ?? []).filter((g) => g.id !== id);
}

export function renameGroup(groups: FunctionGroup[] | undefined, id: string, name: string): FunctionGroup[] {
  return (groups ?? []).map((g) => (g.id === id ? { ...g, name, updated: now() } : g));
}

const ROLES: MemberRole[] = ["protection", "filter", "series", "pull", "switch", "ic", "other"];

export function parseGroups(value: unknown): FunctionGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.flatMap((g): FunctionGroup[] => {
    if (!g || typeof g !== "object") return [];
    const o = g as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") return [];
    const kind = o.kind === "hdmi" || o.kind === "usbc" || o.kind === "own" ? o.kind : undefined;
    if (!kind) return [];
    const members = Array.isArray(o.members)
      ? o.members.flatMap((m): GroupMember[] => {
          if (!m || typeof m !== "object") return [];
          const x = m as Record<string, unknown>;
          if (typeof x.part !== "string" || !ROLES.includes(x.role as MemberRole)) return [];
          if (x.state !== "confirmed" && x.state !== "rejected") return [];
          return [{ part: x.part, role: x.role as MemberRole, state: x.state }];
        })
      : [];
    return [
      {
        id: o.id,
        name: o.name,
        kind,
        ...(typeof o.connector === "string" && { connector: o.connector }),
        members,
        ...(typeof o.source === "string" && o.source && { source: o.source }),
        updated: typeof o.updated === "string" ? o.updated : now(),
      },
    ];
  });
  return out.length ? out : undefined;
}
