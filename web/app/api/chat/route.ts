import { allCampaigns, campaignBySlug } from "@/lib/campaigns";
import { activeModel, streamTurn, type ChatFrame, type ChatMessage } from "@/lib/kimi";
import type { Pick } from "@/lib/pick";
import { buildCard, chainConfig } from "@/lib/receipt";
import { newRequestId } from "@/lib/request-id";
import { rememberServed } from "@/lib/served";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseMessages(body: unknown): ChatMessage[] | null {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const clean = messages.filter(
    (m): m is ChatMessage =>
      (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string",
  );
  return clean.length > 0 && clean[clean.length - 1].role === "user" ? clean.slice(-20) : null;
}

/**
 * Streams the answer as NDJSON frames: meta, text deltas, a `card` frame when the turn picked a
 * campaign, then done. A missing or invalid pick only means no card.
 */
export async function POST(req: Request) {
  const messages = parseMessages(await req.json().catch(() => null));
  if (!messages) return Response.json({ error: "messages must end with a user message" }, { status: 400 });

  const model = activeModel();
  if (!model) return Response.json({ error: "KIMI_API_KEY is not set" }, { status: 503 });

  const requestId = newRequestId();
  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: ChatFrame) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(frame) + "\n"));
      };
      send({ type: "meta", requestId, model });

      const pickable = allCampaigns();
      const sendCard = (pick: Pick | null) => {
        const campaign = pick && campaignBySlug(pick.slug, pickable);
        if (!pick || !campaign) return;
        const card = buildCard({ ...chainConfig(), requestId, campaign, pick });
        rememberServed({
          requestId,
          slug: card.slug,
          campaignId: card.receipt.campaignId,
          rationale: card.rationale,
          claimRefs: card.claimRefs,
          servedAt: Date.now(),
        });
        send({ type: "card", card });
      };

      try {
        for await (const event of streamTurn(model, messages, pickable, abort.signal)) {
          if (event.type === "text") send({ type: "text", delta: event.delta });
          else {
            try {
              sendCard(event.pick);
            } catch (error) {
              console.warn(`card failed: ${(error as Error).message}`);
            }
          }
        }
      } catch (error) {
        console.warn(`answer failed: ${(error as Error).message}`);
        send({ type: "error", message: "The model is unavailable right now." });
      }

      send({ type: "done" });
      if (!abort.signal.aborted) controller.close();
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
