import { normalizeRationale } from "@aria-clearing/receipt";
import type { Campaign } from "./campaigns";

export const MAX_RATIONALE = 180;
export const PICK_DEADLINE_MS = 6000;

export type Pick = {
  slug: string;
  rationale: string;
  claimRefs: number[];
};

/** Removes inline claim markers such as "(1)", "(2, 4)" or "[3]" from a rationale. */
export function stripClaimMarkers(text: string): string {
  return text
    .replace(/\s*[([]\s*\d+(?:\s*,\s*\d+)*\s*[)\]]/g, "")
    .replace(/\s+([.,;!?])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

/**
 * Turns raw model output into a pick, or null when there is nothing safe to show:
 * unknown or null slug, blank or over-long rationale, or no claim ref inside 1..claims.length.
 */
export function validatePick(raw: unknown, campaigns: Campaign[]): Pick | null {
  if (!raw || typeof raw !== "object") return null;
  const { slug, rationale, claimRefs } = raw as Record<string, unknown>;

  if (typeof slug !== "string") return null;
  const campaign = campaigns.find((c) => c.slug === slug);
  if (!campaign) return null;

  if (typeof rationale !== "string") return null;
  const text = normalizeRationale(stripClaimMarkers(rationale));
  if (text.length === 0 || text.length > MAX_RATIONALE) return null;

  if (!Array.isArray(claimRefs)) return null;
  const refs = [
    ...new Set(
      claimRefs.filter(
        (n): n is number => Number.isInteger(n) && n >= 1 && n <= campaign.claims.length,
      ),
    ),
  ].sort((a, b) => a - b);
  if (refs.length === 0) return null;

  return { slug, rationale: text, claimRefs: refs };
}

/** Parses the first JSON object in model output; throws when there is none. */
export function parsePickJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("no JSON object in pick output");
  return JSON.parse(text.slice(start, end + 1));
}

/** Runs `call` with an abort signal; resolves null on error or after `ms`, never rejects. */
export async function pickWithDeadline<T>(
  call: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
