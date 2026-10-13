"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DisputeResult, EndResult } from "../../../lib/advertise-client";
import type { CampaignStatsJson } from "../../../lib/advertiser-data";
import { AriaEyebrow } from "../../AriaBrand";
import { Section } from "../../receipt/ReceiptDocument";
import { NO_ACTIONS, reduceActions, runDispute, runEnd, WALLET_DISPUTE_MIN_S, type EndState } from "./actions";
import { toCampaignView, type CampaignView, type SentenceRow, type StatCard, type Tone } from "./view-model";

const POLL_MS = 3_000;
const TICK_MS = 1_000;

const DOT: Record<Tone, string> = {
  good: "bg-emerald-500",
  pending: "bg-sky-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  idle: "bg-stone-400",
};

const LINK = "underline decoration-stone-300 underline-offset-4 transition hover:text-stone-900";
const SMALL_BUTTON =
  "rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:text-stone-900 disabled:cursor-not-allowed disabled:text-stone-400";

export function Eyebrow() {
  return (
    <AriaEyebrow>
      for advertisers ·{" "}
      <a href="/advertise" className="normal-case tracking-normal hover:text-stone-900">
        ← Campaigns
      </a>
    </AriaEyebrow>
  );
}

function Card({ card }: { card: StatCard }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-stone-500">{card.label}</p>
      <p className="mt-2 text-[1.625rem] font-semibold leading-tight tracking-tight tabular-nums text-stone-900">{card.value}</p>
      <p className="mt-1 min-h-[1rem] text-xs text-stone-500">{card.hint ?? ""}</p>
    </div>
  );
}

function Stats({ view }: { view: CampaignView | null }) {
  if (!view) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[6.75rem] animate-pulse rounded-xl border border-stone-200 bg-white/60" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {view.cards.map((card) => (
          <Card key={card.key} card={card} />
        ))}
      </div>
      <p className="text-sm text-stone-600">{view.verification}</p>
    </div>
  );
}

/** One sponsored sentence with its Dispute button, disabled once fewer than `minLeft` seconds remain. */
export function SentenceItem({
  row,
  elapsed,
  onDispute,
  minLeft = 0,
}: {
  row: SentenceRow;
  elapsed: number;
  onDispute?: (eventId: string) => void;
  minLeft?: number;
}) {
  const left = Math.max(0, Math.floor(row.disputeSecondsLeft - elapsed));
  const sending = row.dispute?.phase === "sending";
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[row.tone]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-relaxed text-stone-800">“{row.quote}”</p>
        <p className="text-xs text-stone-500">{row.meta}</p>
        {row.dispute?.phase === "error" && (
          <p role="alert" className="mt-1 text-xs text-rose-700">
            {row.dispute.message}
          </p>
        )}
      </div>
      <div className="mt-0.5 flex shrink-0 items-center gap-3">
        {(left > 0 || sending) && (
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={!onDispute || sending || left < minLeft}
            onClick={() => onDispute?.(row.eventId)}
          >
            {sending ? "Disputing…" : `Dispute (${left} s)`}
          </button>
        )}
        <a href={row.receiptUrl} target="_blank" rel="noopener noreferrer" className={`text-sm text-stone-500 ${LINK}`}>
          Proof<span className="sr-only"> for this sentence</span>
        </a>
      </div>
    </li>
  );
}

