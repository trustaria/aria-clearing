import { campaignBySlug, type Campaign } from "../campaigns";
import { buildCard, chainConfig, receiptHref } from "../receipt";
import { newRequestId } from "../request-id";
import { rememberServed } from "../served";
import { ariaPublisherId, hasApiKey } from "./auth";
import { selectAd, type Intent, type Picker, type Selection } from "./select";
import { signImpressionToken, tokenSecret } from "./token";

export const SCHEMA_VERSION = "1";
export const MAX_PROMPT = 4000;
export const MAX_CONTEXT = 2000;
export const IMPRESSION_TTL_MS = 600_000;

export type ServeDeps = { picker: Picker | null; campaigns: Campaign[] };

type ErrorCode = "bad_request" | "invalid_key" | "forbidden" | "unavailable";

const STATUS: Record<ErrorCode, number> = { bad_request: 400, invalid_key: 401, forbidden: 403, unavailable: 503 };

function error(code: ErrorCode, message: string, requestId?: string): Response {
  const body = { error: requestId ? { code, message, request_id: requestId } : { code, message } };
  return Response.json(body, { status: STATUS[code], headers: { "cache-control": "no-store" } });
}

/** Origin for click and why URLs: ARIA_PUBLIC_URL, else forwarded headers, else the request's own. */
function publicOrigin(req: Request): string {
  const configured = process.env.ARIA_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

/** Partial labels: the coarse intent and whether the request passed the monetizable gate. */
function labels(intent: Intent | null, monetizable: boolean) {
  return {
    commercial_intent: intent === "commercial" ? "recommendation_seeking" : "none",
    derived: { monetizable },
  };
}

type Parsed = { publisherId: unknown; prompt: string; context?: string } | { error: string };

function parseBody(raw: unknown): Parsed {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "body must be a JSON object" };
  const body = raw as Record<string, unknown>;
  if (typeof body.prompt !== "string") return { error: "prompt is required" };
  const prompt = body.prompt.trim();
  if (prompt.length === 0) return { error: "prompt is empty" };
  if (prompt.length > MAX_PROMPT) return { error: `prompt exceeds ${MAX_PROMPT} characters` };
  const context = typeof body.context === "string" && body.context.trim() ? body.context.slice(0, MAX_CONTEXT) : undefined;
  return { publisherId: body.publisher_id, prompt, context };
}

/** The served `ad` object; records the card so clicks, impressions, evidence and the receipt resolve. */
function serveAd(
  req: Request,
  requestId: string,
  selection: Extract<Selection, { decision: "served" }>,
  servedAt: Date,
  campaigns: Campaign[],
  secret: string,
) {
  const campaign = campaignBySlug(selection.pick.slug, campaigns)!;
  const card = buildCard({ ...chainConfig(), requestId, campaign, pick: selection.pick });
  rememberServed({
    requestId,
    slug: card.slug,
    campaignId: card.receipt.campaignId,
    rationale: card.rationale,
    claimRefs: card.claimRefs,
    servedAt: servedAt.getTime(),
  });
  const origin = publicOrigin(req);
  return {
    offer_id: campaign.slug,
    creative: {
      title: campaign.advertiser,
      body: card.rationale,
      cta: "Learn more",
      advertiser: campaign.advertiser,
      click_url: `${origin}/api/aria/click/${requestId}`,
      logo_url: null,
    },
    claim_refs: card.claimRefs,
    // No why_text: the receipt page is the explanation, so "Why this ad?" links straight to it.
    disclosure: { label: "Sponsored", why_url: `${origin}${receiptHref(card)}` },
    impression_token: signImpressionToken(requestId, secret),
    beacon_url: `${origin}/api/v1/beacon`,
    ttl_ms: IMPRESSION_TTL_MS,
    served_at: servedAt.toISOString(),
  };
}

/** POST /v1/serve: authenticates, validates, selects at most one campaign and answers per the serve wire contract. */
export async function handleServe(req: Request, deps: ServeDeps): Promise<Response> {
  const started = Date.now();
  if (!hasApiKey(req)) return error("invalid_key", "missing or invalid API key");

  const requestId = newRequestId();
  const secret = tokenSecret();
  if (!secret) return error("unavailable", "ARIA_TOKEN_SECRET is not set", requestId);
  const parsed = parseBody(await req.json().catch(() => null));
  if ("error" in parsed) return error("bad_request", parsed.error, requestId);
  if (parsed.publisherId !== ariaPublisherId()) {
    return error("forbidden", "publisher_id does not match the API key", requestId);
  }

  const selection = await selectAd({ prompt: parsed.prompt, context: parsed.context, campaigns: deps.campaigns }, deps.picker);
  const servedAt = new Date();
  const head = { schema_version: SCHEMA_VERSION, request_id: requestId };

  if (selection.decision === "served") {
    const ad = serveAd(req, requestId, selection, servedAt, deps.campaigns, secret);
    return Response.json(
      {
        ...head,
        decision: "served",
        ad,
        labels: labels(selection.intent, true),
        timing_ms: { total: Date.now() - started },
        served_at: ad.served_at,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    {
      ...head,
      decision: "no_fill",
      no_fill_reason: selection.reason,
      labels: labels(selection.intent, selection.reason !== "not_monetizable"),
      timing_ms: { total: Date.now() - started },
      served_at: servedAt.toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
