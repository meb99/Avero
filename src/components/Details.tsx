import { useState, type ReactNode } from "react";
import { ShortFinder } from "./ShortFinder";
import { traceNet } from "../core/trace";
import { askConfirm } from "./Ask";
import { openUrl } from "@tauri-apps/plugin-opener";
import { chipFor, type ChipInfo, type ChipPin } from "../knowledge/chips";
import { checkPinout, type PinoutCheck } from "../knowledge/pinout";
import { netReadings, partValues, type ObdData } from "../knowledge/obdata";
import type { SchematicDocument } from "../schematic/document";
import { SchematicHits, type PartMapping } from "./SchematicHits";
import { ballGrid } from "../core/bga";
import type { SchematicFacts } from "../schematic/partInfo";
import type { RGBA } from "../render/palette";
import { visibleFrom, type BoardModel, type ViewSide } from "../core/board";
import type { NetKind, Selection, Side } from "../core/types";
import { formatLength, formatSize } from "../format";
import { useI18n, type MessageKey } from "../i18n";
import type { Settings } from "../settings";
import { activeCase, addDrawing, readingsFor, setOwnPart, setOwnPin, updateDocLinks, type BoardNotes } from "../workbench/notes";
import { OwnPartInfo, OwnPinInfo } from "./OwnInfo";
import { jumperTargets } from "../core/jumper";
import { datasheetsFor, partNumbers, type Datasheet } from "../workbench/datasheets";
import { formatValue } from "../workbench/measure";
import { MeasureBlock, NetPoints, PointMeasureBlock } from "./MeasureBlock";
import { findPoint, pinKey, pointLabel, pointOf } from "../core/points";

interface Props {
  model: BoardModel;
  selection: Selection;
  side: ViewSide;
  settings: Settings;
  notes: BoardNotes | null;
  updateNotes(change: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
  /** The board's open documents (the one shown first), for the list of occurrences. */
  documents?: SchematicDocument[];
  onSchematicJump?(text: string, hit: number, doc: SchematicDocument): void;
  /** Gives a net its own name; returns an error message or null. */
  onRenameNet?(net: number, name: string): string | null;
  /** Corrects the net's kind (undefined: back to the file's). */
  onSetNetKind?(net: number, kind: NetKind | undefined): void;
  /** Nets pinned in their own colors on the board. */
  pinnedNets?: ReadonlyMap<number, RGBA>;
  onTogglePin?(net: number): void;
  /** Pins a set of nets in their own colours (a traced signal path). */
  onPinNets?(nets: number[]): void;
  /** Parts marked on the board from here (same type, short candidates), with what they are. */
  marked?: { parts: number[]; label: string } | null;
  onMarkParts?(parts: number[] | null, label?: string): void;
  /** Known-good values of OpenBoardData for this board. */
  obdata?: ObdData | null;
  /** Values, part numbers and net voltages read from the schematic's text. */
  schematicFacts?: SchematicFacts | null;
  /** Opens the ball map of a BGA. */
  onOpenBga?(part: number): void;
  /** Looks for the part on the other boards of the library. */
  onFindDonors?(part: number): void;
  /** Stored datasheets, and opening or adding one. */
  datasheets?: readonly Datasheet[];
  onOpenDatasheet?(sheet: Datasheet, page?: number): void;
  onAddDatasheet?(part: number): void;
  onRemoveDatasheet?(sheet: Datasheet): void;
}

/** Datasheet name of a pin, its function and target value on hover. */
function PinFunction({ pin }: { pin?: ChipPin }) {
  if (!pin) return <td />;
  return (
    <td className="pin-function" title={[pin.role, pin.expect].filter(Boolean).join(" — ")}>
      {pin.name}
    </td>
  );
}

/** Labels of OpenBoardData component values. */
const OBD_PART_KINDS: Record<string, MessageKey> = {
  v: "obd.value",
  p: "obd.package",
  c: "obd.code",
  r: "obd.rating",
  m: "obd.misc",
  s: "obd.status",
};

/** What the maker's datasheet says about a known chip. */
function ChipCard({ chip, check }: { chip: ChipInfo; check: PinoutCheck | null }) {
  const { t } = useI18n();
  const pinoutNote =
    check && chip.pinout
      ? check.status === "mismatch"
        ? t(`pinout.mismatch.${check.reason ?? "pins"}`, {
            bad: check.ground.total - check.ground.ok,
            fit: check.names.fit,
            n: check.names.total,
            source: chip.pinout.source,
          })
        : t(`pinout.${check.status}`, { gOk: check.ground.ok, g: check.ground.total, fit: check.names.fit, n: check.names.total })
      : null;
  const open = () => void openUrl(chip.url).catch(() => window.open(chip.url, "_blank"));
  return (
    <section className="details-section chip-card">
      <h3>
        {chip.name} <span className="muted">· {chip.maker}</span>
      </h3>
      <p>{chip.role}</p>
      {(chip.facts.length > 0 || chip.usedIn) && (
        <dl className="props">
          {chip.facts.map(([label, value]) => (
            <Row key={label} label={label}>
              {value}
            </Row>
          ))}
          {chip.usedIn && <Row label={t("chip.usedIn")}>{chip.usedIn}</Row>}
        </dl>
      )}
      {pinoutNote && (
        <p className={`pinout-note pinout-${check!.status}`} title={chip.pinout!.source}>
          {pinoutNote}
        </p>
      )}
      <button className="small" onClick={open}>
        {t("chip.source")}
      </button>
    </section>
  );
}

/** Inline editor for a net's own name; empty gives the file name back. */
function NetRename({ current, fileName, onSave }: { current: string; fileName: string; onSave(name: string): string | null }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    if (text === null) return;
    const message = onSave(text);
    setError(message);
    if (!message) setText(null);
  };
  if (text === null)
    return (
      <div className="net-rename">
        <button className="small" onClick={() => setText(current === fileName ? "" : current)}>
          {t("details.renameNet")}
        </button>
        {current !== fileName && <span className="muted">{t("details.fileName", { name: fileName })}</span>}
      </div>
    );
  return (
    <div className="net-rename">
      <input
        autoFocus
        value={text}
        placeholder={fileName}
        aria-label={t("details.renameNet")}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setError(null);
            setText(null);
          }
        }}
      />
      <span className="muted">{t("details.renameHint")}</span>
      {error && <span className="wb-error">{error}</span>}
    </div>
  );
}

