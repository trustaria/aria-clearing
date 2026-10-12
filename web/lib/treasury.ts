import { privyErrorCode, sendFromWallet, type WalletTx } from "@aria-clearing/ops";
import { ariaClearingAbi, campaignIdOf, formatClaims } from "@aria-clearing/receipt";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  maxUint256,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { DISPUTE_WINDOW_S, publicClient } from "./chain";
import { deployment } from "./deployment";

/** Gas limits; Monad charges on the limit, so they are fixed and tight. */
export const LAUNCH_GAS = 400_000;
export const APPROVE_GAS = 150_000;
/** About 1.3× the Monad testnet estimate of 43,228. */
export const DISPUTE_GAS = 60_000;
/** About 1.3× the Monad testnet estimate of 124,139, for a treasury holding 0 USDC (the costliest case). */
export const WITHDRAW_GAS = 165_000;
const RECEIPT_TIMEOUT_MS = 60_000;

/** Amounts are USDC with 6 decimals. */
export type LaunchArgs = {
  slug: string;
  claims: string[];
  priceImpression: bigint;
  priceClick: bigint;
  budget: bigint;
};

export type LaunchResult = { campaignId: Hex; txHash: Hex; blockNumber: bigint };

export type TreasuryErrorCode =
  | "low-funds"
  | "campaign-exists"
  | "not-found"
  | "window-closed"
  | "already-disputed"
  | "failed";
export type LaunchErrorCode = TreasuryErrorCode;

/** A treasury action that did not happen. `available` is the treasury USDC balance for "low-funds". */
export class TreasuryError extends Error {
  constructor(
    readonly code: TreasuryErrorCode,
    message: string,
    readonly available?: bigint,
  ) {
    super(message);
    this.name = "TreasuryError";
  }
}

export { TreasuryError as LaunchError };

export type TreasuryDeps = {
  address: Address;
  walletId: string;
  clearing: Address;
  usdc: Address;
  client: Pick<PublicClient, "readContract" | "simulateContract" | "waitForTransactionReceipt">;
  send: (walletId: string, tx: WalletTx) => Promise<Hex>;
};

/** The treasury server wallet's address (TREASURY_ADDRESS). */
export function treasuryAddress(): Address {
  const address = process.env.TREASURY_ADDRESS;
  if (!address) throw new Error("TREASURY_ADDRESS is not set");
  return getAddress(address);
}

function treasuryWalletId(): string {
  const id = process.env.TREASURY_WALLET_ID;
  if (!id) throw new Error("TREASURY_WALLET_ID is not set");
  return id;
}

/** Live dependencies: Privy treasury wallet, Monad RPC, deployed clearing and USDC. */
export function treasuryDeps(): TreasuryDeps {
  const { clearing, usdc } = deployment();
  return {
    address: treasuryAddress(),
    walletId: treasuryWalletId(),
    clearing,
    usdc,
    client: publicClient(),
    send: sendFromWallet,
  };
}

/** USDC held by the treasury, 6 decimals. */
export async function treasuryUsdcBalance(deps: Pick<TreasuryDeps, "address" | "usdc" | "client"> = treasuryDeps()) {
  return deps.client.readContract({
    address: deps.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deps.address],
  });
}

/** Calldata for `createCampaign(keccak(slug), formatClaims(claims), priceImpression, priceClick, budget)`. */
export function createCampaignCalldata(args: LaunchArgs): Hex {
  return encodeFunctionData({
    abi: ariaClearingAbi,
    functionName: "createCampaign",
    args: [campaignIdOf(args.slug), formatClaims(args.claims), args.priceImpression, args.priceClick, args.budget],
  });
}

function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

function describe(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

async function sendAndWait(
  deps: TreasuryDeps,
  tx: WalletTx,
  label: string,
): Promise<{ hash: Hex; receipt: Pick<TransactionReceipt, "blockNumber" | "logs"> }> {
  let hash: Hex;
  try {
    hash = await deps.send(deps.walletId, tx);
  } catch (err) {
    console.error(`treasury ${label} send failed: ${privyErrorCode(err) ?? describe(err)}`);
    throw new TreasuryError("failed", `${label} send failed`);
  }
  const receipt = await deps.client
    .waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })
    .catch((err: unknown) => {
      console.error(`treasury ${label} receipt failed for ${hash}: ${describe(err)}`);
      throw new TreasuryError("failed", `${label} receipt failed`);
    });
  if (receipt.status !== "success") {
    console.error(`treasury ${label} reverted: ${hash}`);
    throw new TreasuryError("failed", `${label} reverted`);
  }
  return { hash, receipt };
}

async function launch(args: LaunchArgs, deps: TreasuryDeps): Promise<LaunchResult> {
  const balance = await treasuryUsdcBalance(deps);
  if (balance < args.budget) throw new TreasuryError("low-funds", "treasury balance below budget", balance);

  const allowance = await deps.client.readContract({
    address: deps.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [deps.address, deps.clearing],
  });
  if (allowance < args.budget) {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deps.clearing, maxUint256] });
    await sendAndWait(deps, { to: deps.usdc, data, gasLimit: APPROVE_GAS }, "approve");
  }

  const campaignId = campaignIdOf(args.slug);
  try {
    await deps.client.simulateContract({
      account: deps.address,
      address: deps.clearing,
      abi: ariaClearingAbi,
      functionName: "createCampaign",
      args: [campaignId, formatClaims(args.claims), args.priceImpression, args.priceClick, args.budget],
    });
  } catch (err) {
    if (revertName(err) === "CampaignExists") throw new TreasuryError("campaign-exists", "campaign id already used");
    console.error(`treasury createCampaign simulation failed: ${describe(err)}`);
    throw new TreasuryError("failed", "createCampaign simulation failed");
  }

  const data = createCampaignCalldata(args);
  const { hash, receipt } = await sendAndWait(
    deps,
    { to: deps.clearing, data, gasLimit: LAUNCH_GAS },
    "createCampaign",
  );
  return { campaignId, txHash: hash, blockNumber: receipt.blockNumber };
}

