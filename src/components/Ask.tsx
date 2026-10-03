import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialogs";

/*
 * Questions in Avero's own dialogs. The Mac app's web view shows no
 * window.prompt / window.confirm (they return at once without asking), so
 * every question goes through here: `askText` and `askConfirm` resolve when
 * the user answers, and <AskHost /> (mounted once per window) shows them.
 */

interface Question {
  id: number;
  kind: "text" | "confirm";
  message: string;
  title?: string;
  initial?: string;
  ok?: string;
  danger?: boolean;
  /** A password: typed text is hidden. */
  secret?: boolean;
  resolve(answer: string | boolean | null): void;
}

let queue: Question[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

function ask(q: Omit<Question, "id" | "resolve">): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    queue = [...queue, { ...q, id: next++, resolve }];
    emit();
  });
}

/** A line of text, or null when cancelled. */
export function askText(message: string, initial = "", options: { title?: string; ok?: string; secret?: boolean } = {}): Promise<string | null> {
  return ask({ kind: "text", message, initial, ...options }) as Promise<string | null>;
}

/** Yes or no; `danger` marks a destructive answer. */
export function askConfirm(message: string, options: { title?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return ask({ kind: "confirm", message, ...options }).then((a) => a === true);
}

function answer(q: Question, value: string | boolean | null) {
  queue = queue.filter((x) => x.id !== q.id);
  emit();
  q.resolve(value);
}

/** Shows the oldest open question. */
export function AskHost() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue[0] ?? null,
  );
  return current ? <AskDialog key={current.id} question={current} /> : null;
}

function AskDialog({ question: q }: { question: Question }) {
  const { t } = useI18n();
  const [text, setText] = useState(q.initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      } else okRef.current?.focus();
    });
  }, []);
  const cancel = () => answer(q, q.kind === "text" ? null : false);
  const ok = () => answer(q, q.kind === "text" ? text : true);
  return (
    <Dialog title={q.title ?? "Avero"} onClose={cancel} className="ask-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
      >
        <p className="ask-message">{q.message}</p>
        {q.kind === "text" && <input ref={inputRef} className="ask-input" type={q.secret ? "password" : "text"} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />}
        <div className="ask-buttons">
          <button type="button" className="small" onClick={cancel}>
            {t("ask.cancel")}
          </button>
          <button ref={okRef} type="submit" className={`small ${q.danger ? "danger" : "primary"}`}>
            {q.ok ?? t("ask.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