const sideKey: Record<Side, MessageKey> = { top: "side.top", bottom: "side.bottom", both: "side.both" };
const kindKey: Record<NetKind, MessageKey> = {
  signal: "kind.signal",
  power: "kind.power",
  ground: "kind.ground",
  unconnected: "kind.unconnected",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function Details({
  model,
  selection,
  side,
  settings,
  notes,
  updateNotes,
  onSelect,
  documents,
  onSchematicJump,
  onRenameNet,
  onSetNetKind,
  pinnedNets,
  onTogglePin,
  onPinNets,
  marked,
  onMarkParts,
  obdata,
  schematicFacts,
  onOpenBga,
  onFindDonors,
  datasheets,
  onOpenDatasheet,
  onAddDatasheet,
  onRemoveDatasheet,
}: Props) {
  const { t, lang } = useI18n();
  const u = settings.units;

  /**
   * Diode reading of a net for the pin table, as FlexBV shows it: from the
   * active repair case, else the reference, else OpenBoardData.
   */
  const diodeOf = (net: number): { text: string; source: string } | null => {
    const n = model.nets[net];
    if (n.kind === "unconnected") return null;
    const kase = notes ? activeCase(notes) : undefined;
    const sources: [string, BoardNotes["reference"] | undefined][] = [
      [t("measure.case"), kase && notes ? readingsFor(notes, { caseId: kase.id }) : undefined],
      [t("measure.reference"), notes?.reference],
    ];
    for (const [source, readings] of sources) {
      const d = readings?.[n.name]?.diode;
      if (d !== undefined) return { text: formatValue(d, "diode", lang), source };
    }
    if (obdata) {
      for (const name of new Set([n.name, model.fileNetName(net)])) {
        const rows = netReadings(obdata, name).rows;
        const d = rows.find((r) => r.condition === "Default" && r.d)?.d ?? rows.find((r) => r.d)?.d;
        if (d) return { text: d, source: `OpenBoardData ${obdata.id}` };
      }
    }
    return null;
  };

  const netLink = (net: number) => {
    const n = model.nets[net];
    return (
      <button className={`link net-chip kind-${n.kind}`} onClick={() => onSelect({ kind: "net", net }, true)}>
        {n.name}
      </button>
    );
  };

  /** Known-good values of the net from OpenBoardData, under its shown or its file name. */
  const obdNet = (net: number) => {
    if (!obdata || model.nets[net].kind === "unconnected") return null;
    const found = [model.nets[net].name, model.fileNetName(net)]
      .map((name) => netReadings(obdata, name))
      .find((r) => r.rows.length > 0 || r.related.length > 0);
    if (!found) return null;
    return (
      <section className="details-section obd">
        <h3>
          OpenBoardData <span className="muted">{obdata.id}</span>
        </h3>
        {found.rows.length > 0 && (
          <table className="obd-table">
            <thead>
              <tr>
                <th>{t("obd.condition")}</th>
                <th>{t("obd.diode")}</th>
                <th>{t("obd.voltage")}</th>
                <th>{t("obd.resistance")}</th>
              </tr>
            </thead>
            <tbody>
              {found.rows.flatMap((r) => [
                <tr key={r.condition}>
                  <td>{r.condition === "Default" ? t("obd.default") : r.condition}</td>
                  <td className="mono">{r.d || "–"}</td>
                  <td className="mono">{r.v || "–"}</td>
                  <td className="mono">{r.r || "–"}</td>
                </tr>,
                ...(r.notes.length
                  ? [
                      <tr key={`${r.condition}-notes`} className="obd-note">
                        <td colSpan={4}>{r.notes.join(" · ")}</td>
                      </tr>,
                    ]
                  : []),
              ])}
            </tbody>
          </table>
        )}
        {found.related.length > 0 && (
          <p className="muted">
            {t("obd.related")}{" "}
            {found.related.map((name) => {
              const other = model.findNet(name);
              return other === undefined ? (
                <span key={name}>{name} </span>
              ) : (
                <button key={name} className={`link net-chip kind-${model.nets[other].kind}`} onClick={() => onSelect({ kind: "net", net: other }, true)}>
                  {name}
                </button>
              );
            })}
          </p>
        )}
      </section>
    );
  };

  const measure = (net: number) => {
    const point = selection.kind === "pin" || selection.kind === "testPoint" ? pointOf(model, selection) : undefined;
    const usable = notes && model.nets[net].kind !== "unconnected";
    return (
      <>
        {obdNet(net)}
        {usable && point && (
          <PointMeasureBlock
            key={`point-${point.id}`}
            point={point.id}
            label={point.label}
            net={model.nets[net].name}
            notes={notes}
            update={updateNotes}
            tolerance={settings.tolerance}
          />
        )}
        {usable ? (
          <MeasureBlock
            key={model.nets[net].name}
            net={model.nets[net].name}
            notes={notes}
            update={updateNotes}
            tolerance={settings.tolerance}
            title={point ? t("point.netTitle", { net: model.nets[net].name }) : undefined}
          />
        ) : null}
        {usable && (
          <NetPoints
            net={model.nets[net].name}
            notes={notes}
            labelOf={(id) => pointLabel(model, id)}
            onPoint={(id) => {
              const sel = findPoint(model, id);
              if (sel) onSelect(sel, true);
            }}
          />
        )}
      </>
    );
  };

  const netMembers = (net: number, currentPin?: number) => {
    const n = model.nets[net];
    if (n.kind === "unconnected") return null;
    const members = model.netMembers(net);
    const series = traceNet(model, net);
    return (
      <section className="details-section">
        <h3>
          {t("details.connections")} <span className="muted">{t("details.connectionsSummary", { pins: n.pins.length, parts: members.length })}</span>
        </h3>
        <ul className="member-list">
          {members.slice(0, 400).map(({ part, pins }) => {
            const p = model.parts[part];
            const far = !visibleFrom(p.side, side);
            return (
              <li key={part} className={far ? "far" : undefined} title={far ? t("details.onOtherSide") : undefined}>
                <button className="link part-name" onClick={() => onSelect({ kind: "part", part }, true)}>
                  {p.name}
                </button>
                <span className="member-pins">
                  {pins.slice(0, 24).map((pin) => (
                    <button
                      key={pin}
                      className={`pin-chip${pin === currentPin ? " current" : ""}`}
                      onClick={() => onSelect({ kind: "pin", pin }, true)}
                    >
                      {model.pins[pin].number}
                    </button>
                  ))}
                  {pins.length > 24 && <span className="muted">+{pins.length - 24}</span>}
                </span>
                {p.device && <span className="member-device muted">{p.device}</span>}
              </li>
            );
          })}
        </ul>
        {n.testPoints.length > 0 && (
          <>
            <h3>{t("details.testPoints")}</h3>
            <div className="member-pins">
              {n.testPoints.slice(0, 60).map((tp) => {
                const point = model.testPoints[tp];
                return (
                  <button key={tp} className="pin-chip" onClick={() => onSelect({ kind: "testPoint", testPoint: tp }, true)}>
                    {point.kind === "via" ? "via" : (point.name ?? `TP${point.probe ?? ""}`)}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {onMarkParts && n.kind !== "ground" && <ShortFinder model={model} net={net} notes={notes} marked={marked ?? null} onMarkParts={onMarkParts} onSelect={onSelect} />}
        {series.length > 0 && (
          <>
            <div className="trace-head">
              <h3 title={t("trace.hint")}>
                {t("trace.title")} <span className="muted">{series.length}</span>
              </h3>
              {onPinNets && (
                <button className="small" title={t("trace.showHint")} onClick={() => onPinNets([net, ...series.slice(0, 15).map((l) => l.net)])}>
                  {t("trace.show")}
                </button>
              )}
            </div>
            <ul className="series-list trace-list">
              {series.slice(0, 80).map(({ net: other, via, kind, depth }) => (
                <li key={other} style={{ paddingLeft: `${(depth - 1) * 14}px` }}>
                  <span className={`trace-kind trace-${kind}`} title={t(`trace.kindHint.${kind}`)}>
                    {t(`trace.kind.${kind}`)}
                  </span>
                  {netLink(other)}
                  <span className="muted">{t("details.through")}</span>
                  <button className="link part-name" onClick={() => onSelect({ kind: "part", part: via }, true)}>
                    {model.parts[via].name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    );
  };

  const hits = (names: string[], part?: PartMapping) =>
    documents?.length && onSchematicJump ? <SchematicHits docs={documents} names={names} onJump={onSchematicJump} part={part} /> : null;
  /** A part's document matches with its corrections (and the selected pin), changeable when the notes are there. */
  const mapping = (name: string, pin?: PartMapping["pin"]): PartMapping | undefined =>
    notes
      ? { name, links: notes.docLinks?.[name.toUpperCase()], ...(pin && { pin }), onChange: (change) => updateNotes((n) => updateDocLinks(n, change)) }
      : undefined;

  switch (selection.kind) {
    case "none":
      return <p className="details-empty">{t("details.empty")}</p>;

    case "part": {
      const part = model.parts[selection.part];
      const chip = chipFor(part.device);
      const pinCheck = chip?.pinout ? checkPinout(model, selection.part, chip.pinout) : null;
      const obdValues = obdata ? partValues(obdata, part.name) : [];
      const b = part.bounds;
      return (
        <div className="details">
          <header className="details-head">
            <span className="details-type">{t("details.part")}</span>
            <h2>{part.name}</h2>
            {part.device && (
              <p className="details-device">
                {part.device} <span className="src-tag" title={t("own.fileHint")}>{t("own.fileTag")}</span>
              </p>
            )}
          </header>
          {part.estimated && <p className="muted estimated-note">{t("details.estimated")}</p>}
          <div className="part-actions">
            {onOpenBga && ballGrid(model, selection.part) && (
              <button className="small" onClick={() => onOpenBga(selection.part)}>
                {t("bga.open")}
              </button>
            )}
            {onFindDonors && part.device && (
              <button className="small" onClick={() => onFindDonors(selection.part)} title={t("donor.hint")}>
                {t("donor.find")}
              </button>
            )}
            {onMarkParts &&
              part.device &&
              (() => {
                const key = `same:${part.device}`;
                const same = model.parts.flatMap((p, i) => (p.device === part.device ? [i] : []));
                if (same.length < 2) return null;
                const on = marked?.label === key;
                return (
                  <button className={`small${on ? " on" : ""}`} onClick={() => onMarkParts(on ? null : same, key)} title={t("same.hint")}>
                    {t("same.mark", { n: same.length })}
                  </button>
                );
              })()}
          </div>
          {(() => {
            const f = schematicFacts?.parts.get(part.name.toUpperCase());
            if (!f) return null;
            const rows: [MessageKey, string | undefined][] = [
              ["sch.value", f.value],
              ["sch.partNumber", f.partNumber],
              ["sch.rating", f.rating],
              ["sch.tolerance", f.tolerance],
              ["sch.dielectric", f.dielectric],
              ["sch.package", f.package],
            ];
            const notFitted = f.flags.some((x) => /STUFF|DNP|NOPOP|^NI$|DNI/.test(x));
            return (
              <section className="details-section sch-facts">
                <h3>
                  {t("sch.title")} <span className="muted">{t("sch.page", { n: f.page + 1 })}</span>
                </h3>
                <dl className="props">
                  {rows.filter(([, v]) => v).map(([label, v]) => (
                    <Row key={label} label={t(label)}>
                      {v}
                    </Row>
                  ))}
                </dl>
                {f.flags.length > 0 && (
                  <p className={notFitted ? "kb-note kb-warning" : "muted"}>
                    {notFitted ? t("sch.notFitted") : ""} {f.flags.join(" · ")}
                  </p>
                )}
              </section>
            );
          })()}
          {chip && <ChipCard chip={chip} check={pinCheck} />}
          {onAddDatasheet && part.device && partNumbers(part.device).length > 0 && (
            <section className="details-section datasheets">
              <h3>{t("sheet.section")}</h3>
              {datasheetsFor(datasheets ?? [], part.device).map((s) => (
                <div key={s.id} className="sheet-row">
                  <button className="link" onClick={() => onOpenDatasheet?.(s)}>
                    {s.title}
                  </button>
                  {s.pages.map((p) => (
                    <button key={`${p.label}${p.page}`} className="small" onClick={() => onOpenDatasheet?.(s, p.page)}>
                      {p.label}
                    </button>
                  ))}
                  <button
                    className="tool icon-only"
                    title={t("sheet.remove")}
                    aria-label={t("sheet.remove")}
                    onClick={async () => (await askConfirm(t("sheet.removeAsk", { title: s.title }), { danger: true, ok: t("sheet.remove") })) && onRemoveDatasheet?.(s)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="small" onClick={() => onAddDatasheet(selection.part)}>
                + {t("sheet.add")}
              </button>
            </section>
          )}
          {notes && (
            <OwnPartInfo info={notes.ownParts?.[part.name.toUpperCase()]} onSave={(info) => updateNotes((n) => setOwnPart(n, part.name, info))} />
          )}
          {obdValues.length > 0 && (
            <section className="details-section obd">
              <h3>
                OpenBoardData <span className="muted">{obdata!.id}</span>
              </h3>
              <dl className="props">
                {obdValues.map((v) => (
                  <Row key={`${v.kind}${v.value}`} label={t(OBD_PART_KINDS[v.kind] ?? "obd.misc")}>
                    {v.value}
                  </Row>
                ))}
              </dl>
            </section>
          )}
          <dl className="props">
            {part.package && <Row label={t("details.package")}>{t(`package.${part.package}`)}</Row>}
            <Row label={t("details.side")}>{t(sideKey[part.side])}</Row>
            <Row label={t("details.mount")}>{t(part.mount === "th" ? "mount.th" : "mount.smd")}</Row>
            <Row label={t("details.pins")}>{part.pinCount}</Row>
            <Row label={t("details.position")}>
              {formatLength((b.minX + b.maxX) / 2, u)}, {formatLength((b.minY + b.maxY) / 2, u)}
            </Row>
            <Row label={t("details.size")}>{formatSize(b.maxX - b.minX, b.maxY - b.minY, u)}</Row>
          </dl>
          {hits([part.name], mapping(part.name))}
          <section className="details-section">
            <h3>{t("details.pins")}</h3>
            <table className="pin-table">
              <tbody>
                {model.pins.slice(part.firstPin, part.firstPin + Math.min(part.pinCount, 1000)).map((pin, k) => {
                  const index = part.firstPin + k;
                  const net = model.nets[pin.net];
                  return (
                    <tr key={index} onClick={() => onSelect({ kind: "pin", pin: index }, false)}>
                      <td className="mono">{pin.number}</td>
                      <td>
                        <span className={`net-chip kind-${net.kind}`}>{net.name}</span>
                      </td>
                      <td className="muted">
                        {notes?.ownPins?.[pinKey(model, index)]?.label ? (
                          <span className="own-pin-label" title={t("own.tag")}>
                            {notes.ownPins[pinKey(model, index)].label}
                          </span>
                        ) : (
                          (pin.name ?? "")
                        )}
                      </td>
                      {pinCheck && pinCheck.byPin.size > 0 && <PinFunction pin={pinCheck.byPin.get(index)} />}
                      {(() => {
                        const d = diodeOf(pin.net);
                        return (
                          <td className="mono pin-diode" title={d ? `${t("measure.diode")} · ${d.source}` : undefined}>
                            {d?.text ?? ""}
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      );
    }

    case "pin": {
      const pin = model.pins[selection.pin];
      const part = model.parts[pin.part];
      const pinChip = chipFor(part.device);
      // Only when the datasheet pinout fits this board (see checkPinout).
      const datasheetPin = pinChip?.pinout ? checkPinout(model, pin.part, pinChip.pinout).byPin.get(selection.pin) : undefined;
      const net = model.nets[pin.net];
      return (
        <div className="details">
          <header className="details-head">
            <span className="details-type">{t("details.pin")}</span>
            <h2>
              <button className="link" onClick={() => onSelect({ kind: "part", part: pin.part }, false)}>
                {part.name}
              </button>
              <span className="muted">.</span>
              {pin.number}
            </h2>
            {part.device && <p className="details-device">{part.device}</p>}
          </header>
          <dl className="props">
            <Row label={t("details.net")}>{netLink(pin.net)}</Row>
            <Row label={t("details.kind")}>{t(kindKey[net.kind])}</Row>
            {pin.name && <Row label={t("details.pinName")}>{pin.name}</Row>}
            <Row label={t("details.side")}>{t(sideKey[pin.side])}</Row>
            <Row label={t("details.position")}>
              {formatLength(pin.x, u)}, {formatLength(pin.y, u)}
            </Row>
            {pin.probe !== undefined && <Row label={t("details.probe")}>{pin.probe}</Row>}
            {datasheetPin && (
              <Row label={t("details.function")}>
                <strong>{datasheetPin.name}</strong> – {datasheetPin.role}
              </Row>
            )}
            {datasheetPin?.expect && <Row label={t("details.expected")}>{datasheetPin.expect}</Row>}
          </dl>
          {measure(pin.net)}
          {(() => {
            const targets = jumperTargets(model, selection.pin, 5);
            if (targets.length === 0) return null;
            const pinSide = pin.side === "both" ? side : pin.side;
            return (
              <section className="details-section jumpers">
                <h3 title={t("jumper.hint")}>{t("jumper.title")}</h3>
                <table className="wb-table">
                  <tbody>
                    {targets.map((target) => {
                      const at = target.kind === "pin" ? model.pins[target.index] : model.testPoints[target.index];
                      return (
                        <tr key={`${target.kind}${target.index}`}>
                          <td>
                            <button
                              className="link mono"
                              onClick={() => onSelect(target.kind === "pin" ? { kind: "pin", pin: target.index } : { kind: "testPoint", testPoint: target.index }, true)}
                            >
                              {target.label}
                            </button>
                            {!target.sameSide && <span className="muted"> · {t("jumper.otherSide")}</span>}
                          </td>
                          <td className="muted">{formatLength(target.distance, u)}</td>
                          <td>
                            {notes && target.sameSide && (
                              <button
                                className="small"
                                onClick={() =>
                                  updateNotes((n) =>
                                    addDrawing(n, {
                                      kind: "jumper",
                                      side: pinSide,
                                      points: [
                                        { x: pin.x, y: pin.y },
                                        { x: at.x, y: at.y },
                                      ],
                                      from: `${model.pinLabel(selection.pin)} · ${model.nets[pin.net].name}`,
                                      to: target.label,
                                    }),
                                  )
                                }
                              >
                                {t("jumper.draw")}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })()}
          {notes && (
            <OwnPinInfo info={notes.ownPins?.[pinKey(model, selection.pin)]} onSave={(info) => updateNotes((n) => setOwnPin(n, pinKey(model, selection.pin), info))} />
          )}
          {hits([part.name], mapping(part.name, { number: pin.number, nets: [...new Set([net.name, model.fileNetName(pin.net)])] }))}
          {netMembers(pin.net, selection.pin)}
        </div>
      );
    }

    case "testPoint": {
      const tp = model.testPoints[selection.testPoint];
      return (
        <div className="details">
          <header className="details-head">
            <span className="details-type">{tp.kind === "via" ? t("details.via") : t("details.testPoint")}</span>
            <h2>{tp.name ?? (tp.probe !== undefined ? `TP${tp.probe}` : model.nets[tp.net].name)}</h2>
          </header>
          <dl className="props">
            <Row label={t("details.net")}>{netLink(tp.net)}</Row>
            <Row label={t("details.side")}>{t(sideKey[tp.side])}</Row>
            <Row label={t("details.position")}>
              {formatLength(tp.x, u)}, {formatLength(tp.y, u)}
            </Row>
          </dl>
          {measure(tp.net)}
          {netMembers(tp.net)}
        </div>
      );
    }

    case "net": {
      const net = model.nets[selection.net];
      return (
        <div className="details">
          <header className="details-head">
            <span className="details-type">{t("details.net")}</span>
            <h2 className={`kind-text-${net.kind}`}>{net.name}</h2>
            {net.assumedGround && <p className="details-device">{t("details.assumedGround")}</p>}
            {onTogglePin && (
              <button
                className={`small pin-toggle${pinnedNets?.has(selection.net) ? " on" : ""}`}
                onClick={() => onTogglePin(selection.net)}
                title={t("pin.hint")}
                style={
                  pinnedNets?.has(selection.net)
                    ? { borderColor: `rgb(${pinnedNets.get(selection.net)!.slice(0, 3).join(" ")})` }
                    : undefined
                }
              >
                {pinnedNets?.has(selection.net) ? t("pin.unpin") : t("pin.pin")}
              </button>
            )}
            {onRenameNet && (
              <NetRename
                key={selection.net}
                current={net.name}
                fileName={model.fileNetName(selection.net)}
                onSave={(name) => onRenameNet(selection.net, name)}
              />
            )}
          </header>
          <dl className="props">
            <Row label={t("details.kind")}>
              {onSetNetKind && net.kind !== "unconnected" ? (
                <NetKindPick
                  kind={net.kind}
                  fileKind={model.fileNetKind(selection.net)}
                  name={net.name}
                  onChange={(k) => onSetNetKind(selection.net, k === model.fileNetKind(selection.net) ? undefined : k)}
                />
              ) : (
                t(kindKey[net.kind])
              )}
            </Row>
            {(() => {
              const v =
                schematicFacts?.netVoltages.get(net.name.toUpperCase()) ??
                schematicFacts?.netVoltages.get(model.fileNetName(selection.net).toUpperCase());
              return v ? <Row label={t("sch.voltage")}>{v.replace(".", lang === "de" ? "," : ".").replace(/V$/, " V")}</Row> : null;
            })()}
            <Row label={t("details.pins")}>{net.pins.length}</Row>
            {(net.traces?.length ?? 0) > 0 && (
              <Row label={t("details.traces")}>
                {t("details.tracesSummary", { traces: net.traces!.length, vias: net.testPoints.length })}
              </Row>
            )}
          </dl>
          {measure(selection.net)}
          {hits([net.name, model.fileNetName(selection.net)])}
          {netMembers(selection.net)}
        </div>
      );
    }
  }
}

/**
 * The net's kind, correctable when the file is wrong: a name alone ("GND")
 * changes nothing about colours and filters, the kind does.
 */
function NetKindPick({ kind, fileKind, name, onChange }: { kind: NetKind; fileKind: NetKind; name: string; onChange(kind: NetKind): void }) {
  const { t } = useI18n();
  const looksGround = /^(A|D|P|S)?(GND|GROUND|VSS|AGND|DGND|PGND)\d*$/i.test(name);
  return (
    <span className="net-kind-pick">
      <select value={kind} onChange={(e) => onChange(e.target.value as NetKind)} aria-label={t("details.kind")}>
        {(["signal", "power", "ground"] as const).map((k) => (
          <option key={k} value={k}>
            {t(kindKey[k])}
          </option>
        ))}
      </select>
      {kind !== fileKind && <span className="muted"> {t("details.kindOwn", { kind: t(kindKey[fileKind]) })}</span>}
      {looksGround && kind !== "ground" && (
        <button className="link" onClick={() => onChange("ground")}>
          {t("details.kindSuggestGround")}
        </button>
      )}
    </span>
  );
}
