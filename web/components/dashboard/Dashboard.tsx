"use client";

import type { EventStatus } from "@aria-clearing/receipt";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, type Address } from "viem";
import { STATUS } from "../../app/receipt/view-model";
import type { DashboardJson } from "../../lib/dashboard-data";
import { addressUrl, formatMon, formatUsdc, shortAddress, shortHash, txUrl } from "../../lib/format";
import { Section, StatusPill } from "../receipt/ReceiptDocument";
import ClaimButton from "./ClaimButton";

const POLL_MS = 15_000;

function Eyebrow() {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Aria · publisher</p>;
}

function Stat({ label, value, unit, primary }: { label: string; value: string; unit: string; primary?: boolean }) {
  return (
    <div className={`rounded-xl border px-5 py-4 ${primary ? "border-stone-300 bg-white" : "border-stone-200 bg-white/60"}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-stone-500">{label}</p>
      <p className={`mt-2 font-serif ${primary ? "text-4xl text-stone-900" : "text-2xl text-stone-800"}`}>
        {value} <span className="font-sans text-sm text-stone-500">{unit}</span>
      </p>
    </div>
  );
}

function SignedOut({ onLogin, ready }: { onLogin: () => void; ready: boolean }) {
  return (
    <div className="space-y-8">
      <Eyebrow />
      <div className="space-y-3">
        <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Get paid for verified sponsored answers.</h1>
        <p className="max-w-prose text-[15px] leading-relaxed text-stone-600">
          Log in with your email. A wallet is created for you; every impression and click your app serves is credited to
          it on Monad, and verified events become USDC you can claim.
        </p>
      </div>
      <button
        type="button"
        onClick={onLogin}
        disabled={!ready}
        className="rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:bg-stone-300"
      >
        {ready ? "Log in with email" : "Loading…"}
      </button>
    </div>
  );
}

export default function Dashboard({ clearing }: { clearing: Address }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [registerError, setRegisterError] = useState<string | null>(null);

  const wallet = useMemo(() => {
    const account = user?.linkedAccounts.find(
      (a): a is WalletWithMetadata =>
        a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum",
    );
    return account ? getAddress(account.address) : undefined;
  }, [user]);

  // Registers the embedded wallet as the publisher events are credited to.
  useEffect(() => {
    if (!wallet) return;
    fetch("/api/aria/publisher", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet }),
    })
      .then((res) => setRegisterError(res.ok ? null : "Could not register this wallet as the publisher"))
      .catch(() => setRegisterError("Could not register this wallet as the publisher"));
  }, [wallet]);

  if (!ready || !authenticated) {
    return <SignedOut ready={ready} onLogin={() => login({ loginMethods: ["email"] })} />;
  }

  if (!wallet) {
    return (
      <div className="space-y-4">
        <Eyebrow />
        <p className="text-stone-600">Creating your wallet…</p>
      </div>
    );
  }

  return (
    <PublisherPanel
      clearing={clearing}
      wallet={wallet}
      email={user?.email?.address}
      notice={registerError}
      onLogout={logout}
    />
  );
}

/** Balances, Claim and recent events for one publisher wallet; polls the publisher route. */
export function PublisherPanel({
  clearing,
  wallet,
  email,
  notice,
  onLogout,
}: {
  clearing: Address;
  wallet: Address;
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
      const res = await fetch(`/api/aria/publisher?address=${wallet}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as DashboardJson);
      setFetchError(null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const error = notice ?? fetchError;
  const claimable = data ? BigInt(data.claimable) : 0n;
  const mon = data ? BigInt(data.mon) : 0n;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Eyebrow />
          <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Publisher dashboard</h1>
          <p className="text-sm text-stone-500">
            {email && <span>{email} · </span>}
            <a
              href={addressUrl(wallet)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
              title={wallet}
            >
              {shortAddress(wallet)} ↗
            </a>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 disabled:text-stone-400"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-900"
          >
            Log out
          </button>
        </div>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <section className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Claimable" value={data ? formatUsdc(claimable) : "…"} unit="USDC" primary />
          <Stat label="In wallet" value={data ? formatUsdc(BigInt(data.usdc)) : "…"} unit="USDC" />
          <Stat label="Gas" value={data ? formatMon(mon) : "…"} unit="MON" />
        </div>
        <ClaimButton clearing={clearing} disabled={!data || claimable === 0n || mon === 0n} onClaimed={refresh} />
        {data && mon === 0n && (
          <p className="text-sm text-amber-800">
            Fund with testnet MON to claim: <span className="font-mono">{wallet}</span>
          </p>
        )}
      </section>

      <Section title="Recent events" aside={data ? `blocks ${data.fromBlock}–${data.toBlock}` : undefined}>
        {!data ? (
          <p className="text-sm text-stone-500">Reading Monad…</p>
        ) : data.events.length === 0 ? (
          <p className="text-sm text-stone-500">No events credited to this wallet in the last 2,000 blocks.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.events.map((event) => {
              const status = STATUS[event.status as EventStatus];
              return (
                <li key={event.eventId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                  <span className="w-20 font-medium text-stone-900">{event.kind}</span>
                  <a
                    href={`/receipt/${encodeURIComponent(event.requestId)}`}
                    className="w-full min-w-0 truncate font-mono text-xs sm:w-auto sm:flex-1 text-stone-600 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
                  >
                    {event.requestId}
                  </a>
                  <span className="text-stone-600">{formatUsdc(BigInt(event.price))} USDC</span>
                  <a
                    href={txUrl(event.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
                  >
                    {shortHash(event.txHash)} ↗
                  </a>
                  <StatusPill tone={status.tone} label={status.label} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <p className="text-xs text-stone-500">
        Contract{" "}
        <a
          href={addressUrl(clearing)}
          target="_blank"
          rel="noreferrer"
          className="font-mono underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
        >
          {shortAddress(clearing)}
        </a>{" "}
        · Monad testnet
      </p>
    </div>
  );
}
