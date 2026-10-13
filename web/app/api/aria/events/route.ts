import { requireDemoKey } from "@/lib/demo-key";
import { submitEvent } from "@/lib/events";
import { isRequestId } from "@/lib/request-id";
import { eventStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImpressionBody = { requestId: string; kind: "impression"; viewMs: number; visibleRatio: number };

function parseBody(body: unknown): ImpressionBody | string {
  const { requestId, kind, viewMs, visibleRatio } = (body ?? {}) as Record<string, unknown>;
  if (typeof requestId !== "string") return "requestId is required";
  if (kind !== "impression") return 'kind must be "impression" (clicks go through /api/aria/click)';
  if (typeof viewMs !== "number" || !Number.isFinite(viewMs) || viewMs < 0) return "viewMs must be a number >= 0";
  if (typeof visibleRatio !== "number" || !(visibleRatio >= 0 && visibleRatio <= 1)) {
    return "visibleRatio must be between 0 and 1";
  }
  return { requestId, kind, viewMs: Math.round(viewMs), visibleRatio };
}

/** Records an impression for a served card and logs it onchain; a duplicate returns the stored event. */
export async function POST(req: Request) {
  const parsed = parseBody(await req.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });
  if (!isRequestId(parsed.requestId)) return Response.json({ error: "Unknown requestId" }, { status: 404 });

  const result = submitEvent({
    requestId: parsed.requestId,
    kind: "impression",
    evidence: {
      viewMs: parsed.viewMs,
      visibleRatio: parsed.visibleRatio,
      firstSeenAt: new Date(Date.now() - parsed.viewMs).toISOString(),
    },
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  const event = await result.done;
  const body = {
    eventId: event.eventId,
    txHash: event.txHash ?? null,
    status: event.status,
    duplicate: !result.created,
    ...(event.error && { error: event.error }),
  };
  return Response.json(body, { status: event.status === "failed" ? 502 : 200 });
}

/** Recent events and served cards, newest first, for the debug bar. */
export async function GET(req: Request) {
  const denied = requireDemoKey(req);
  if (denied) return denied;
  const store = eventStore();
  return Response.json(
    {
      events: store.listEvents().reverse().slice(0, 20),
      served: store.listServed().reverse().slice(0, 10),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
