"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CampaignStatsJson } from "../../../lib/advertiser-data";
import { Section } from "../../receipt/ReceiptDocument";
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
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
      Aria for advertisers ·{" "}
      <a href="/advertise" className="normal-case tracking-normal hover:text-stone-900">
        ← Campaigns
      </a>
    </p>
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

function SentenceItem({
  row,
  elapsed,
  onDispute,
}: {
  row: SentenceRow;
  elapsed: number;
  onDispute?: (eventId: string) => void;
}) {
  const left = Math.max(0, Math.floor(row.disputeSecondsLeft - elapsed));
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[row.tone]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-relaxed text-stone-800">“{row.quote}”</p>
        <p className="text-xs text-stone-500">{row.meta}</p>
      </div>
      <div className="mt-0.5 flex shrink-0 items-center gap-3">
        {left > 0 && (
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={!onDispute}
            onClick={() => onDispute?.(row.eventId)}
          >
            Dispute ({left} s)
          </button>
        )}
        <a href={row.receiptUrl} className={`text-sm text-stone-500 ${LINK}`}>
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
}: {
  view: CampaignView | null;
  elapsed: number;
  onDispute?: (eventId: string) => void;
}) {
  return (
    <Section title="Recent sponsored sentences">
      {!view ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : view.sentences.length === 0 ? (
        <p className="text-sm text-stone-500">
          Nothing yet. When an AI answer recommends {view.brand}, the sentence shows up here within seconds.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {view.sentences.map((row) => (
            <SentenceItem key={row.eventId} row={row} elapsed={elapsed} onDispute={onDispute} />
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

function EndCampaign({ remaining, onEnd }: { remaining: string; onEnd?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-200 pt-6">
      <button
        type="button"
        disabled={!onEnd}
        onClick={() => onEnd?.()}
        className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:text-stone-400"
      >
        End campaign
      </button>
      <p className="text-sm text-stone-500">Stops new ads and returns the remaining {remaining}.</p>
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
      </dl>
    </details>
  );
}

/**
 * The campaign page body: polls `fetchStats` every 3 s and counts dispute windows down each second.
 * Dispute and End stay disabled until their handlers are passed.
 */
export default function CampaignPanel({
  isNew,
  fetchStats,
  onDispute,
  onEnd,
}: {
  isNew: boolean;
  fetchStats: () => Promise<Response>;
  onDispute?: (eventId: string) => void;
  onEnd?: () => void;
}) {
  const [data, setData] = useState<CampaignStatsJson | null>(null);
  // Client clock at the moment `data` arrived, in unix seconds.
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const inFlight = useRef(false);

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
  const view = useMemo(() => (data ? toCampaignView(data, data.now + elapsed) : null), [data, elapsed]);

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

      {isNew && data?.status === "live" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 text-[15px] leading-relaxed text-emerald-950">
          <p>Your campaign is live. AI answers can recommend it from now.</p>
          <a href="/" className="mt-1 inline-block font-medium underline decoration-emerald-300 underline-offset-4 hover:decoration-emerald-600">
            Try it in Nova →
          </a>
        </div>
      )}

      {view?.endedNotice && (
        <div className="rounded-xl border border-stone-200 bg-white px-5 py-4 text-[15px] text-stone-700">{view.endedNotice}</div>
      )}

      <Stats view={view} />
      <Sentences view={view} elapsed={elapsed} onDispute={onDispute} />
      {view && <Claims claims={view.claims} />}
      {view && data?.status === "live" && <EndCampaign remaining={view.remaining} onEnd={onEnd} />}
      {view && <AccountDetails account={view.account} />}

      <footer className="border-t border-stone-200 pt-6 text-xs text-stone-500">
        <p>Every charge has a public proof. Amounts in USD.</p>
      </footer>
    </div>
  );
}
