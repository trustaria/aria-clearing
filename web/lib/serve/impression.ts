import { submitEvent } from "../events";
import { getServed } from "../served";
import { tokenSecret, verifyImpressionToken } from "./token";

export type ImpressionInput = {
  requestId: string;
  impressionToken: string;
  occurredAt?: string;
  visibleRatio: number;
  dwellMs: number;
};

/** `bad_token`: the token does not verify, names another request, or names a request that was never served. */
export type ImpressionOutcome = "accepted" | "duplicate" | "bad_token" | "unavailable";

/** True for a visible ratio in [0, 1] and a whole, non-negative dwell in ms. */
export function validMeasurement(visibleRatio: unknown, dwellMs: unknown): boolean {
  return (
    typeof visibleRatio === "number" &&
    visibleRatio >= 0 &&
    visibleRatio <= 1 &&
    typeof dwellMs === "number" &&
    Number.isInteger(dwellMs) &&
    dwellMs >= 0
  );
}

/** When the view began: occurred_at minus the dwell, clamped to [served time, now]; else now minus the dwell. */
function firstSeenAt(occurredAt: string | undefined, dwellMs: number, servedAt: number, now: number): string {
  const occurred = occurredAt ? Date.parse(occurredAt) : Number.NaN;
  const start = Number.isFinite(occurred) ? Math.min(now, Math.max(servedAt, occurred - dwellMs)) : now - dwellMs;
  return new Date(start).toISOString();
}

/**
 * Verifies the impression token against the served record and logs the impression through the
 * same path as every other event. The onchain write continues after this returns.
 */
export function recordImpression(input: ImpressionInput, now = Date.now()): ImpressionOutcome {
  const secret = tokenSecret();
  if (!secret) return "unavailable";
  const requestId = verifyImpressionToken(input.impressionToken, secret);
  if (!requestId || requestId !== input.requestId) return "bad_token";
  const served = getServed(requestId);
  if (!served) return "bad_token";

  const result = submitEvent({
    requestId,
    kind: "impression",
    evidence: {
      viewMs: input.dwellMs,
      visibleRatio: input.visibleRatio,
      firstSeenAt: firstSeenAt(input.occurredAt, input.dwellMs, served.servedAt, now),
    },
  });
  if (!result.ok) return result.status === 404 ? "bad_token" : "unavailable";
  return result.created ? "accepted" : "duplicate";
}
