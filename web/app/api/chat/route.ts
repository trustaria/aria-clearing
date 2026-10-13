import { extractPromptAndContext, type AdPayload } from "@trustaria/core";
import { adToPick, ariaClient } from "@/lib/aria";
import { allCampaigns, campaignBySlug } from "@/lib/campaigns";
import { activeModel, streamAnswer, type ChatFrame, type ChatMessage } from "@/lib/kimi";
import { buildCard, chainConfig, type CardData } from "@/lib/receipt";
import { FALLBACK_ANSWER, KIMI_BUSY_NOTICE, KIMI_STOPPED_NOTICE, stubAnswer } from "@/lib/stub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SESSION_ID = 128;

function parseMessages(body: unknown): ChatMessage[] | null {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const clean = messages.filter(
    (m): m is ChatMessage =>
      (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string",
  );
  return clean.length > 0 && clean[clean.length - 1].role === "user" ? clean.slice(-20) : null;
}

function parseSessionId(body: unknown): string | undefined {
  const id = (body as { sessionId?: unknown })?.sessionId;
  return typeof id === "string" && id.length > 0 && id.length <= MAX_SESSION_ID ? id : undefined;
}

type Served = { card: CardData; ad: AdPayload };

/**
 * Asks Aria's serve API for an ad: the payload AriaAdCard renders, plus Nova's receipt for it,
 * re-validated against Nova's campaign list. Resolves null on a no-fill, a timeout or any failure.
 */
async function servedCard(messages: ChatMessage[], sessionId: string | undefined): Promise<Served | null> {
  const input = extractPromptAndContext(messages);
  if (!input) return null;
  try {
    const result = await ariaClient().serve({ ...input, sessionId });
    const campaigns = allCampaigns();
    const pick = adToPick(result, campaigns);
    const campaign = pick && campaignBySlug(pick.slug, campaigns);
    if (!result.ad || !pick || !campaign || !result.requestId) {
      if (result.ad) console.warn(`served ad ${result.requestId} rejected by Nova's validation`);
      return null;
    }
    return { card: buildCard({ ...chainConfig(), requestId: result.requestId, campaign, pick }), ad: result.ad };
  } catch (error) {
    console.warn(`card failed: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Streams the answer as NDJSON frames: meta, text deltas, a `card` frame when Aria served an ad,
 * then done. The serve call runs alongside the answer; no ad only means no card.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const messages = parseMessages(body);
  if (!messages) return Response.json({ error: "messages must end with a user message" }, { status: 400 });

  const model = activeModel();
  if (!model) return Response.json({ error: "KIMI_API_KEY is not set" }, { status: 503 });

  const card = servedCard(messages, parseSessionId(body));
  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: ChatFrame) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(frame) + "\n"));
      };
      send({ type: "meta", model });

      let sentText = false;
      const relay = async (deltas: AsyncGenerator<string>) => {
        for await (const delta of deltas) {
          sentText = true;
          send({ type: "text", delta });
        }
      };

      let failed = false;
      try {
        await relay(streamAnswer(model, messages, abort.signal));
      } catch (error) {
        console.warn(`answer failed: ${(error as Error).message}`);
        failed = true;
      }

      // Text already shown stays with a notice; a turn with no text gets the fallback answer.
      if (!abort.signal.aborted && sentText) {
        if (failed) send({ type: "notice", message: KIMI_STOPPED_NOTICE });
      } else if (!abort.signal.aborted) {
        if (!failed) console.warn("answer was empty");
        send({ type: "notice", message: KIMI_BUSY_NOTICE });
        await relay(stubAnswer(FALLBACK_ANSWER));
      }

      const served = await card;
      if (served) send({ type: "card", ...served });

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
