import { createHash, timingSafeEqual } from "node:crypto";

/** Key used on both sides when ARIA_API_KEY is unset outside production, so `pnpm dev` serves ads with no secrets. */
export const DEV_API_KEY = "ak_test_novaDevKeyNotForProduction000000";

export const DEFAULT_PUBLISHER_ID = "pub_nova";

/** ARIA_API_KEY, else the dev key outside production; undefined in production without a key. */
export function ariaApiKey(): string | undefined {
  if (process.env.ARIA_API_KEY) return process.env.ARIA_API_KEY;
  return process.env.NODE_ENV === "production" ? undefined : DEV_API_KEY;
}

export function ariaPublisherId(): string {
  return process.env.ARIA_PUBLISHER_ID || DEFAULT_PUBLISHER_ID;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** True when the request's `Authorization: Bearer <key>` equals the API key (constant-time). */
export function hasApiKey(req: Request): boolean {
  const expected = ariaApiKey();
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!expected || !match) return false;
  return timingSafeEqual(digest(match[1]), digest(expected));
}
