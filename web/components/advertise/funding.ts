import type { ConfirmResult, FundingMode, PrepareResult, Prepared, WalletInfo } from "../../lib/advertise-client";
import { dollars, launchErrorCopy } from "./rules";

/** USDC units (6 decimals) and MON wei held by the advertiser's wallet. */
export type Balances = { usdc: bigint; mon: bigint };

/** True in wallet mode until the server reports the advertiser's wallet; Privy creates a new user's wallet shortly after sign-in. */
export function walletPending(funding: FundingMode, wallet: WalletInfo | null): boolean {
  return funding === "wallet" && !wallet?.address;
}

export type TestFundsState = { phase: "idle" } | { phase: "sending" } | { phase: "sent" } | { phase: "error"; message: string };

export const APPROVE_FAILED = (amount: string) => `We couldn't approve ${amount}. Nothing was charged. Try again.`;
export const ESCROW_FAILED = (amount: string) => `We couldn't move ${amount} into escrow. Nothing was charged. Try again.`;
export const CONFIRM_PENDING =
  "Your budget is in escrow, but we couldn't confirm your campaign yet. Press Launch to check again.";

/** Whether the wallet holds the budget (USDC units) and the gas fee (MON wei). Pure. */
export function fundingChecks(balances: Balances | null, budget: bigint, monNeeded: bigint | null) {
  const usdcOk = balances !== null && balances.usdc >= budget;
  const monOk = balances !== null && monNeeded !== null && balances.mon >= monNeeded;
  return { usdcOk, monOk, ready: usdcOk && monOk };
}

/** A createCampaign transaction that went through but is not confirmed by the server yet. */
export type Unconfirmed = { slug: string; txHash: string };

export type LaunchState = {
  phase: "idle" | "preparing" | "approving" | "escrow" | "confirming" | "live" | "error";
  /** True when this run sent an approve. */
  approved: boolean;
  slug?: string;
  txHash?: string;
  error?: string;
  unconfirmed?: Unconfirmed;
};

export type LaunchEvent =
  | { type: "start" }
  | { type: "approving" }
  | { type: "escrow" }
  | { type: "confirming"; slug: string; txHash: string }
  | { type: "live"; slug: string; txHash: string }
  | { type: "failed"; message: string; unconfirmed?: Unconfirmed };

export const IDLE_LAUNCH: LaunchState = { phase: "idle", approved: false };

/** True while a launch is in flight or done. */
export function launchBusy(state: LaunchState): boolean {
  return state.phase !== "idle" && state.phase !== "error";
}

/** Applies one launch step. Pure. */
export function reduceLaunch(state: LaunchState, event: LaunchEvent): LaunchState {
  switch (event.type) {
    case "start":
      return { phase: "preparing", approved: false };
    case "approving":
      return { ...state, phase: "approving", approved: true };
    case "escrow":
      return { ...state, phase: "escrow" };
    case "confirming":
      return { ...state, phase: "confirming", slug: event.slug, txHash: event.txHash };
    case "live":
      return { ...state, phase: "live", slug: event.slug, txHash: event.txHash, error: undefined, unconfirmed: undefined };
    case "failed":
      return { ...state, phase: "error", error: event.message, unconfirmed: event.unconfirmed };
  }
}

/** What a wallet launch needs: the server calls and the wallet's sends, each resolving once mined. */
export type LaunchOps = {
  prepare(): Promise<PrepareResult>;
  /** USDC the clearing contract may pull from the wallet, in USDC units. */
  allowance(prepared: Prepared): Promise<bigint>;
  approve(prepared: Prepared): Promise<string>;
  createCampaign(prepared: Prepared): Promise<string>;
  confirm(slug: string, txHash: string): Promise<ConfirmResult>;
};

async function confirmLaunch(
  ops: LaunchOps,
  dispatch: (event: LaunchEvent) => void,
  sent: Unconfirmed,
): Promise<string | null> {
  dispatch({ type: "confirming", ...sent });
  const result = await ops.confirm(sent.slug, sent.txHash).catch((): ConfirmResult => ({ error: "" }));
  if ("error" in result) {
    dispatch({ type: "failed", message: result.error || CONFIRM_PENDING, unconfirmed: sent });
    return null;
  }
  dispatch({ type: "live", slug: sent.slug, txHash: sent.txHash });
  return sent.slug;
}

/**
 * Launches from the advertiser's wallet: prepare, approve when the allowance is short, createCampaign, then the
 * server's confirmation. With `resume`, only the confirmation runs again. Returns the slug once live, else null.
 */
export async function runWalletLaunch(
  ops: LaunchOps,
  dispatch: (event: LaunchEvent) => void,
  budgetCents: number,
  resume?: Unconfirmed,
): Promise<string | null> {
  dispatch({ type: "start" });
  if (resume) return confirmLaunch(ops, dispatch, resume);

  const amount = dollars(budgetCents);
  const prepared = await ops.prepare().catch((): PrepareResult => ({ error: "" }));
  if ("error" in prepared) {
    dispatch({ type: "failed", message: launchErrorCopy(prepared.error) });
    return null;
  }

  try {
    if ((await ops.allowance(prepared)) < BigInt(prepared.budget)) {
      dispatch({ type: "approving" });
      await ops.approve(prepared);
    }
  } catch {
    dispatch({ type: "failed", message: APPROVE_FAILED(amount) });
    return null;
  }

  let txHash: string;
  try {
    dispatch({ type: "escrow" });
    txHash = await ops.createCampaign(prepared);
  } catch {
    dispatch({ type: "failed", message: ESCROW_FAILED(amount) });
    return null;
  }
  return confirmLaunch(ops, dispatch, { slug: prepared.slug, txHash });
}
