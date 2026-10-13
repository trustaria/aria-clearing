import { createPublicClient, createWalletClient, http, type Hex, type HttpTransportConfig, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import deployment from "../../deployments/10143.json";

/** Seconds after logging during which the advertiser may dispute an event. */
export const DISPUTE_WINDOW_S = deployment.disputeWindow;

export function clearingAddress(): Hex {
  return (process.env.NEXT_PUBLIC_CLEARING_ADDRESS || deployment.address) as Hex;
}

/** HTTP transport whose requests skip Next's fetch cache, so chain reads are always fresh. */
export function rpcTransport(url: string, options: Omit<HttpTransportConfig, "fetchOptions"> = {}) {
  return http(url, { ...options, fetchOptions: { cache: "no-store" } });
}

function transport() {
  return rpcTransport(process.env.MONAD_TESTNET_RPC_URL || monadTestnet.rpcUrls.default.http[0]);
}

let reader: PublicClient | undefined;

export function publicClient(): PublicClient {
  reader ??= createPublicClient({ chain: monadTestnet, transport: transport() }) as PublicClient;
  return reader;
}

/** Waits for a mined tx and returns its status. */
export async function receiptStatus(hash: Hex): Promise<"success" | "reverted"> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  return receipt.status;
}

/** Wallet of the seed advertiser (DEPLOYER_PRIVATE_KEY); demo only. */
export function advertiserWallet() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  return createWalletClient({ account, chain: monadTestnet, transport: transport() });
}
