import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isRequestId } from "../request-id";

/** Secret used when ARIA_TOKEN_SECRET is unset outside production. */
export const DEV_TOKEN_SECRET = "aria-dev-token-secret-not-for-production";

/** ARIA_TOKEN_SECRET, else the dev secret outside production; undefined in production without one. */
export function tokenSecret(): string | undefined {
  if (process.env.ARIA_TOKEN_SECRET) return process.env.ARIA_TOKEN_SECRET;
  return process.env.NODE_ENV === "production" ? undefined : DEV_TOKEN_SECRET;
}

function mac(requestId: string, secret: string): string {
  return createHmac("sha256", secret).update(requestId).digest("base64url");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** `<request_id>.<base64url HMAC-SHA256(secret, request_id)>`. */
export function signImpressionToken(requestId: string, secret: string): string {
  return `${requestId}.${mac(requestId, secret)}`;
}

/** The token's request id when its MAC matches under `secret` (constant-time), else null. */
export function verifyImpressionToken(token: string, secret: string): string | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [requestId, given] = parts;
  if (!isRequestId(requestId) || !given) return null;
  return timingSafeEqual(digest(given), digest(mac(requestId, secret))) ? requestId : null;
}
