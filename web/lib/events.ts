import { privyErrorCode } from "@aria-clearing/ops";
import { eventIdOf, Kind } from "@aria-clearing/receipt";
import type { Hex } from "viem";
import { receiptStatus } from "./chain";
import { publisherStore } from "./publisher";
import { sendLogEvent } from "./relayer";
import { getServed } from "./served";
import { eventStore, type EventKind, type EventRecord, type Evidence } from "./store";

export type SubmitInput = {
  requestId: string;
  kind: EventKind;
  evidence: Partial<Evidence>;
  forged?: boolean;
};

export type SubmitResult =
  | { ok: false; status: 404 | 409; error: string }
  | { ok: true; created: boolean; record: EventRecord; done: Promise<EventRecord> };

export const NO_PUBLISHER = "No publisher address: log in on the dashboard or set PUBLISHER_ADDRESS.";

export function eventIdFor(requestId: string, kind: EventKind): Hex {
  return eventIdOf(requestId, kind === "click" ? Kind.Click : Kind.Impression);
}

function describeError(err: unknown): string {
  const code = privyErrorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  return (code ? `${code}: ${message}` : message).slice(0, 300);
}

/** Marks a logged event failed when its tx reverts onchain. */
async function confirm(eventId: Hex, hash: Hex): Promise<void> {
  try {
    if ((await receiptStatus(hash)) === "reverted") {
      eventStore().updateEvent(eventId, { status: "failed", error: "logEvent reverted onchain" });
    }
  } catch (err) {
    console.warn(`receipt check failed for ${hash}: ${(err as Error).message}`);
  }
}

/**
 * Records an event for a served card and logs it onchain from the relayer.
 * The queued record is stored before any await, so a concurrent duplicate sees it and sends nothing.
 */
export function submitEvent(input: SubmitInput): SubmitResult {
  const pick = getServed(input.requestId);
  if (!pick) return { ok: false, status: 404, error: "Unknown requestId" };
  const publisher = publisherStore.get();
  if (!publisher) return { ok: false, status: 409, error: NO_PUBLISHER };

  const store = eventStore();
  const now = Date.now();
  const eventId = eventIdFor(input.requestId, input.kind);
  const { record, created } = store.claimEvent({
    eventId,
    requestId: input.requestId,
    kind: input.kind,
    campaignId: pick.campaignId,
    publisher,
    evidence: {
      viewMs: input.evidence.viewMs ?? 0,
      visibleRatio: input.evidence.visibleRatio ?? 0,
      clickRedirected: input.evidence.clickRedirected ?? false,
      firstSeenAt: input.evidence.firstSeenAt ?? new Date(now).toISOString(),
    },
    forged: input.forged ?? false,
    status: "queued",
    createdAt: now,
  });
  if (!created) return { ok: true, created, record, done: Promise.resolve(record) };

  const done = sendLogEvent({
    requestId: pick.requestId,
    campaignId: pick.campaignId,
    publisher,
    kind: input.kind === "click" ? Kind.Click : Kind.Impression,
    rationale: pick.rationale,
    claimRefs: pick.claimRefs,
  }).then(
    (txHash) => {
      const logged = store.updateEvent(eventId, { status: "logged", txHash, loggedAt: Date.now() });
      void confirm(eventId, txHash);
      return logged;
    },
    (err) => {
      console.warn(`logEvent failed for ${input.requestId} (${input.kind}): ${describeError(err)}`);
      return store.updateEvent(eventId, { status: "failed", error: describeError(err) });
    },
  );
  return { ok: true, created, record, done };
}
