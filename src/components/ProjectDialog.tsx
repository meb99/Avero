import { useState } from "react";
import { useI18n } from "../i18n";
import { newProjectId, parsePairs, type ConnectorLink, type DeviceProject, type PinMapping, type ProjectBoard } from "../workbench/project";
import { askText } from "./Ask";
import { Dialog } from "./Dialogs";

export interface OpenBoard {
  path: string;
  name: string;
  /** Connectors (and other parts) of the board, when it is open. */
  parts?: string[];
}

interface Props {
  projects: DeviceProject[];
  /** The board shown now. */
  current?: OpenBoard;
  /** Boards open in tabs. */
  open: OpenBoard[];
  onChange(projects: DeviceProject[]): void;
  onOpenBoard(path: string): void;
  onPickFile(): Promise<string | undefined>;
  onClose(): void;
}

const fileName = (p: string) => p.split("/").pop() ?? p;

function mappingText(m: PinMapping, t: ReturnType<typeof useI18n>["t"]): string {
  if (m.kind === "straight") return t("project.straight");
  if (m.kind === "reversed") return t("project.reversed", { n: m.count });
  return t("project.pairs", { n: m.pairs.length });
}

/**
 * A device of several boards: which boards belong to it (each keeps its
 * own file and notes) and which connectors meet, pin by pin, directly or
 * through a cable.
 */
