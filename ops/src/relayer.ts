import { APIError } from "@privy-io/node";
import { requireEnv } from "./env";
import { MONAD_TESTNET_CAIP2, MONAD_TESTNET_CHAIN_ID, normalizeAddress } from "./policy";
import { authorizationContext, privyClient } from "./privy";

type Hex = `0x${string}`;

export type RelayerTx = { to: string; data: Hex; gasLimit: bigint | number };

// Sends from this process run one at a time, so nonces are assigned in order.
let queue: Promise<unknown> = Promise.resolve();

/** Public address of the relayer server wallet. */
export function relayerAddress(): Hex {
  return requireEnv(["RELAYER_ADDRESS"]).RELAYER_ADDRESS as Hex;
}

async function send({ to, data, gasLimit }: RelayerTx): Promise<Hex> {
  const { RELAYER_WALLET_ID } = requireEnv(["RELAYER_WALLET_ID"]);
  const response = await privyClient().wallets().ethereum().sendTransaction(RELAYER_WALLET_ID, {
    caip2: MONAD_TESTNET_CAIP2,
    authorization_context: authorizationContext(),
    params: {
      transaction: {
        to: normalizeAddress(to),
        data,
        value: "0x0",
        chain_id: MONAD_TESTNET_CHAIN_ID,
        gas_limit: `0x${BigInt(gasLimit).toString(16)}`,
      },
    },
  });
  return response.hash as Hex;
}

/** Privy's error code from a failed request, e.g. `policy_violation` or `transaction_broadcast_failure`. */
export function privyErrorCode(err: unknown): string | undefined {
  if (!(err instanceof APIError)) return undefined;
  const body = err.error as { code?: unknown } | undefined;
  return typeof body?.code === "string" ? body.code : undefined;
}

/** Sends a zero-value contract call from the relayer on Monad testnet and returns the tx hash. */
export function sendFromRelayer(tx: RelayerTx): Promise<Hex> {
  const result = queue.then(() => send(tx));
  queue = result.catch(() => undefined);
  return result;
}
