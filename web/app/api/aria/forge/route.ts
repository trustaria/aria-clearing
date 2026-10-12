import { eventIdFor, submitEvent } from "@/lib/events";
import { eventStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demo of a dishonest publisher: logs an impression for a served card that was never viewed
 * (viewMs 0, visibleRatio 0). Targets the given requestId, else the newest card with no impression.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { requestId?: unknown } | null;
  const store = eventStore();
  const unviewed = (requestId: string) => !store.getEvent(eventIdFor(requestId, "impression"));

  const requestId =
    typeof body?.requestId === "string"
      ? body.requestId
      : store
          .listServed()
          .reverse()
          .find((pick) => unviewed(pick.requestId))?.requestId;
  if (!requestId) {
    return Response.json(
      { error: "No unviewed card: tick 'Hold views', ask a new question, then forge." },
      { status: 409 },
    );
  }
  if (!unviewed(requestId)) {
    return Response.json({ error: `${requestId} already has an impression; forging needs a fresh card.` }, { status: 409 });
  }

  const result = submitEvent({ requestId, kind: "impression", evidence: { viewMs: 0, visibleRatio: 0 }, forged: true });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  const event = await result.done;
  return Response.json(
    { requestId, eventId: event.eventId, txHash: event.txHash ?? null, status: event.status, error: event.error },
    { status: event.status === "failed" ? 502 : 200 },
  );
}
