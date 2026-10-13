import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { erc20Abi, type Address, type Hex } from "viem";
import { advertiserWallet, publicClient } from "./chain";
import { dataFile } from "./data-dir";
import { deployment } from "./deployment";
import { FALLBACK_GAS, withMargin } from "./wallet-gas";

/** Gas the test funds pay for: approve, createCampaign, two disputes and End. */
export const TEST_FUNDS_GAS =
  FALLBACK_GAS.approve + FALLBACK_GAS.createCampaign + 2n * FALLBACK_GAS.dispute + FALLBACK_GAS.withdraw;
/** A plain MON transfer to an externally owned account. */
const MON_TRANSFER_GAS = 21_000n;
const RECEIPT_TIMEOUT_MS = 60_000;

export type Amounts = { usdc: bigint; mon: bigint };

/** MON in wei that covers TEST_FUNDS_GAS at `feePerGas`. */
export function monTarget(feePerGas: bigint): bigint {
  return TEST_FUNDS_GAS * feePerGas;
}

/** What the wallet lacks to hold `need`. Pure. */
export function topUp(held: Amounts, need: Amounts): Amounts {
  const short = (have: bigint, want: bigint) => (want > have ? want - have : 0n);
  return { usdc: short(held.usdc, need.usdc), mon: short(held.mon, need.mon) };
}

/** One test funds transfer to an advertiser. Amounts are decimal strings (USDC 6 decimals, MON in wei). */
export type Grant = { at: number; wallet: Address; usdc: string; mon: string; usdcTx?: Hex | null; monTx?: Hex | null };

export type GrantStore = {
  count(userId: string): number;
  record(userId: string, grant: Grant): void;
};

/** Test funds grants per Privy user id, written through to a JSON file. */
export function createGrantStore(file: string): GrantStore {
  const data: { grants: Record<string, Grant[]> } = existsSync(file)
    ? { grants: (JSON.parse(readFileSync(file, "utf8")) as { grants?: Record<string, Grant[]> }).grants ?? {} }
    : { grants: {} };
  return {
    count: (userId) => data.grants[userId]?.length ?? 0,
    record(userId, grant) {
      (data.grants[userId] ??= []).push(grant);
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2));
      renameSync(tmp, file);
    },
  };
}

// One store per file on globalThis, so every route bundle shares it.
const globalGrants = globalThis as typeof globalThis & { __ariaGrantStores?: Map<string, GrantStore> };
const grantStores = (globalGrants.__ariaGrantStores ??= new Map<string, GrantStore>());

/** The app's grant store: `test-funds.json` in the data dir. */
export function testFundsGrants(): GrantStore {
  const file = dataFile("test-funds.json");
  let store = grantStores.get(file);
  if (!store) {
    store = createGrantStore(file);
    grantStores.set(file, store);
  }
  return store;
}

/** USDC (6 decimals) and MON (wei) held by `wallet`. */
export async function walletBalances(wallet: Address): Promise<Amounts> {
  const client = publicClient();
  const [usdc, mon] = await Promise.all([
    client.readContract({ address: deployment().usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    client.getBalance({ address: wallet }),
  ]);
  return { usdc, mon };
}

/** USDC held by the deployer key that sends test funds. */
export async function testFundsSourceUsdc(): Promise<bigint> {
  return (await walletBalances(advertiserWallet().account.address)).usdc;
}

/** The current max fee per gas, in wei. */
export async function currentFeePerGas(): Promise<bigint> {
  const fees = await publicClient().estimateFeesPerGas();
  return fees.maxFeePerGas;
}

async function mined(hash: Hex): Promise<Hex> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  if (receipt.status !== "success") throw new Error(`test funds transfer reverted: ${hash}`);
  return hash;
}

// One queue on globalThis, so transfers from the deployer key never interleave across route bundles.
const globalQueue = globalThis as typeof globalThis & { __ariaTestFundsQueue?: Promise<unknown> };

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const previous = globalQueue.__ariaTestFundsQueue ?? Promise.resolve();
  const result = previous.then(task);
  globalQueue.__ariaTestFundsQueue = result.catch(() => undefined);
  return result;
}

/** Sends test USDC (gas: estimate + 20 %) and MON (21,000 gas) from the deployer key, each waited for. */
export function sendTestFunds(to: Address, amounts: Amounts): Promise<{ usdcTx: Hex | null; monTx: Hex | null }> {
  return enqueue(async () => {
    const wallet = advertiserWallet();
    const { usdc } = deployment();
    let usdcTx: Hex | null = null;
    let monTx: Hex | null = null;
    if (amounts.usdc > 0n) {
      const args = [to, amounts.usdc] as const;
      const estimate = await publicClient().estimateContractGas({
        account: wallet.account,
        address: usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args,
      });
      usdcTx = await mined(
        await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "transfer", args, gas: withMargin(estimate) }),
      );
    }
    if (amounts.mon > 0n) {
      monTx = await mined(await wallet.sendTransaction({ to, value: amounts.mon, gas: MON_TRANSFER_GAS }));
    }
    return { usdcTx, monTx };
  });
}
