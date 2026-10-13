import { createAria, type AriaClient, type ServeResult } from "@trustaria/core";
import { createAriaEventsHandler } from "@trustaria/react/server";
import type { Campaign } from "./campaigns";
import { validatePick, type Pick } from "./pick";
import { ariaApiKey, ariaPublisherId } from "./serve/auth";

export const DEFAULT_SERVE_TIMEOUT_MS = 6000;

/** ARIA_BASE_URL, else this same server's /api. */
export function ariaBaseUrl(): string {
  return process.env.ARIA_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/api`;
}

export function ariaTimeoutMs(): number {
  const ms = Number(process.env.ARIA_SERVE_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_SERVE_TIMEOUT_MS;
}

let cached: { key: string; client: AriaClient } | undefined;

/** Nova's Aria publisher client, rebuilt only when its settings change. */
export function ariaClient(): AriaClient {
  const config = {
    apiKey: ariaApiKey() ?? "",
    publisherId: ariaPublisherId(),
    baseUrl: ariaBaseUrl(),
    timeoutMs: ariaTimeoutMs(),
  };
  const key = JSON.stringify(config);
  if (cached?.key !== key) {
    const client = createAria({
      ...config,
      onDebug: (event) => console.warn(`aria serve ${event.type}: ${event.message}`),
    });
    cached = { key, client };
  }
  return cached.client;
}

let cachedEvents: { key: string; handler: (req: Request) => Promise<Response> } | undefined;

/** Nova's proxy for the card's non-billing events, forwarded to Aria with the publisher key. */
export function ariaEventsHandler(): (req: Request) => Promise<Response> {
  const config = { apiKey: ariaApiKey() ?? "", publisherId: ariaPublisherId(), baseUrl: ariaBaseUrl() };
  const key = JSON.stringify(config);
  if (cachedEvents?.key !== key) cachedEvents = { key, handler: createAriaEventsHandler(config) };
  return cachedEvents.handler;
}

/** The served ad as a pick for Nova's card, re-validated against Nova's own campaign list; null on a no-fill. */
export function adToPick(result: ServeResult, campaigns: Campaign[]): Pick | null {
  const ad = result.ad;
  if (!ad) return null;
  return validatePick({ slug: ad.offerId, rationale: ad.creative.body, claimRefs: ad.claimRefs }, campaigns);
}
