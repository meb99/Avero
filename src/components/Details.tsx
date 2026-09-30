import type { ReactNode } from "react";
import { visibleFrom, type BoardModel, type ViewSide } from "../core/board";
import type { NetKind, Selection, Side } from "../core/types";
import { formatLength, formatSize } from "../format";
import { useI18n, type MessageKey } from "../i18n";
import type { Settings } from "../settings";
import type { BoardNotes } from "../workbench/notes";
import { MeasureBlock } from "./MeasureBlock";

interface Props {
  model: BoardModel;
  selection: Selection;
  side: ViewSide;
  settings: Settings;
  notes: BoardNotes | null;
  updateNotes(change: (n: BoardNotes) => BoardNotes): void;
  onSelect(selection: Selection, zoom: boolean): void;
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

export function Details({ model, selection, side, settings, notes, updateNotes, onSelect }: Props) {
  const { t } = useI18n();
  const u = settings.units;

  const netLink = (net: number) => {
    const n = model.nets[net];
    return (
      <button className={`link net-chip kind-${n.kind}`} onClick={() => onSelect({ kind: "net", net }, true)}>
        {n.name}
      </button>
    );
  };

  const measure = (net: number) =>
    notes && model.nets[net].kind !== "unconnected" ? (
      <MeasureBlock key={model.nets[net].name} net={model.nets[net].name} notes={notes} update={updateNotes} tolerance={settings.tolerance} />
    ) : null;

  const netMembers = (net: number, currentPin?: number) => {
    const n = model.nets[net];
    if (n.kind === "unconnected") return null;
    const members = model.netMembers(net);
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
      </section>
    );
  };

  switch (selection.kind) {
    case "none":
      return <p className="details-empty">{t("details.empty")}</p>;

    case "part": {
      const part = model.parts[selection.part];
      const b = part.bounds;
      return (
        <div className="details">
          <header className="details-head">
            <span className="details-type">{t("details.part")}</span>
            <h2>{part.name}</h2>
            {part.device && <p className="details-device">{part.device}</p>}
          </header>
          <dl className="props">
            <Row label={t("details.side")}>{t(sideKey[part.side])}</Row>
            <Row label={t("details.mount")}>{t(part.mount === "th" ? "mount.th" : "mount.smd")}</Row>
            <Row label={t("details.pins")}>{part.pinCount}</Row>
            <Row label={t("details.position")}>
              {formatLength((b.minX + b.maxX) / 2, u)}, {formatLength((b.minY + b.maxY) / 2, u)}
            </Row>
            <Row label={t("details.size")}>{formatSize(b.maxX - b.minX, b.maxY - b.minY, u)}</Row>
          </dl>
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
                      <td className="muted">{pin.name ?? ""}</td>
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
          </dl>
          {measure(pin.net)}
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
          </header>
          <dl className="props">
            <Row label={t("details.kind")}>{t(kindKey[net.kind])}</Row>
            <Row label={t("details.pins")}>{net.pins.length}</Row>
          </dl>
          {measure(selection.net)}
          {netMembers(selection.net)}
        </div>
      );
    }
  }
}
