import { recordImpression, validMeasurement, type ImpressionInput, type ImpressionOutcome } from "./impression";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

const STATUS: Record<ImpressionOutcome, number> = { accepted: 204, duplicate: 204, bad_token: 401, unavailable: 503 };

/** An empty response with the CORS headers every beacon answer carries. */
export function beaconResponse(status: number): Response {
  return new Response(null, { status, headers: CORS });
}

/** The beacon body: `{ type: "impression", request_id, impression_token, occurred_at?, visible_ratio, dwell_ms }`. */
export function parseBeacon(text: string): ImpressionInput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (b.type !== "impression") return null;
  if (typeof b.request_id !== "string" || !b.request_id) return null;
  if (typeof b.impression_token !== "string" || !b.impression_token) return null;
  if (!validMeasurement(b.visible_ratio, b.dwell_ms)) return null;
  return {
    requestId: b.request_id,
    impressionToken: b.impression_token,
    occurredAt: typeof b.occurred_at === "string" ? b.occurred_at : undefined,
    visibleRatio: b.visible_ratio as number,
    dwellMs: b.dwell_ms as number,
  };
}

/** POST /v1/beacon: 204 accepted or duplicate, 400 bad body, 401 bad token or unserved request; never a body. */
export async function handleBeacon(req: Request): Promise<Response> {
  const input = parseBeacon(await req.text().catch(() => ""));
  if (!input) return beaconResponse(400);
  return beaconResponse(STATUS[recordImpression(input)]);
}
