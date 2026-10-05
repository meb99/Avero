import { useEffect, useRef, useState } from "react";
import { askConfirm, askText } from "./Ask";
import type { BoardModel } from "../core/board";
import { findPoint, pointLabel, pointOf } from "../core/points";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { QUANTITIES, type Quantity } from "../workbench/measure";
import {
  activeCase,
  addList,
  listProgress,
  removeList,
  setValue,
  updateList,
  type BoardNotes,
  type ListItem,
  setPointValue,
} from "../workbench/notes";
import { ValueInput } from "./MeasureBlock";

interface Props {
  model: BoardModel;
  notes: BoardNotes;
  update(change: (n: BoardNotes) => BoardNotes): void;
  selection: Selection;
  onSelect(selection: Selection, zoom: boolean): void;
  /** Puts the cursor into the field of a list point (next point by key or pedal). */
  focus?: { listId: string; index: number; n: number } | null;
}

const SHORT: Record<Quantity, string> = { diode: "D", voltage: "U", resistance: "R" };

/**
 * Lists of points to measure one after the other: progress for the active
 * repair case, the value right in the list, and a jump to the next open point.
 */
export function MeasureLists({ model, notes, update, selection, onSelect, focus }: Props) {
  const { t } = useI18n();
  const lists = notes.lists ?? [];
  const chosen = notes.activeList ?? null;
  const setChosen = (id: string) => update((n) => ({ ...n, activeList: id }));
  const list = lists.find((l) => l.id === chosen) ?? lists[0];
  const [quantity, setQuantity] = useState<Quantity>("diode");
  const tableRef = useRef<HTMLTableElement>(null);
  const current = activeCase(notes);
  const target = current ? { caseId: current.id } : ("reference" as const);
  const readings = current?.readings ?? notes.reference;

  const selectedNet = model.selectedNet(selection);
  const selectedPoint = pointOf(model, selection);
  const pointReadings = (current ? current.points : notes.referencePoints) ?? {};
  const where = (item: ListItem): Selection | undefined => {
    if (item.point) return findPoint(model, item.point);
    const net = model.findNet(item.net);
    return net === undefined ? undefined : { kind: "net", net };
  };
  const selectedPart = model.selectedPart(selection);
  const add = (items: ListItem[]) => {
    if (items.length === 0) return;
    if (list) update((n) => updateList(n, list.id, (l) => ({ ...l, items: [...l.items, ...items] })));
    else update((n) => addList(n, t("lists.default", { n: lists.length + 1 }), items));
  };
  const partNets = (part: number): ListItem[] => {
    const p = model.parts[part];
    const nets = new Set<number>();
    for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) {
      const net = model.pins[i].net;
      if (model.nets[net].kind !== "ground" && model.nets[net].kind !== "unconnected") nets.add(net);
    }
    return [...nets].map((net) => ({ net: model.nets[net].name, quantity, label: p.name }));
  };

  const progress = list ? listProgress(notes, list) : null;
  useEffect(() => {
    if (!focus || !list || focus.listId !== list.id) return;
    requestAnimationFrame(() => tableRef.current?.querySelectorAll<HTMLInputElement>("input.value-input")[focus.index]?.focus());
    // A new request (n) only.
  }, [focus?.n]);
  const next = () => {
    if (!list || !progress) return;
    const i = progress.done.indexOf(false);
    if (i < 0) return;
    const at = where(list.items[i]);
    if (at) onSelect(at, true);
    // The value field of that point, ready for typing.
    requestAnimationFrame(() => tableRef.current?.querySelectorAll<HTMLInputElement>("input.value-input")[i]?.focus());
  };

  return (
    <section className="wb-section measure-lists">
      <div className="wb-row wb-head">
        <h3>{t("lists.title")}</h3>
        <button className="small" onClick={() => update((n) => addList(n, t("lists.default", { n: lists.length + 1 })))}>
          + {t("lists.new")}
        </button>
      </div>
      {lists.length === 0 && <p className="muted">{t("lists.empty")}</p>}
      {list && progress && (
        <>
          <div className="wb-row">
            <select value={list.id} onChange={(e) => setChosen(e.target.value)} aria-label={t("lists.title")}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
            <button
              className="small"
              onClick={async () => {
                const title = await askText(t("lists.rename"), list.title);
                if (title?.trim()) update((n) => updateList(n, list.id, (l) => ({ ...l, title: title.trim() })));
              }}
            >
              {t("measure.rename")}
            </button>
            <button className="small danger" onClick={async () => (await askConfirm(t("lists.deleteAsk", { title: list.title }), { danger: true, ok: t("lists.delete") })) && update((n) => removeList(n, list.id))}>
              {t("lists.delete")}
            </button>
          </div>
          <div className="list-progress">
            <progress value={progress.count} max={Math.max(1, list.items.length)} />
            <span>{t("lists.progress", { n: progress.count, m: list.items.length })}</span>
            <button className="small primary" disabled={progress.count >= list.items.length} onClick={next} title={t("lists.nextHint")}>
              {t("lists.next")}
            </button>
          </div>
          <table className="wb-table list-table" ref={tableRef}>
            <tbody>
              {list.items.map((item, i) => {
                const at = where(item);
                return (
                  <tr key={`${item.point ?? item.net}|${item.quantity}`} className={at === undefined ? "missing" : undefined}>
                    <td className={progress.done[i] ? "list-done" : "list-open"}>{progress.done[i] ? "✓" : "○"}</td>
                    <td>
                      <button className="link mono" onClick={() => at && onSelect(at, true)}>
                        {item.point ? pointLabel(model, item.point) : item.net}
                      </button>
                      {item.point && <div className="muted list-label">{item.net}</div>}
                      {item.label && <div className="muted list-label">{item.label}</div>}
                    </td>
                    <td className="muted">{SHORT[item.quantity]}</td>
                    <td>
                      <ValueInput
                        value={item.point ? pointReadings[item.point]?.[item.quantity] : readings[item.net]?.[item.quantity]}
                        quantity={item.quantity}
                        label={`${item.point ? pointLabel(model, item.point) : item.net} · ${t(`measure.${item.quantity}`)}`}
                        bind={`${notes.key}|list|${item.point ?? item.net}|${item.quantity}`}
                        onChange={(v) =>
                          update((n) =>
                            n.key !== notes.key
                              ? n
                              : item.point
                                ? setPointValue(n, target, item.point, item.net, item.quantity, v)
                                : setValue(n, target, item.net, item.quantity, v),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="tool icon-only"
                        title={t("lists.remove")}
                        aria-label={t("lists.remove")}
                        onClick={() => update((n) => updateList(n, list.id, (l) => ({ ...l, items: l.items.filter((_, k) => k !== i) })))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <div className="wb-row list-add">
        <select value={quantity} onChange={(e) => setQuantity(e.target.value as Quantity)} aria-label={t("lists.quantity")}>
          {QUANTITIES.map((q) => (
            <option key={q} value={q}>
              {t(`measure.${q}`)}
            </option>
          ))}
        </select>
        <button className="small" disabled={selectedNet === undefined} onClick={() => selectedNet !== undefined && add([{ net: model.nets[selectedNet].name, quantity }])}>
          + {t("lists.addNet")}
        </button>
        {selectedPoint && model.nets[selectedPoint.net].kind !== "unconnected" && (
          <button
            className="small"
            onClick={() => add([{ net: model.nets[selectedPoint.net].name, quantity, point: selectedPoint.id }])}
            title={t("lists.addPointHint")}
          >
            + {t("lists.addPoint", { point: selectedPoint.label })}
          </button>
        )}
        <button className="small" disabled={selectedPart === undefined} onClick={() => selectedPart !== undefined && add(partNets(selectedPart))}>
          + {selectedPart !== undefined ? t("lists.addPart", { part: model.parts[selectedPart].name }) : t("lists.addPartNone")}
        </button>
      </div>
    </section>
  );
}
