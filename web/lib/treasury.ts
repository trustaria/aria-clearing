import { privyErrorCode, sendFromWallet, type WalletTx } from "@aria-clearing/ops";
import { ariaClearingAbi, campaignIdOf, formatClaims } from "@aria-clearing/receipt";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { publicClient } from "./chain";
import { deployment } from "./deployment";

/** Gas limits; Monad charges on the limit, so they are fixed and tight. */
export const LAUNCH_GAS = 400_000;
export const APPROVE_GAS = 150_000;
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

export type LaunchErrorCode = "low-funds" | "campaign-exists" | "failed";

/** A launch that did not create a campaign. `available` is the treasury USDC balance for "low-funds". */
export class LaunchError extends Error {
  constructor(
    readonly code: LaunchErrorCode,
    message: string,
    readonly available?: bigint,
  ) {
    super(message);
    this.name = "LaunchError";
  }
}

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
): Promise<{ hash: Hex; blockNumber: bigint }> {
  let hash: Hex;
  try {
    hash = await deps.send(deps.walletId, tx);
  } catch (err) {
    console.error(`treasury ${label} send failed: ${privyErrorCode(err) ?? describe(err)}`);
    throw new LaunchError("failed", `${label} send failed`);
  }
  const receipt = await deps.client
    .waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })
    .catch((err: unknown) => {
      console.error(`treasury ${label} receipt failed for ${hash}: ${describe(err)}`);
      throw new LaunchError("failed", `${label} receipt failed`);
    });
  if (receipt.status !== "success") {
    console.error(`treasury ${label} reverted: ${hash}`);
    throw new LaunchError("failed", `${label} reverted`);
  }
  return { hash, blockNumber: receipt.blockNumber };
}

async function launch(args: LaunchArgs, deps: TreasuryDeps): Promise<LaunchResult> {
  const balance = await treasuryUsdcBalance(deps);
  if (balance < args.budget) throw new LaunchError("low-funds", "treasury balance below budget", balance);

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
    if (revertName(err) === "CampaignExists") throw new LaunchError("campaign-exists", "campaign id already used");
    console.error(`treasury createCampaign simulation failed: ${describe(err)}`);
    throw new LaunchError("failed", "createCampaign simulation failed");
  }

  const data = createCampaignCalldata(args);
  const { hash, blockNumber } = await sendAndWait(
    deps,
    { to: deps.clearing, data, gasLimit: LAUNCH_GAS },
    "createCampaign",
  );
  return { campaignId, txHash: hash, blockNumber };
}

// One queue on globalThis, so balance checks, sends and receipt waits never interleave across route bundles.
const globalQueue = globalThis as typeof globalThis & { __ariaTreasuryQueue?: Promise<unknown> };

/**
 * Creates a campaign funded by the treasury: balance check, approve if the allowance is short, simulate,
 * then one `createCampaign` tx and its receipt. Rejects with a LaunchError.
 */
export function launchCampaign(args: LaunchArgs, deps: TreasuryDeps = treasuryDeps()): Promise<LaunchResult> {
  const previous = globalQueue.__ariaTreasuryQueue ?? Promise.resolve();
  const result = previous.then(() => launch(args, deps));
  globalQueue.__ariaTreasuryQueue = result.catch(() => undefined);
  return result;
}
