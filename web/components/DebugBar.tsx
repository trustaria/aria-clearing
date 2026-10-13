"use client";

import { useEffect, useRef, useState } from "react";
import { setHoldViews, useHoldViews } from "../lib/debug-flags";
import { demoKeyHeaders, forgetDemoKey, saveDemoKey, storedDemoKey, takeDebugParam } from "../lib/demo-key-client";
import type { EventRecord } from "../lib/store";

const EXPLORER_TX = "https://testnet.monadvision.com/tx/";

type ActionResult = { label: string; text: string; txHash?: string; tone: "ok" | "denied" | "error" };

function short(value: string, head = 8): string {
  return value.length > head + 6 ? `${value.slice(0, head)}…${value.slice(-4)}` : value;
}

function TxLink({ hash }: { hash?: string | null }) {
  if (!hash) return null;
  return (
    <a href={`${EXPLORER_TX}${hash}`} target="_blank" rel="noopener" className="underline underline-offset-2">
      {short(hash, 10)}
    </a>
  );
}

async function postJson(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...demoKeyHeaders() },
    body: "{}",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** True when the server accepts this tab's demo key; a rejected key is forgotten. */
async function checkDemoKey(): Promise<boolean> {
  if (!storedDemoKey()) return false;
  try {
    const res = await fetch("/api/aria/demo-key", { cache: "no-store", headers: demoKeyHeaders() });
    if (res.status === 403) forgetDemoKey();
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Demo controls, shown with ?debug=1 or Ctrl+Shift+D. When `locked` (ARIA_DEMO_KEY set on the server),
 * only ?debug=<key> opens it: the key moves from the URL to sessionStorage and the server checks it.
 */
export default function DebugBar({ locked = false }: { locked?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<ActionResult[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const unlocked = useRef(!locked);
  const hold = useHoldViews();

  useEffect(() => {
    let alive = true;
    unlocked.current = !locked;
    if (!locked) {
      if (new URLSearchParams(window.location.search).get("debug") === "1") setOpen(true);
    } else {
      const { value, cleaned } = takeDebugParam(window.location.href);
      if (value !== null) {
        saveDemoKey(value);
        window.history.replaceState(window.history.state, "", cleaned);
      }
      void checkDemoKey().then((ok) => {
        if (!alive) return;
        unlocked.current = ok;
        if (ok && value !== null) setOpen(true);
      });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        if (!unlocked.current) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [locked]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      fetch("/api/aria/events", { cache: "no-store", headers: demoKeyHeaders() })
        .then((res) => res.json())
        .then((data: { events: EventRecord[] }) => alive && setEvents(data.events))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);

  if (!open) return null;

  async function run(label: string, url: string, describe: (status: number, body: Record<string, unknown>) => ActionResult) {
    setBusy(label);
    try {
      const { status, body } = await postJson(url);
      setResults((all) => [describe(status, body), ...all].slice(0, 4));
    } catch (err) {
      setResults((all) => [{ label, text: (err as Error).message, tone: "error" as const }, ...all].slice(0, 4));
    } finally {
      setBusy(null);
    }
  }

  const forge = () =>
    run("Forge", "/api/aria/forge", (status, body) =>
      status === 200
        ? { label: "Forge", text: `impression for ${short(String(body.requestId), 12)} logged`, txHash: body.txHash as string, tone: "ok" }
        : { label: "Forge", text: String(body.error ?? status), tone: "error" },
    );

  const dispute = () =>
    run("Dispute", "/api/aria/dispute", (status, body) =>
      status === 200
        ? { label: "Dispute", text: `event ${short(String(body.eventId))} disputed`, txHash: body.txHash as string, tone: "ok" }
        : { label: "Dispute", text: String(body.error ?? status), tone: "error" },
    );

  const pay = () =>
    run("Relayer pays", "/api/aria/relayer-pay", (status, body) =>
      body.denied
        ? { label: "Relayer pays", text: "Denied by Privy policy", tone: "denied" }
        : status === 200
          ? { label: "Relayer pays", text: "sent (policy did not block it)", txHash: body.txHash as string, tone: "error" }
          : { label: "Relayer pays", text: String(body.error ?? `send failed: ${status}`), tone: "error" },
    );

  const button =
    "rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";
  const tones = { ok: "text-emerald-700 dark:text-emerald-400", denied: "text-red-600", error: "text-amber-700 dark:text-amber-400" };

  return (
    <div className="fixed right-3 top-3 z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-neutral-200 bg-[var(--background)] p-3 font-mono text-[11px] shadow-sm dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-neutral-500">Aria debug</span>
        <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
          ×
        </button>
      </div>
      <label className="mb-2 flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" checked={hold} onChange={(e) => setHoldViews(e.target.checked)} />
        Hold views (cards stay unviewed)
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button className={button} disabled={busy !== null} onClick={() => void forge()}>
          Forge impression
        </button>
        <button className={button} disabled={busy !== null} onClick={() => void dispute()}>
          Dispute
        </button>
        <button className={button} disabled={busy !== null} onClick={() => void pay()}>
          Relayer tries to pay
        </button>
      </div>
      {busy && <p className="mt-2 text-neutral-500">{busy}…</p>}
      {results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((r, i) => (
            <li key={i} className={tones[r.tone]}>
              {r.label}: {r.text} <TxLink hash={r.txHash} />
            </li>
          ))}
        </ul>
      )}
      {events.length > 0 && (
        <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto border-t border-neutral-200 pt-2 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          {events.map((e) => (
            <li key={e.eventId} title={e.error ?? e.eventId}>
              {e.kind === "click" ? "click" : e.forged ? "forged" : "view"} {short(e.requestId, 10)} {e.status}
              {e.disputeTxHash ? " · disputed" : ""} <TxLink hash={e.txHash} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
