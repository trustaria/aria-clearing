import { ariaClearingAbi } from "@aria-clearing/receipt";
import { BaseError, type Hex } from "viem";
import { advertiserWallet, clearingAddress, DISPUTE_WINDOW_S, publicClient } from "@/lib/chain";
import { eventStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function message(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Demo only: the seed advertiser (DEPLOYER_PRIVATE_KEY) disputes an event inside its window.
 * Targets the given eventId, else the newest logged, undisputed event still inside the window.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { eventId?: unknown } | null;
  const store = eventStore();
  const cutoff = Date.now() - DISPUTE_WINDOW_S * 1000;

  const eventId =
    typeof body?.eventId === "string"
      ? (body.eventId as Hex)
      : store
          .listEvents()
          .reverse()
          .find((e) => e.status === "logged" && !e.disputeTxHash && (e.loggedAt ?? 0) > cutoff)?.eventId;
  if (!eventId) {
    return Response.json(
      { error: `No event logged in the last ${DISPUTE_WINDOW_S} s to dispute.` },
      { status: 409 },
    );
  }

  try {
    const wallet = advertiserWallet();
    const { request } = await publicClient().simulateContract({
      account: wallet.account,
      address: clearingAddress(),
      abi: ariaClearingAbi,
      functionName: "dispute",
      args: [eventId],
    });
    const txHash = await wallet.writeContract(request);
    if (store.getEvent(eventId)) store.updateEvent(eventId, { disputeTxHash: txHash });
    return Response.json({ eventId, txHash });
  } catch (err) {
    return Response.json({ eventId, error: message(err) }, { status: 502 });
  }
}
