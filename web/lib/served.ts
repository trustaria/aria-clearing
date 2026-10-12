import type { Hex } from "viem";

/** A card the server handed out, keyed by requestId. */
export type ServedPick = {
  requestId: string;
  slug: string;
  campaignId: Hex;
  rationale: string;
  claimRefs: number[];
  servedAt: number;
};

// Kept on globalThis so every route bundle (and dev reloads) share one map.
const globalStore = globalThis as typeof globalThis & { __ariaServed?: Map<string, ServedPick> };
const served = (globalStore.__ariaServed ??= new Map<string, ServedPick>());

export function rememberServed(pick: ServedPick): void {
  served.set(pick.requestId, pick);
}

export function getServed(requestId: string): ServedPick | undefined {
  return served.get(requestId);
}

export function listServed(): ServedPick[] {
  return [...served.values()];
}
