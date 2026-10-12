import { verifyReceipt, type Receipt } from "@aria-clearing/receipt";
import { deployment } from "../../lib/deployment";

export type ReceiptResult =
  | { state: "found"; receipt: Receipt; contract: string }
  | { state: "missing"; contract: string }
  | { state: "error"; message: string; contract: string };

const NOT_FOUND = "No event found on chain";
/** How long a result is reused: final receipts never change, pending ones are re-read soon. */
const TTL_MS = { final: 10 * 60_000, pending: 3_000, missing: 2_000, error: 0 };
const MAX_ENTRIES = 500;

const cache = new Map<string, { expires: number; result: Promise<ReceiptResult> }>();

function isFinal(receipt: Receipt): boolean {
  return receipt.events.every((e) => e.status === "released" || e.status === "rejected");
}

async function read(requestId: string): Promise<ReceiptResult> {
  const { clearing, deployBlock, rpcUrl } = deployment();
  try {
    const receipt = await verifyReceipt(requestId, { rpcUrl, address: clearing, fromBlock: deployBlock });
    return { state: "found", receipt, contract: clearing };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(NOT_FOUND)) return { state: "missing", contract: clearing };
    return { state: "error", message, contract: clearing };
  }
}

function ttlOf(result: ReceiptResult): number {
  if (result.state === "found") return isFinal(result.receipt) ? TTL_MS.final : TTL_MS.pending;
  return TTL_MS[result.state];
}

/** Reads a receipt from chain, sharing in-flight reads and reusing recent results per requestId. */
export function loadReceipt(requestId: string): Promise<ReceiptResult> {
  const now = Date.now();
  const hit = cache.get(requestId);
  if (hit && hit.expires > now) return hit.result;

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  const result = read(requestId);
  // Held until the read settles, then kept for its TTL.
  cache.set(requestId, { expires: Number.POSITIVE_INFINITY, result });
  result.then((settled) => {
    cache.set(requestId, { expires: Date.now() + ttlOf(settled), result });
  });
  return result;
}
