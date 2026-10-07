/** The explained hint for a net in the repair case (F37): finding, evidence, candidates, open questions. */
import type { BoardModel } from "../core/board";
import type { Selection } from "../core/types";
import { useI18n } from "../i18n";
import { groupFacts } from "../workbench/expected";
import type { NetHint } from "../workbench/hints";
import { formatValue } from "../workbench/measure";
import { conditionsText } from "./Conditions";

const SIZE_NAMES = ["", "01005", "0201", "0402", "0603", "0805", "1206", "1210", "1812+"];

export function NetHintCard({ model, hint, onSelect }: { model: BoardModel; hint: NetHint; onSelect(selection: Selection, zoom: boolean): void }) {
  const { t, lang } = useI18n();
  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");
  const part = (i: number) => (
    <button className="link mono" onClick={() => onSelect({ kind: "part", part: i }, true)}>
      {model.parts[i].name}
    </button>
  );
  const serious = hint.finding === "short" || hint.finding === "low" || hint.finding === "open" || hint.finding === "deviation";
  return (
    <div className={`net-hint finding-${hint.finding}`}>
      <p className="net-hint-finding">
        <strong>{t(`hint.finding.${hint.finding}`)}</strong>
        {serious && <span className="muted"> · {t("hint.notVerdict")}</span>}
      </p>

      {hint.values.length > 0 && (
        <>
          <h4>{t("hint.basis")}</h4>
          <ul className="net-hint-list">
            {hint.values.map((v) => {
              const e = hint.expected[v.q];
              const g = e?.fitting[0];
              const facts = g && groupFacts(g);
              return (
                <li key={v.q}>
                  <span className="mono">
                    {t(`measure.${v.q}`)} {formatValue(v.value, v.q, lang)}
                  </span>{" "}
                  <span className="muted">
                    · {v.source}
                    {v.at && `, ${time(v.at)}`} · {v.cond ? conditionsText(v.cond, t) : t("hint.noConditions")}
                  </span>
                  <br />
                  <span className="muted">
                    {e?.limit
                      ? t("hint.limit", { min: e.limit.min ?? "–", max: e.limit.max ?? "–", source: e.limit.source })
                      : facts && facts.min !== undefined
                        ? t("hint.goodBoards", {
                            range: facts.min === facts.max ? formatValue(facts.min, v.q, lang) : `${formatValue(facts.min, v.q, lang)} – ${formatValue(facts.max!, v.q, lang)}`,
                            n: facts.boards,
                            from: g.values.map((x) => x.title).join(", "),
                          })
                        : facts && facts.ol > 0
                          ? t("hint.goodBoardsOl", { n: facts.boards })
                          : e && e.groups.length > 0
                            ? t("hint.otherConditions")
                            : t("hint.noReference")}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {hint.contradictions.length > 0 && (
        <div className="kb-note kb-warning">
          <strong>{t("hint.contradictions")}</strong>
          <ul className="net-hint-list">
            {hint.contradictions.map((c) => (
              <li key={c}>{t(`hint.contradiction.${c}`)}</li>
            ))}
          </ul>
        </div>
      )}

      {hint.candidates.length > 0 && (
        <>
          <h4 title={t("hint.candidatesHint")}>{t("hint.candidates")}</h4>
          <ul className="net-hint-list">
            {hint.candidates.slice(0, 8).map((c) => (
              <li key={c.part}>
                {part(c.part)} <span className="muted">{t(`short.kind.${c.kind}`)}</span>
                {c.size > 0 && <span className="src-tag">{SIZE_NAMES[c.size]}</span>}
                {c.confirmed && (
                  <span className="src-tag ok" title={t("hint.confirmedHint")}>
                    {t("hint.confirmed", { case: c.confirmed.caseTitle, action: t(`chron.action.${c.confirmed.action as "replaced"}`) })}
                  </span>
                )}
              </li>
            ))}
            {hint.candidates.length > 8 && <li className="muted">{t("hint.more", { n: hint.candidates.length - 8 })}</li>}
          </ul>
        </>
      )}

      {hint.alternatives.length > 0 && (
        <>
          <h4>{t("hint.alternatives")}</h4>
          <ul className="net-hint-list">
            {hint.alternatives.map((a) => (
              <li key={a}>{t(`hint.alt.${a}`)}</li>
            ))}
          </ul>
        </>
      )}

      {hint.needed.length > 0 && (
        <>
          <h4>{t("hint.next")}</h4>
          <ol className="net-hint-list">
            {hint.needed.map((n) => (
              <li key={n}>
                {n === "isolate" && hint.isolateFirst !== undefined ? (
                  <>
                    {t("hint.need.isolate.before")} {part(hint.isolateFirst)} {t("hint.need.isolate.after")}
                  </>
                ) : (
                  t(`hint.need.${n}`)
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