// One queue on globalThis, so balance checks, sends and receipt waits never interleave across route bundles.
const globalQueue = globalThis as typeof globalThis & { __ariaTreasuryQueue?: Promise<unknown> };

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const previous = globalQueue.__ariaTreasuryQueue ?? Promise.resolve();
  const result = previous.then(task);
  globalQueue.__ariaTreasuryQueue = result.catch(() => undefined);
  return result;
}

/**
 * Creates a campaign funded by the treasury: balance check, approve if the allowance is short, simulate,
 * then one `createCampaign` tx and its receipt. Rejects with a TreasuryError.
 */
export function launchCampaign(args: LaunchArgs, deps: TreasuryDeps = treasuryDeps()): Promise<LaunchResult> {
  return enqueue(() => launch(args, deps));
}

const STATUS_LOGGED = 1;
const STATUS_DISPUTED = 2;

export type DisputeClock = { window: number; now: () => number };

const liveClock: DisputeClock = { window: DISPUTE_WINDOW_S, now: Date.now };

/**
 * Disputes one of the campaign's events while its window is open: checks the event onchain, simulates,
 * then sends `dispute(eventId)` and waits for the receipt. Rejects with a TreasuryError.
 */
export async function disputeEvent(
  campaignId: Hex,
  eventId: Hex,
  deps: TreasuryDeps = treasuryDeps(),
  clock: DisputeClock = liveClock,
): Promise<{ txHash: Hex }> {
  const event = await deps.client.readContract({
    address: deps.clearing,
    abi: ariaClearingAbi,
    functionName: "clearingEvent",
    args: [eventId],
  });
  if (event.campaignId.toLowerCase() !== campaignId.toLowerCase()) {
    throw new TreasuryError("not-found", "event belongs to another campaign");
  }
  if (event.status === STATUS_DISPUTED) throw new TreasuryError("already-disputed", "event already disputed");
  const closesAt = Number(event.loggedAt) + clock.window;
  if (event.status !== STATUS_LOGGED || clock.now() / 1000 >= closesAt) {
    throw new TreasuryError("window-closed", "dispute window closed");
  }

  return enqueue(async () => {
    try {
      await deps.client.simulateContract({
        account: deps.address,
        address: deps.clearing,
        abi: ariaClearingAbi,
        functionName: "dispute",
        args: [eventId],
      });
    } catch (err) {
      if (revertName(err) === "NotDisputable") throw new TreasuryError("window-closed", "dispute window closed");
      console.error(`treasury dispute simulation failed: ${describe(err)}`);
      throw new TreasuryError("failed", "dispute simulation failed");
    }
    const data = encodeFunctionData({ abi: ariaClearingAbi, functionName: "dispute", args: [eventId] });
    const { hash } = await sendAndWait(deps, { to: deps.clearing, data, gasLimit: DISPUTE_GAS }, "dispute");
    return { txHash: hash };
  });
}

/** The amount of this campaign's `Withdrawn` log emitted by the clearing contract, or null without one. */
export function withdrawnAmount(logs: Log[], clearing: Address, campaignId: Hex): bigint | null {
  const match = parseEventLogs({ abi: ariaClearingAbi, eventName: "Withdrawn", logs }).find(
    (log) =>
      log.address.toLowerCase() === clearing.toLowerCase() &&
      log.args.campaignId.toLowerCase() === campaignId.toLowerCase(),
  );
  return match ? match.args.amount : null;
}

/**
 * Returns a campaign's unreserved budget to the treasury: simulates, then sends `withdraw(campaignId)` and
 * reads the amount from the `Withdrawn` log. Rejects with a TreasuryError.
 */
export function withdrawCampaign(
  campaignId: Hex,
  deps: TreasuryDeps = treasuryDeps(),
): Promise<{ amount: bigint; txHash: Hex }> {
  return enqueue(async () => {
    let simulated: bigint;
    try {
      const { result } = await deps.client.simulateContract({
        account: deps.address,
        address: deps.clearing,
        abi: ariaClearingAbi,
        functionName: "withdraw",
        args: [campaignId],
      });
      simulated = result;
    } catch (err) {
      console.error(`treasury withdraw simulation failed: ${describe(err)}`);
      throw new TreasuryError("failed", "withdraw simulation failed");
    }
    const data = encodeFunctionData({ abi: ariaClearingAbi, functionName: "withdraw", args: [campaignId] });
    const { hash, receipt } = await sendAndWait(deps, { to: deps.clearing, data, gasLimit: WITHDRAW_GAS }, "withdraw");
    return { amount: withdrawnAmount(receipt.logs, deps.clearing, campaignId) ?? simulated, txHash: hash };
  });
}