export function ProjectDialog({ projects, current, open, onChange, onOpenBoard, onPickFile, onClose }: Props) {
  const { t } = useI18n();
  const mine = current ? projects.find((p) => p.boards.some((b) => b.path === current.path)) : undefined;
  const [chosen, setChosen] = useState<string | null>(mine?.id ?? projects[0]?.id ?? null);
  const project = projects.find((p) => p.id === chosen);
  const replace = (next: DeviceProject) => onChange(projects.map((p) => (p.id === next.id ? next : p)));

  const create = async () => {
    const name = await askText(t("project.nameAsk"), "", { title: t("project.new") });
    if (!name?.trim()) return;
    const boards: ProjectBoard[] = current ? [{ id: newProjectId(), name: t("project.mainBoard"), path: current.path }] : [];
    const p: DeviceProject = { id: newProjectId(), name: name.trim(), boards, links: [] };
    onChange([...projects, p]);
    setChosen(p.id);
  };

  const addBoard = async (path: string) => {
    if (!project || project.boards.some((b) => b.path === path)) return;
    const name = await askText(t("project.boardNameAsk", { file: fileName(path) }), fileName(path).replace(/\.[^.]+$/, ""), { title: t("project.addBoard") });
    if (!name?.trim()) return;
    replace({ ...project, boards: [...project.boards, { id: newProjectId(), name: name.trim(), path }] });
  };

  return (
    <Dialog title={t("project.title")} onClose={onClose} className="project-dialog">
      <p className="muted">{t("project.hint")}</p>
      <div className="wb-row">
        {projects.length > 0 && (
          <select value={chosen ?? ""} onChange={(e) => setChosen(e.target.value)} aria-label={t("project.title")}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="small" onClick={() => void create()}>
          {t("project.new")}
        </button>
        {project && (
          <button
            className="small danger"
            onClick={() => {
              onChange(projects.filter((p) => p.id !== project.id));
              setChosen(null);
            }}
          >
            {t("project.delete")}
          </button>
        )}
      </div>

      {project && (
        <>
          <h3>{t("project.boards")}</h3>
          <table className="wb-table project-boards">
            <tbody>
              {project.boards.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.name}</strong>
                    <div className="muted" title={b.path}>
                      {fileName(b.path)}
                    </div>
                  </td>
                  <td>
                    <input
                      className="note-input"
                      defaultValue={b.revision ?? ""}
                      placeholder={t("project.revision")}
                      onBlur={(e) =>
                        replace({ ...project, boards: project.boards.map((x) => (x.id === b.id ? { ...x, revision: e.target.value.trim() || undefined } : x)) })
                      }
                    />
                  </td>
                  <td className="mapping-actions">
                    <button className="small" onClick={() => onOpenBoard(b.path)}>
                      {t("project.open")}
                    </button>
                    <button
                      className="tool icon-only danger"
                      aria-label={t("project.removeBoard")}
                      title={t("project.removeBoard")}
                      onClick={() =>
                        replace({
                          ...project,
                          boards: project.boards.filter((x) => x.id !== b.id),
                          links: project.links.filter((l) => l.a.board !== b.id && l.b.board !== b.id),
                        })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="wb-row">
            {open.filter((o) => !project.boards.some((b) => b.path === o.path)).length > 0 && (
              <select
                value=""
                onChange={(e) => e.target.value && void addBoard(e.target.value)}
                aria-label={t("project.addOpen")}
              >
                <option value="">{t("project.addOpen")}</option>
                {open
                  .filter((o) => !project.boards.some((b) => b.path === o.path))
                  .map((o) => (
                    <option key={o.path} value={o.path}>
                      {o.name}
                    </option>
                  ))}
              </select>
            )}
            <button
              className="small"
              onClick={async () => {
                const path = await onPickFile();
                if (path) await addBoard(path);
              }}
            >
              {t("project.addFile")}
            </button>
          </div>

          <h3>{t("project.links")}</h3>
          {project.links.length === 0 && <p className="muted">{t("project.noLinks")}</p>}
          <ul className="marker-list">
            {project.links.map((l) => {
              const name = (id: string) => project.boards.find((b) => b.id === id)?.name ?? "?";
              return (
                <li key={l.id}>
                  <span>
                    <strong>
                      {name(l.a.board)} {l.a.part}
                    </strong>{" "}
                    ⇄{" "}
                    <strong>
                      {name(l.b.board)} {l.b.part}
                    </strong>
                  </span>
                  <span className="muted">
                    {" "}
                    · {mappingText(l.mapping, t)}
                    {l.cable && ` · ${l.cable}`}
                    {l.orientation && ` · ${l.orientation}`}
                  </span>
                  <button
                    className="tool icon-only danger"
                    aria-label={t("project.removeLink")}
                    title={t("project.removeLink")}
                    onClick={() => replace({ ...project, links: project.links.filter((x) => x.id !== l.id) })}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          {project.boards.length >= 2 && <LinkForm project={project} open={open} onAdd={(link) => replace({ ...project, links: [...project.links, link] })} />}
        </>
      )}
    </Dialog>
  );
}

/** A new connection: two boards' connectors, how their pins meet, the cable. */
function LinkForm({ project, open, onAdd }: { project: DeviceProject; open: OpenBoard[]; onAdd(link: ConnectorLink): void }) {
  const { t } = useI18n();
  const [a, setA] = useState({ board: project.boards[0].id, part: "" });
  const [b, setB] = useState({ board: project.boards[1].id, part: "" });
  const [kind, setKind] = useState<PinMapping["kind"]>("straight");
  const [count, setCount] = useState("40");
  const [pairs, setPairs] = useState("");
  const [cable, setCable] = useState("");
  const [orientation, setOrientation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const partsOf = (board: string) => {
    const path = project.boards.find((x) => x.id === board)?.path;
    const parts = open.find((o) => o.path === path)?.parts ?? [];
    // Connectors first: J, CN, CON, P, FPC …
    return [...new Set(parts)].sort((x, y) => Number(!/^(J|CN|CON|FPC|FFC|P)\d/i.test(x)) - Number(!/^(J|CN|CON|FPC|FFC|P)\d/i.test(y)) || x.localeCompare(y, undefined, { numeric: true }));
  };
  const end = (value: { board: string; part: string }, set: (v: { board: string; part: string }) => void, label: string, listId: string) => (
    <div className="project-end">
      <span className="muted">{label}</span>
      <select value={value.board} onChange={(e) => set({ ...value, board: e.target.value })}>
        {project.boards.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <input value={value.part} list={listId} placeholder="J3" onChange={(e) => set({ ...value, part: e.target.value.trim() })} />
      <datalist id={listId}>
        {partsOf(value.board)
          .slice(0, 400)
          .map((p) => (
            <option key={p} value={p} />
          ))}
      </datalist>
    </div>
  );
  const add = () => {
    if (!a.part || !b.part) return setError(t("project.needParts"));
    if (a.board === b.board && a.part.toUpperCase() === b.part.toUpperCase()) return setError(t("project.samePart"));
    let mapping: PinMapping;
    if (kind === "straight") mapping = { kind };
    else if (kind === "reversed") {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 2) return setError(t("project.badCount"));
      mapping = { kind, count: n };
    } else {
      const p = parsePairs(pairs);
      if (!p) return setError(t("project.badPairs"));
      mapping = { kind, pairs: p };
    }
    onAdd({ id: newProjectId(), a, b, mapping, ...(cable.trim() && { cable: cable.trim() }), ...(orientation.trim() && { orientation: orientation.trim() }) });
    setError(null);
    setA({ ...a, part: "" });
    setB({ ...b, part: "" });
  };
  return (
    <div className="project-link-form">
      <h4>{t("project.addLink")}</h4>
      {end(a, setA, t("project.from"), "project-parts-a")}
      {end(b, setB, t("project.to"), "project-parts-b")}
      <div className="project-end">
        <span className="muted">{t("project.mapping")}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as PinMapping["kind"])}>
          <option value="straight">{t("project.straight")}</option>
          <option value="reversed">{t("project.reversedPick")}</option>
          <option value="pins">{t("project.pairsPick")}</option>
        </select>
        {kind === "reversed" && <input value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value)} aria-label={t("project.count")} />}
      </div>
      {kind === "pins" && <textarea className="notes-field" value={pairs} placeholder="1=40, 2=39, A2=B11" onChange={(e) => setPairs(e.target.value)} />}
      <div className="project-end">
        <input value={cable} placeholder={t("project.cable")} onChange={(e) => setCable(e.target.value)} />
        <input value={orientation} placeholder={t("project.orientation")} onChange={(e) => setOrientation(e.target.value)} />
      </div>
      {error && <p className="wb-error">{error}</p>}
      <button className="small primary" onClick={add}>
        {t("project.addLinkButton")}
      </button>
    </div>
  );
}
