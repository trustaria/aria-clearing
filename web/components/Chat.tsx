"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatFrame, ChatMessage, ModelName } from "../lib/kimi";
import type { CardData } from "../lib/receipt";
import AdCard from "./AdCard";
import DebugBar from "./DebugBar";

type Turn = {
  role: "user" | "assistant";
  content: string;
  requestId?: string;
  card?: CardData;
  notice?: string;
  error?: string;
  pending?: boolean;
};

/** Empty-state suggestions: buying-intent questions first, one informational question last. */
export const EXAMPLES = [
  "Planning 5 days in Lisbon with two kids, what should I book first?",
  "Is an e-bike worth it for a 12 km commute?",
  "Which running shoes should I get for my first half marathon?",
  "Which notes app works well for meeting notes?",
  "What's a good building set for a 7-year-old?",
  "What's the difference between RAM and storage?",
];

/** Reads an NDJSON response body and calls `onFrame` for every complete line. */
async function readFrames(res: Response, onFrame: (frame: ChatFrame) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onFrame(JSON.parse(line));
    if (done) break;
  }
}

export default function Chat({
  initialModel,
  debugLocked = false,
}: {
  initialModel: ModelName | null;
  /** True when the debug bar needs the demo key. */
  debugLocked?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(initialModel);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const updateLast = (patch: (turn: Turn) => Turn) =>
    setTurns((all) => [...all.slice(0, -1), patch(all[all.length - 1])]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history: ChatMessage[] = [
      // Failed and fallback answers stay out of the model's history.
      ...turns.filter((t) => !t.error && !t.notice).map(({ role, content }) => ({ role, content })),
      { role: "user", content: text },
    ];
    setTurns((all) => [...all, { role: "user", content: text }, { role: "assistant", content: "", pending: true }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      await readFrames(res, (frame) => {
        if (frame.type === "meta") {
          setModel(frame.model);
          updateLast((t) => ({ ...t, requestId: frame.requestId }));
        } else if (frame.type === "text") {
          updateLast((t) => ({ ...t, content: t.content + frame.delta }));
        } else if (frame.type === "card") {
          updateLast((t) => ({ ...t, card: frame.card }));
        } else if (frame.type === "notice") {
          updateLast((t) => ({ ...t, notice: frame.message }));
        } else if (frame.type === "error") {
          updateLast((t) => ({ ...t, error: frame.message }));
        }
      });
    } catch (error) {
      updateLast((t) => ({ ...t, error: (error as Error).message || "Request failed." }));
    } finally {
      updateLast((t) => ({ ...t, pending: false }));
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4">
      <DebugBar locked={debugLocked} />
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">Nova</span>
          {model === "stub" && (
            <span className="rounded border border-amber-400 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-amber-700 dark:text-amber-400">
              STUB MODEL
            </span>
          )}
        </div>
        {model && model !== "stub" && (
          <span className="text-xs text-neutral-500">Answers by KIMI · {model}</span>
        )}
      </header>

      <main className="flex-1 pb-36">
        {turns.length === 0 && (
          <div className="mt-24 space-y-3 text-center">
            <p className="text-neutral-500">Ask Nova anything.</p>
            <div className="flex flex-col items-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => void ask(example)}
                  className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2 dark:bg-neutral-800">{turn.content}</div>
              </div>
            ) : (
              <div key={i} data-request-id={turn.requestId}>
                {turn.notice && <p className="mb-1 text-xs text-amber-700 dark:text-amber-400">{turn.notice}</p>}
                <div className="whitespace-pre-wrap leading-relaxed">
                  {turn.content}
                  {turn.pending && !turn.content && <span className="text-neutral-400">Thinking…</span>}
                </div>
                {turn.error && <p className="mt-2 text-sm text-red-600">{turn.error}</p>}
                {turn.card && !turn.error && <AdCard card={turn.card} />}
              </div>
            ),
          )}
        </div>
        <div ref={bottom} />
      </main>

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)] to-transparent pb-6 pt-8"
      >
        <div className="mx-auto flex max-w-2xl gap-2 px-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Nova"
            className="flex-1 rounded-xl border border-neutral-300 bg-transparent px-4 py-3 outline-none focus:border-neutral-500 dark:border-neutral-700"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
