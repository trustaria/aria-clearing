"use client";

import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, type Address } from "viem";
import { toDashboardView, type CardView, type DashboardView, type FeedRow } from "../../app/dashboard/view-model";
import type { Tone } from "../../app/receipt/view-model";
import type { DashboardJson } from "../../lib/dashboard-data";
import { Section } from "../receipt/ReceiptDocument";
import IntegrationPanel from "./IntegrationPanel";
import RetryPayoutButton from "./RetryPayoutButton";

const POLL_MS = 15_000;

const DOT: Record<Tone, string> = {
  pending: "bg-sky-500",
  warn: "bg-amber-500",
  good: "bg-emerald-500",
  bad: "bg-rose-500",
};

const BUTTON =
  "rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 transition hover:text-stone-900 disabled:text-stone-400";

function Eyebrow() {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Aria for publishers</p>;
}

function SignedOut({ onLogin, ready }: { onLogin: () => void; ready: boolean }) {
  return (
    <div className="space-y-8">
      <Eyebrow />
      <div className="space-y-3">
        <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Earn from the answers your AI app already gives.</h1>
        <p className="max-w-prose text-[15px] leading-relaxed text-stone-600">
          Aria adds one relevant sponsored line when a question shows buying intent. You earn for every verified impression
          and click, paid out automatically.
        </p>
      </div>
      <div className="space-y-3">
        <button
          type="button"
          onClick={onLogin}
          disabled={!ready}
          className="rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:bg-stone-300"
        >
          {ready ? "Sign in to Aria" : "Loading…"}
        </button>
        <p className="text-sm text-stone-500">We email you a one-time code. No password.</p>
      </div>
    </div>
  );
}

export default function Dashboard({ clearing }: { clearing: Address }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [registerError, setRegisterError] = useState<string | null>(null);

  const account = useMemo(() => {
    const linked = user?.linkedAccounts.find(
      (a): a is WalletWithMetadata =>
        a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum",
    );
    return linked ? getAddress(linked.address) : undefined;
  }, [user]);

  // Registers the signed-in account as the publisher that events are credited to.
  useEffect(() => {
    if (!account) return;
    fetch("/api/aria/publisher", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: account }),
    })
      .then((res) => setRegisterError(res.ok ? null : "Could not connect your account to Aria. Try again shortly."))
      .catch(() => setRegisterError("Could not connect your account to Aria. Try again shortly."));
  }, [account]);

  if (!ready || !authenticated) {
    return <SignedOut ready={ready} onLogin={() => login({ loginMethods: ["email"] })} />;
  }

  if (!account) {
    return (
      <div className="space-y-4">
        <Eyebrow />
        <p className="text-stone-600">Setting up your account…</p>
      </div>
    );
  }

  return (
    <PublisherPanel
      clearing={clearing}
      address={account}
      email={user?.email?.address}
      notice={registerError}
      onLogout={logout}
    />
  );
}

