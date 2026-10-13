import { createHash, timingSafeEqual } from "node:crypto";
import { DEMO_KEY_HEADER } from "./demo-key-client";

export const DEMO_KEY_DENIED = "This demo control is locked.";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** True when ARIA_DEMO_KEY is set, so demo controls need the key. */
export function demoKeyRequired(): boolean {
  return Boolean(process.env.ARIA_DEMO_KEY);
}

/** True when ARIA_DEMO_KEY is set and the request carries it in `x-aria-demo-key`. */
export function hasDemoKey(req: Request): boolean {
  const expected = process.env.ARIA_DEMO_KEY;
  const given = req.headers.get(DEMO_KEY_HEADER);
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** A 403 when ARIA_DEMO_KEY is set and the request lacks it; null when the request may go on. */
export function requireDemoKey(req: Request): Response | null {
  if (!demoKeyRequired() || hasDemoKey(req)) return null;
  return Response.json({ error: DEMO_KEY_DENIED }, { status: 403, headers: { "cache-control": "no-store" } });
}
