"use client";

import { useState } from "react";
import { formatMon, formatUsdc, txUrl } from "../../lib/format";
import { fundingChecks, launchBusy, type Balances, type LaunchState, type TestFundsState } from "./funding";
import { dollars } from "./rules";
import { LINK, PRIMARY, SECONDARY, SMALL_BUTTON } from "./ui";

const UNITS_PER_CENT = 10_000n;
const MON_FAUCET = "https://faucet.monad.xyz";
const USDC_FAUCET = "https://faucet.circle.com";

export type FundingPanelProps = {
  budgetCents: number;
  /** The advertiser's embedded wallet; null until it is known. */
  address: string | null;
  /** null while loading. */
  balances: Balances | null;
  /** MON wei the remaining launch transactions need; null until estimated. */
  monNeeded: bigint | null;
  checking: boolean;
  testFunds: TestFundsState;
  launch: LaunchState;
  onAddTestFunds: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
  onLaunch: () => void;
};

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={SMALL_BUTTON}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(address)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function BalanceLine({ label, held, needed, ok }: { label: string; held: string; needed: string; ok: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <span className="text-sm text-stone-600">{label}</span>
      <span className="flex items-baseline gap-3 text-sm">
        <span className="font-mono text-stone-900">
          {held} / {needed}
        </span>
        {ok ? (
          <span className="text-emerald-700" aria-label="enough">
            ✓
          </span>
        ) : (
          <span className="font-medium text-amber-700">Top up</span>
        )}
      </span>
    </li>
  );
}

function Step({ done, active, children }: { done: boolean; active: boolean; children: React.ReactNode }) {
  if (!done && !active) return null;
  return (
    <li className={`flex items-center gap-2 text-sm ${done ? "text-stone-700" : "text-stone-900"}`}>
      <span aria-hidden className={`w-3 text-center text-xs ${done ? "text-emerald-700" : "animate-pulse text-stone-900"}`}>
        {done ? "✓" : "●"}
      </span>
      {children}
    </li>
  );
}

function Progress({ launch, amount }: { launch: LaunchState; amount: string }) {
  const order = ["preparing", "approving", "escrow", "confirming", "live"];
  const at = order.indexOf(launch.phase);
  if (at < 1) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      <ul className="space-y-1.5">
        {launch.approved && (
          <Step done={at > 1} active={at === 1}>
            {at > 1 ? `Approved ${amount} USDC` : `Approving ${amount} USDC…`}
          </Step>
        )}
        <Step done={at > 2} active={at === 2}>
          {at > 2 ? `${amount} moved into escrow` : `Moving ${amount} into escrow…`}
        </Step>
        <Step done={at > 3} active={at === 3}>
          {at > 3 ? "Available to AI answers" : "Making it available to AI answers…"}
        </Step>
      </ul>
      {launch.txHash && (
        <a href={txUrl(launch.txHash)} target="_blank" rel="noreferrer" className={LINK}>
          View the escrow transaction on MonadVision
        </a>
      )}
    </div>
  );
}

/** The advertiser's campaign wallet: address, balances against the launch needs, test funds and launch progress. */
export default function FundingPanel(props: FundingPanelProps) {
  const { budgetCents, address, balances, monNeeded, checking, testFunds, launch } = props;
  const budget = BigInt(budgetCents) * UNITS_PER_CENT;
  const checks = fundingChecks(balances, budget, monNeeded);
  const busy = launchBusy(launch);
  const amount = dollars(budgetCents);

  return (
    <div className="space-y-5 rounded-xl border border-stone-300 bg-stone-50 px-5 py-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Fund your campaign wallet</p>
        <p className="text-[15px] leading-relaxed text-stone-800">
          Your {amount} budget moves from this wallet into escrow when you launch.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <code className="min-w-0 break-all rounded-md bg-white px-2 py-1 font-mono text-[13px] text-stone-900">
          {address ?? "Loading your wallet…"}
        </code>
        {address && <CopyAddress address={address} />}
      </div>

      <ul className="divide-y divide-stone-200 border-y border-stone-200">
        <BalanceLine
          label="USDC"
          held={balances ? `$${formatUsdc(balances.usdc)}` : "…"}
          needed={amount}
          ok={checks.usdcOk}
        />
        <BalanceLine
          label="MON for network fees"
          held={balances ? formatMon(balances.mon) : "…"}
          needed={monNeeded === null ? "…" : formatMon(monNeeded)}
          ok={checks.monOk}
        />
      </ul>

      <div className="space-y-2">
        <p className="text-sm text-stone-700">This is a test network: Aria adds test funds for you.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={SMALL_BUTTON}
            onClick={props.onAddTestFunds}
            disabled={testFunds.phase === "sending" || busy || checks.ready}
          >
            {testFunds.phase === "sending" ? "Adding test funds…" : "Add test funds"}
          </button>
          <button type="button" className={SMALL_BUTTON} onClick={props.onCheckAgain} disabled={checking}>
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
        {testFunds.phase === "sent" && !checks.ready && (
          <p className="text-sm text-stone-600">Test funds sent. Balances update in a few seconds.</p>
        )}
        {testFunds.phase === "error" && (
          <p role="alert" className="text-sm text-rose-700">
            {testFunds.message}
          </p>
        )}
        <p className="text-xs text-stone-500">
          Or top up yourself:{" "}
          <a href={MON_FAUCET} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Monad faucet
          </a>{" "}
          ·{" "}
          <a href={USDC_FAUCET} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Circle USDC faucet
          </a>
        </p>
      </div>

      <p className="text-sm text-stone-500">
        In production, an onramp provider funds this wallet from a card payment, so you won&apos;t see this step.
      </p>

      {launch.phase === "error" && launch.error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {launch.error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5">
        <button type="button" onClick={props.onBack} disabled={busy} className={SECONDARY}>
          Back
        </button>
        <button type="button" onClick={props.onLaunch} disabled={busy || !(checks.ready || launch.unconfirmed)} aria-busy={busy} className={PRIMARY}>
          Launch
        </button>
      </div>

      <Progress launch={launch} amount={amount} />
    </div>
  );
}
