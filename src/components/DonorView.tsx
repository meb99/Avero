import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { BoardModel } from "../core/board";
import { useI18n } from "../i18n";
import { loadLibrary } from "../workbench/library";
import { Dialog } from "./Dialogs";

interface DonorHit {
  path: string;
  part: string;
  device: string;
  pinCount: number;
  score: number;
  pinMatch: number | null;
}

const KIND: Record<string, string> = { ground: "G", power: "P", unconnected: "U" };

/**
 * The selected part on the other boards of the library: same device text,
 * or the same part number, with how well the pinout fits (by the kind of
 * net on each pin).
 */
export function DonorView({
  model,
  part,
  boardPath,
  keys,
  onOpen,
  onClose,
}: {
  model: BoardModel;
  part: number;
  boardPath?: string;
  keys: { xzzKey: string; fzKey: string };
  onOpen(path: string, part: string): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const p = model.parts[part];
  const [hits, setHits] = useState<DonorHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boards, setBoards] = useState(0);

  useEffect(() => {
    const paths = [...new Set((loadLibrary().scan?.entries ?? []).flatMap((e) => e.boards.map((b) => b.path)))];
    setBoards(paths.length);
    const pins = model.pins
      .slice(p.firstPin, p.firstPin + p.pinCount)
      .map((pin) => [pin.number, KIND[model.nets[pin.net].kind] ?? "S"] as [string, string]);
    invoke<DonorHit[]>("find_donors", {
      paths,
      query: { device: p.device ?? "", pinCount: p.pinCount, pins, exclude: boardPath ?? null },
      xzzKey: keys.xzzKey || null,
      fzKey: keys.fzKey || null,
    }).then(setHits, (e) => setError(String(e)));
  }, [model, part]);

  const name = (path: string) => path.split("/").pop() ?? path;
  return (
    <Dialog title={t("donor.title", { part: p.name })} onClose={onClose} className="donor-dialog">
      <p className="muted">
        {p.device ? t("donor.searching", { device: p.device, n: boards }) : t("donor.noDevice")}
      </p>
      {error && <p className="wb-error">{error}</p>}
      {p.device && !hits && !error && <p className="muted">{t("donor.wait")}</p>}
      {hits && hits.length === 0 && <p className="muted">{t("donor.none")}</p>}
      {hits && hits.length > 0 && (
        <table className="wb-table donor-table">
          <thead>
            <tr>
              <th>{t("donor.board")}</th>
              <th>{t("details.part")}</th>
              <th>{t("donor.device")}</th>
              <th title={t("donor.pinsHint")}>{t("donor.pins")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <tr key={`${h.path}|${h.part}`}>
                <td title={h.path}>{name(h.path)}</td>
                <td className="mono">{h.part}</td>
                <td className="mono">
                  {h.device}
                  {h.score < 2 && <span className="muted"> · {t("donor.numberOnly")}</span>}
                </td>
                <td className={h.pinMatch === null ? "muted" : h.pinMatch >= 0.95 ? "donor-good" : h.pinMatch >= 0.7 ? "donor-maybe" : "donor-bad"}>
                  {h.pinMatch === null ? "–" : `${Math.round(h.pinMatch * 100)} %`}
                </td>
                <td>
                  <button className="small" onClick={() => onOpen(h.path, h.part)}>
                    {t("donor.open")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