function Card({ card, primary }: { card: CardView; primary: boolean }) {
  return (
    <div className={`rounded-xl border px-5 py-4 ${primary ? "border-stone-300 bg-white" : "border-stone-200 bg-white/60"}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-stone-500">{card.label}</p>
      <p className={`mt-2 font-semibold tracking-tight tabular-nums text-stone-900 ${primary ? "text-[2.25rem] leading-tight" : "text-[1.625rem] leading-tight"}`}>{card.value}</p>
      <p className="mt-1 text-xs leading-relaxed text-stone-500">{card.hint}</p>
    </div>
  );
}

function Overview({ view }: { view: DashboardView | null }) {
  if (!view) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[7.5rem] animate-pulse rounded-xl border border-stone-200 bg-white/60" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {view.cards.map((card) => (
        <Card key={card.key} card={card} primary={card.key === "earnings"} />
      ))}
    </div>
  );
}

function Payouts({ view, clearing, onRetried }: { view: DashboardView | null; clearing: Address; onRetried: () => void }) {
  return (
    <Section title="Payouts">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-sm text-[15px] leading-relaxed text-stone-700">
          Paid automatically after each event is verified. No action needed.
        </p>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-stone-500">Balance</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums text-stone-900">{view ? view.balance : "…"}</p>
        </div>
      </div>
      {view?.retryAmount && (
        <div className="mt-4">
          <RetryPayoutButton clearing={clearing} amount={view.retryAmount} onDone={onRetried} />
        </div>
      )}
    </Section>
  );
}

function FeedItem({ row }: { row: FeedRow }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[row.tone]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-relaxed text-stone-800">{row.sentence}</p>
        <p className="text-xs text-stone-500">{row.when}</p>
      </div>
      <a
        href={row.receiptUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-0.5 shrink-0 text-sm text-stone-500 underline decoration-stone-300 underline-offset-4 transition hover:text-stone-900"
      >
        Proof<span className="sr-only"> for this event</span>
      </a>
    </li>
  );
}

function Activity({ view }: { view: DashboardView | null }) {
  return (
    <Section title="Activity" aside={view?.activity.aside}>
      {!view ? (
        <p className="text-sm text-stone-500">Loading activity…</p>
      ) : view.feed.length === 0 ? (
        <p className="text-sm text-stone-500">{view.activity.empty}</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {view.feed.map((row) => (
            <FeedItem key={row.eventId} row={row} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function AccountDetails({ view, email }: { view: DashboardView; email?: string }) {
  const { account } = view;
  const link = "font-mono underline decoration-stone-300 underline-offset-4 [overflow-wrap:anywhere] hover:text-stone-900";
  return (
    <details className="group border-t border-stone-200 pt-6 text-sm">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.14em] text-stone-500 hover:text-stone-900">
        Account details
      </summary>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-stone-600">
        {email && (
          <>
            <dt className="text-stone-500">Email</dt>
            <dd>{email}</dd>
          </>
        )}
        <dt className="text-stone-500">Payout address</dt>
        <dd>
          <a href={account.addressUrl} target="_blank" rel="noreferrer" className={link}>
            {account.address} ↗
          </a>
        </dd>
        <dt className="text-stone-500">Clearing contract</dt>
        <dd>
          <a href={account.clearingUrl} target="_blank" rel="noreferrer" className={link}>
            {account.clearing} ↗
          </a>
        </dd>
        <dt className="text-stone-500">Network</dt>
        <dd>Monad testnet · payouts in USDC</dd>
        <dt className="text-stone-500">Activity data</dt>
        <dd>{account.source}</dd>
        <dt className="text-stone-500">Native balance</dt>
        <dd className="font-mono">{account.mon} MON</dd>
        <dt className="text-stone-500">{account.blocksLabel}</dt>
        <dd className="font-mono">{account.blocks}</dd>
      </dl>
    </details>
  );
}

/** Earnings, payouts, activity and integration details for one publisher; polls the publisher route. */
export function PublisherPanel({
  clearing,
  address,
  email,
  notice,
  onLogout,
}: {
  clearing: Address;
  address: Address;
  email?: string;
  notice?: string | null;
  onLogout: () => void;
}) {
  const [data, setData] = useState<DashboardJson | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/aria/publisher?address=${address}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as DashboardJson);
      setFetchError(null);
    } catch {
      setFetchError("Could not load your latest numbers. Retrying shortly.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const view = useMemo(() => (data ? toDashboardView(data, Date.now() / 1000) : null), [data]);
  const error = notice ?? fetchError;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Eyebrow />
          <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Earnings</h1>
          {email && <p className="text-sm text-stone-500">{email}</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={refresh} disabled={loading} className={BUTTON}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={onLogout} className={BUTTON}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <Overview view={view} />
      <Payouts view={view} clearing={clearing} onRetried={refresh} />
      <Activity view={view} />
      <IntegrationPanel publisherId={view?.publisherId ?? null} />
      {view && <AccountDetails view={view} email={email} />}

      <footer className="space-y-1 border-t border-stone-200 pt-6 text-xs text-stone-500">
        <p>
          Every payout is verified by Chainlink and settled on Monad.{" "}
          {view?.latestReceiptUrl ? (
            <a
              href={view.latestReceiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
            >
              View any receipt.
            </a>
          ) : (
            "View any receipt from the activity feed."
          )}
        </p>
        <p>Amounts in USD.</p>
      </footer>
    </div>
  );
}