function Sentences({
  view,
  elapsed,
  onDispute,
  minLeft,
}: {
  view: CampaignView | null;
  elapsed: number;
  onDispute?: (eventId: string) => void;
  minLeft?: number;
}) {
  return (
    <Section title="Recent sponsored sentences" aside={view?.recent.aside}>
      {!view ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : view.sentences.length === 0 ? (
        <p className="text-sm text-stone-500">{view.recent.empty}</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {view.sentences.map((row) => (
            <SentenceItem key={row.eventId} row={row} elapsed={elapsed} onDispute={onDispute} minLeft={minLeft} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Claims({ claims }: { claims: string[] }) {
  return (
    <Section title="Approved claims">
      <ol className="list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-stone-700 marker:text-stone-400">
        {claims.map((claim, i) => (
          <li key={i}>{claim}</li>
        ))}
      </ol>
    </Section>
  );
}

const END_BUTTON =
  "rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:text-stone-400";

/** The End block: a button, then the inline confirmation; disabled without `onConfirm`. */
export function EndCampaign({
  brand,
  remaining,
  state,
  onAsk,
  onCancel,
  onConfirm,
}: {
  brand: string;
  remaining: string;
  state: EndState;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm?: () => void;
}) {
  if (state.phase === "confirming" || state.phase === "sending") {
    const sending = state.phase === "sending";
    return (
      <div className="space-y-4 border-t border-stone-200 pt-6">
        <p className="text-[15px] leading-relaxed text-stone-800">
          End {brand}? New ads stop now. {remaining} returns to your account. Ads already being verified settle
          normally.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onCancel} disabled={sending} className={END_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.()}
            disabled={!onConfirm || sending}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {sending ? "Ending…" : "End campaign"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 border-t border-stone-200 pt-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" disabled={!onConfirm} onClick={onAsk} className={END_BUTTON}>
          End campaign
        </button>
        <p className="text-sm text-stone-500">Stops new ads and returns the remaining {remaining}.</p>
      </div>
      {state.phase === "error" && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.message}
        </p>
      )}
    </div>
  );
}

function AccountDetails({ account }: { account: CampaignView["account"] }) {
  const mono = "font-mono [overflow-wrap:anywhere]";
  return (
    <details className="border-t border-stone-200 pt-6 text-sm">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.14em] text-stone-500 hover:text-stone-900">
        Account details
      </summary>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-stone-600">
        <dt className="text-stone-500">Campaign ID</dt>
        <dd className={mono}>{account.campaignId}</dd>
        <dt className="text-stone-500">Paid from</dt>
        <dd>
          Aria test treasury{" "}
          <a href={account.treasuryUrl} target="_blank" rel="noreferrer" className={`${mono} ${LINK}`}>
            {account.treasury} ↗
          </a>{" "}
          (custodial, test mode)
        </dd>
        <dt className="text-stone-500">Created in tx</dt>
        <dd>
          <a href={account.txUrl} target="_blank" rel="noreferrer" className={`${mono} ${LINK}`}>
            {account.txHash} ↗
          </a>
        </dd>
        <dt className="text-stone-500">Clearing contract</dt>
        <dd>
          <a href={account.clearingUrl} target="_blank" rel="noreferrer" className={`${mono} ${LINK}`}>
            {account.clearing} ↗
          </a>
        </dd>
        <dt className="text-stone-500">Network</dt>
        <dd>{account.network}</dd>
        <dt className="text-stone-500">Activity data</dt>
        <dd>{account.source}</dd>
        <dt className="text-stone-500">{account.blocksLabel}</dt>
        <dd className="font-mono">{account.blocks}</dd>
      </dl>
    </details>
  );
}

/**
 * The campaign page body: polls `fetchStats` every 3 s and counts dispute windows down each second.
 * Dispute and End show their outcome before the next poll; both stay disabled until their handlers are passed.
 */
export default function CampaignPanel({
  isNew,
  fetchStats,
  onDispute,
  onEnd,
}: {
  isNew: boolean;
  fetchStats: () => Promise<Response>;
  onDispute?: (eventId: string) => Promise<DisputeResult>;
  onEnd?: () => Promise<EndResult>;
}) {
  const [data, setData] = useState<CampaignStatsJson | null>(null);
  // Client clock at the moment `data` arrived, in unix seconds.
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const inFlight = useRef(false);
  const [actions, dispatch] = useReducer(reduceActions, NO_ACTIONS);
  // Event ids with a dispute in flight, so a double click sends once.
  const disputing = useRef(new Set<string>());
  const ending = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetchStats();
      const body = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as CampaignStatsJson);
      setFetchedAt(Date.now() / 1000);
      setError(null);
    } catch {
      setError("We couldn't load your latest numbers. Retrying shortly.");
    } finally {
      inFlight.current = false;
    }
  }, [fetchStats]);

  useEffect(() => {
    if (notFound) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, notFound]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Seconds since the server answered, applied to its clock so ages and dispute windows keep moving between polls.
  const elapsed = data ? Math.max(0, now - fetchedAt) : 0;
  const view = useMemo(
    () => (data ? toCampaignView(data, data.now + elapsed, actions) : null),
    [data, elapsed, actions],
  );

  const dispute = useMemo(() => {
    if (!onDispute) return undefined;
    return async (eventId: string) => {
      if (disputing.current.has(eventId)) return;
      disputing.current.add(eventId);
      await runDispute(eventId, onDispute, dispatch);
      disputing.current.delete(eventId);
      void refresh();
    };
  }, [onDispute, refresh]);

  const end = useMemo(() => {
    if (!onEnd) return undefined;
    return async () => {
      if (ending.current) return;
      ending.current = true;
      await runEnd(onEnd, dispatch);
      ending.current = false;
      void refresh();
    };
  }, [onEnd, refresh]);

  if (notFound) {
    return (
      <div className="space-y-6">
        <Eyebrow />
        <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Campaign not found.</h1>
        <p className="text-[15px] text-stone-600">
          It may belong to another account. <a href="/advertise" className={LINK}>Back to your campaigns</a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <Eyebrow />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="font-serif text-[2rem] leading-snug text-stone-900">{view?.brand ?? " "}</h1>
          {view && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600">
              <span className={`h-2 w-2 rounded-full ${DOT[view.status.tone]}`} aria-hidden />
              {view.status.label}
            </span>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      {isNew && view?.endable && actions.end.phase === "idle" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 text-[15px] leading-relaxed text-emerald-950">
          <p>Your campaign is live. AI answers can recommend it from now.</p>
          <a href="/ai-chat" className="mt-1 inline-block font-medium underline decoration-emerald-300 underline-offset-4 hover:decoration-emerald-600">
            Try it in Nova →
          </a>
        </div>
      )}

      {view?.endedNotice && (
        <div className="rounded-xl border border-stone-200 bg-white px-5 py-4 text-[15px] text-stone-700">{view.endedNotice}</div>
      )}

      <Stats view={view} />
      <Sentences
        view={view}
        elapsed={elapsed}
        onDispute={dispute}
        minLeft={data?.funding === "wallet" ? WALLET_DISPUTE_MIN_S : 0}
      />
      {view && <Claims claims={view.claims} />}
      {view?.endable && (
        <EndCampaign
          brand={view.brand}
          remaining={view.remaining}
          state={actions.end}
          onAsk={() => dispatch({ type: "end-ask" })}
          onCancel={() => dispatch({ type: "end-cancel" })}
          onConfirm={end}
        />
      )}
      {view && <AccountDetails account={view.account} />}

      <footer className="border-t border-stone-200 pt-6 text-xs text-stone-500">
        <p>Every charge has a public proof. Amounts in USD.</p>
      </footer>
    </div>
  );
}
