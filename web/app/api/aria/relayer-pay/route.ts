import { MONAD_TESTNET_CAIP2, MONAD_TESTNET_CHAIN_ID, privyErrorCode } from "@aria-clearing/ops";
import { authorizationContext, privyClient } from "@aria-clearing/ops/src/privy";
import { publisherStore } from "@/lib/publisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 0.001 MON in wei.
const AMOUNT_WEI = "0x38d7ea4c68000";

/** The relayer tries to send 0.001 MON to the publisher; its Privy policy only allows logEvent. */
export async function POST() {
  const publisher = publisherStore.get();
  if (!publisher) return Response.json({ error: "No publisher address to pay." }, { status: 409 });
  const walletId = process.env.RELAYER_WALLET_ID;
  if (!walletId) return Response.json({ error: "RELAYER_WALLET_ID is not set" }, { status: 500 });

  try {
    const sent = await privyClient().wallets().ethereum().sendTransaction(walletId, {
      caip2: MONAD_TESTNET_CAIP2,
      authorization_context: authorizationContext(),
      params: { transaction: { to: publisher, value: AMOUNT_WEI, chain_id: MONAD_TESTNET_CHAIN_ID } },
    });
    return Response.json({ denied: false, to: publisher, txHash: sent.hash });
  } catch (err) {
    const code = privyErrorCode(err);
    if (code === "policy_violation") {
      return Response.json({ denied: true, code, to: publisher, message: "Denied by Privy policy" });
    }
    const detail = code ?? (err instanceof Error ? err.message : String(err));
    return Response.json({ denied: false, error: `send failed: ${detail}` }, { status: 502 });
  }
}
