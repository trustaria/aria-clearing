import { isRequestId } from "../request-id";
import { ariaPublisherId, hasApiKey } from "./auth";
import { apiError } from "./handler";

const TYPES = new Set(["impression", "click"]);

/**
 * POST /v1/events: server-to-server signals from a publisher, acknowledged and not billed.
 * Billable impressions arrive on the beacon and billable clicks through the click redirect.
 */
export async function handleEvents(req: Request): Promise<Response> {
  if (!hasApiKey(req)) return apiError("invalid_key", "missing or invalid API key");
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return apiError("bad_request", "body must be a JSON object");
  const body = raw as Record<string, unknown>;
  if (typeof body.type !== "string" || !TYPES.has(body.type)) {
    return apiError("bad_request", 'type must be "impression" or "click"');
  }
  if (typeof body.request_id !== "string" || !isRequestId(body.request_id)) {
    return apiError("bad_request", "request_id is required");
  }
  if (body.publisher_id !== ariaPublisherId()) {
    return apiError("forbidden", "publisher_id does not match the API key", body.request_id);
  }
  return Response.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
}
