import { useMemo, useState } from "react";
import type { BoardModel } from "../core/board";
import { findInterfaces, type InterfaceView, type MemberRole } from "../core/interfaces";
import type { Selection } from "../core/types";
import { useI18n, type MessageKey } from "../i18n";
import { addOwnGroup, confirmAll, groupOf, removeGroup, renameGroup, setMemberState, shownMembers, type FunctionGroup, type ShownMember } from "../workbench/groups";
import type { BoardNotes } from "../workbench/notes";
import { askConfirm, askText } from "./Ask";

interface Props {
  model: BoardModel;
  notes: BoardNotes | null;
  update?(change: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
  marked: { parts: number[]; label: string } | null;
  onMarkParts(parts: number[] | null, label?: string): void;
  /** Parts chosen together, for an own group. */
  multiParts: readonly number[];
}

const ROLES: MemberRole[] = ["protection", "filter", "series", "pull", "switch", "ic", "other"];

/**
 * The board's interfaces (HDMI, USB-C) each as one view: the connector's
 * pins by function and the parts on their way – protection, filters, series
 * parts and the chips – suggested from the copper, to be confirmed or
 * rejected part by part; plus own groups of parts under a name.
 */
export function Interfaces({ model, notes, update, onSelect, marked, onMarkParts, multiParts }: Props) {
  const { t } = useI18n();
  const views = useMemo(() => findInterfaces(model), [model]);
  const groups = notes?.groups;
  const own = (groups ?? []).filter((g) => g.kind === "own");
  if (views.length === 0 && own.length === 0 && !(update && multiParts.length)) return null;

  const setGroups = (change: (g: FunctionGroup[] | undefined) => FunctionGroup[]) => update?.((n) => ({ ...n, groups: change(n.groups) }));
  const partsOf = (g: FunctionGroup) => g.members.flatMap((m) => {
    const p = model.findPart(m.part);
    return p === undefined || m.state === "rejected" ? [] : [p];
  });

  return (
    <details className="interfaces">
      <summary>
        {t("if.title")} <span className="muted">{t("if.count", { n: views.length })}</span>
      </summary>
      <p className="muted pt-hint">{t("if.hint")}</p>
      {views.map((v) => (
        <InterfaceBlock
          key={v.connector}
          model={model}
          view={v}
          group={groupOf(groups, v.kind, model.parts[v.connector].name)}
          editable={!!update}
          onSelect={onSelect}
          marked={marked}
          onMarkParts={onMarkParts}
          setGroups={setGroups}
        />
      ))}

      <h4 className="if-own-title">{t("if.own")}</h4>
      {own.length === 0 && <p className="muted pt-hint">{t("if.ownNone")}</p>}
      <ul className="if-own">
        {own.map((g) => {
          const parts = partsOf(g);
          const label = `${t("if.group")}: ${g.name}`;
          return (
            <li key={g.id}>
              <strong>{g.name}</strong> <span className="muted">{t("if.parts", { n: parts.length })}</span>
              <div className="if-chips">
                {parts.slice(0, 60).map((p) => (
                  <button key={p} className="if-part if-confirmed" onClick={() => onSelect({ kind: "part", part: p }, true)}>
                    {model.parts[p].name}
                  </button>
                ))}
              </div>
              <div className="wb-row">
                <button className="small" onClick={() => onMarkParts(marked?.label === label ? null : parts, label)}>
                  {marked?.label === label ? t("if.unmark") : t("if.mark")}
                </button>
                {update && (
                  <>
                    <button
                      className="small"
                      onClick={async () => {
                        const name = await askText(t("if.renameAsk"), g.name, { title: t("if.rename") });
                        if (name?.trim()) setGroups((all) => renameGroup(all, g.id, name.trim()));
                      }}
                    >
                      {t("if.rename")}
                    </button>
                    <button
                      className="small danger"
                      onClick={async () => {
                        if (await askConfirm(t("if.deleteAsk", { name: g.name }), { danger: true })) setGroups((all) => removeGroup(all, g.id));
                      }}
                    >
                      {t("if.delete")}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {update && (
        <button
          className="small"
          disabled={multiParts.length === 0}
          title={multiParts.length ? undefined : t("if.fromSelectionHint")}
          onClick={async () => {
            const name = await askText(t("if.nameAsk", { n: multiParts.length }), "", { title: t("if.fromSelection") });
            if (!name?.trim()) return;
            setGroups((all) => addOwnGroup(all, name.trim(), multiParts.map((p) => ({ part: model.parts[p].name, role: "other" as const }))));
          }}
        >
          {t("if.fromSelection")} {multiParts.length > 0 && `(${multiParts.length})`}
        </button>
      )}
    </details>
  );
}

function InterfaceBlock({
  model,
  view,
  group,
  editable,
  onSelect,
  marked,
  onMarkParts,
  setGroups,
}: {
  model: BoardModel;
  view: InterfaceView;
  group: FunctionGroup | undefined;
  editable: boolean;
  onSelect(selection: Selection, zoom: boolean): void;
  marked: { parts: number[]; label: string } | null;
  onMarkParts(parts: number[] | null, label?: string): void;
  setGroups(change: (g: FunctionGroup[] | undefined) => FunctionGroup[]): void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState("");
  const [addRole, setAddRole] = useState<MemberRole>("protection");
  const [showRejected, setShowRejected] = useState(false);
  const connector = model.parts[view.connector].name;
  const kindLabel = view.kind === "hdmi" ? "HDMI" : "USB-C";
  const members = shownMembers(model, view, group);
  const byPart = new Map(members.map((m) => [m.part, m]));
  const kept = members.filter((m) => m.state !== "rejected");
  const confirmed = members.filter((m) => m.state === "confirmed" || m.state === "added").length;
  const label = `${kindLabel} ${connector}`;
  const name = (p: number) => model.parts[p].name;
  const mark = (m: ShownMember, state: "confirmed" | "rejected" | undefined) =>
    setGroups((all) => setMemberState(all, view.kind, connector, { part: name(m.part), role: m.role }, state));

  const chip = (p: number) => {
    const m = byPart.get(p);
    if (!m || (m.state === "rejected" && !showRejected)) return null;
    return (
      <button
        key={p}
        className={`if-part if-${m.state} if-role-${m.role}`}
        title={`${t(`if.role.${m.role}` as MessageKey)} · ${t(`if.state.${m.state}` as MessageKey)}${model.parts[p].device ? ` · ${model.parts[p].device}` : ""}`}
        onClick={() => onSelect({ kind: "part", part: p }, true)}
      >
        {name(p)}
      </button>
    );
  };

  return (
    <details className="if-block">
      <summary>
        <strong>{kindLabel}</strong> {connector} <span className="muted">{t("if.summary", { n: kept.length, confirmed })}</span>
      </summary>
      <div className="wb-row">
        <button className="small" onClick={() => onSelect({ kind: "part", part: view.connector }, true)}>
          {t("if.showConnector")}
        </button>
        <button className="small" onClick={() => onMarkParts(marked?.label === label ? null : [view.connector, ...kept.map((m) => m.part)], label)}>
          {marked?.label === label ? t("if.unmark") : t("if.mark")}
        </button>
        {editable && (
          <button
            className="small"
            disabled={members.every((m) => m.state !== "suggested")}
            onClick={async () => {
              const source = await askText(t("if.confirmAsk"), group?.source ?? "", { title: t("if.confirmAll") });
              if (source === null) return;
              setGroups((all) =>
                confirmAll(
                  all,
                  view.kind,
                  connector,
                  members.filter((m) => m.state === "suggested").map((m) => ({ part: name(m.part), role: m.role })),
                  source.trim(),
                ),
              );
            }}
          >
            {t("if.confirmAll")}
          </button>
        )}
        {editable && (
          <button
            className="small"
            onClick={async () => {
              const groupName = await askText(t("if.saveAsk"), label, { title: t("if.saveOwn") });
              if (!groupName?.trim()) return;
              setGroups((all) => addOwnGroup(all, groupName.trim(), [{ part: connector, role: "other" }, ...kept.map((m) => ({ part: name(m.part), role: m.role }))], group?.source));
            }}
          >
            {t("if.saveOwn")}
          </button>
        )}
      </div>
      {group?.source && <p className="muted pt-hint">{t("if.source", { source: group.source })}</p>}

      <table className="wb-table if-table">
        <thead>
          <tr>
            <th>{t("if.fn")}</th>
            <th>{t("details.pin")}</th>
            <th>{t("details.net")}</th>
            <th>{t("if.way")}</th>
          </tr>
        </thead>
        <tbody>
          {view.signals.map((s) => (
            <tr key={`${s.fn}|${s.net}|${s.open ? "o" : ""}`}>
              <td>
                <strong>{s.fn}</strong>
                <span className="muted if-why" title={t(`if.why.${s.why}` as MessageKey)}>
                  {s.why === "standard" ? " ⓢ" : " ⓝ"}
                </span>
              </td>
              <td className="mono">
                {s.pins.map((p, k) => (
                  <span key={p}>
                    {k > 0 && "/"}
                    <button className="link" onClick={() => onSelect({ kind: "pin", pin: p }, true)}>
                      {model.pins[p].number}
                    </button>
                  </span>
                ))}
              </td>
              <td className="mono">
                {s.open ? (
                  <span className="muted">{t("if.open")}</span>
                ) : (
                  <button className="link" onClick={() => onSelect({ kind: "net", net: s.net }, true)}>
                    {model.nets[s.net].name}
                  </button>
                )}
              </td>
              <td className="if-chips">{s.parts.map(chip)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted pt-hint">{t("if.legend")}</p>

      <div className="if-roles">
        {ROLES.map((role) => {
          const list = members.filter((m) => m.role === role && (showRejected || m.state !== "rejected"));
          if (!list.length) return null;
          return (
            <div key={role} className="if-role">
              <h5>
                {t(`if.role.${role}` as MessageKey)} <span className="muted">{list.length}</span>
              </h5>
              <ul>
                {list.map((m) => (
                  <li key={m.part} className={`if-member if-${m.state}`}>
                    <button className="link part-name" onClick={() => onSelect({ kind: "part", part: m.part }, true)}>
                      {name(m.part)}
                    </button>
                    <span className="muted"> {model.parts[m.part].device ?? ""}</span>
                    <span className={`src-tag if-tag-${m.state}`}>{t(`if.state.${m.state}` as MessageKey)}</span>
                    {editable && m.state !== "added" && (
                      <>
                        <button className="tool icon-only" aria-label={t("if.confirm")} title={t("if.confirm")} disabled={m.state === "confirmed"} onClick={() => mark(m, "confirmed")}>
                          ✓
                        </button>
                        <button className="tool icon-only" aria-label={t("if.reject")} title={t("if.reject")} disabled={m.state === "rejected"} onClick={() => mark(m, "rejected")}>
                          ✕
                        </button>
                        {m.state !== "suggested" && (
                          <button className="tool icon-only" aria-label={t("if.undo")} title={t("if.undo")} onClick={() => mark(m, undefined)}>
                            ↺
                          </button>
                        )}
                      </>
                    )}
                    {editable && m.state === "added" && (
                      <button className="tool icon-only" aria-label={t("if.remove")} title={t("if.remove")} onClick={() => mark(m, undefined)}>
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {members.some((m) => m.state === "rejected") && (
        <label className="check small-check">
          <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
          {t("if.showRejected", { n: members.filter((m) => m.state === "rejected").length })}
        </label>
      )}
      {editable && (
        <div className="wb-row if-add">
          <input value={adding} list={`if-parts-${view.connector}`} placeholder={t("if.addPlaceholder")} onChange={(e) => setAdding(e.target.value)} aria-label={t("if.add")} />
          <datalist id={`if-parts-${view.connector}`}>
            {model.parts.slice(0, 3000).map((p) => (
              <option key={p.name} value={p.name} />
            ))}
          </datalist>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as MemberRole)} aria-label={t("if.roleLabel")}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`if.role.${r}` as MessageKey)}
              </option>
            ))}
          </select>
          <button
            className="small"
            disabled={model.findPart(adding.trim()) === undefined}
            onClick={() => {
              const p = model.findPart(adding.trim());
              if (p === undefined) return;
              setGroups((all) => setMemberState(all, view.kind, connector, { part: model.parts[p].name, role: addRole }, "confirmed"));
              setAdding("");
            }}
          >
            {t("if.add")}
          </button>
        </div>
      )}
    </details>
  );
}
