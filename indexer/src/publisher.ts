import type { Publisher } from "envio";

export type Bucket = "pending" | "disputed" | "released" | "rejected";

/** Contract enum IAriaClearing.Status values carried by EventSettled. */
export const STATUS_RELEASED = 3n;
export const STATUS_REJECTED = 4n;

export function emptyPublisher(id: string): Publisher {
  return {
    id,
    impressions: 0,
    clicks: 0,
    pending: 0,
    disputed: 0,
    released: 0,
    rejected: 0,
    earned: 0n,
    trustScoreBps: undefined,
    lastActivityAt: 0,
  };
}

/** released / (released + rejected + disputed) in basis points, rounded half up; undefined with no history. */
export function trustScoreBps(p: Pick<Publisher, "released" | "rejected" | "disputed">): number | undefined {
  const total = p.released + p.rejected + p.disputed;
  if (total === 0) return undefined;
  return Math.floor((p.released * 10_000 + Math.floor(total / 2)) / total);
}

/** Moves one event between buckets and recomputes the score. `from` undefined adds a new event. */
export function moveEvent(p: Publisher, from: Bucket | undefined, to: Bucket, at: number): Publisher {
  const next = { ...p, [to]: p[to] + 1, lastActivityAt: Math.max(p.lastActivityAt, at) };
  if (from) next[from] = Math.max(0, p[from] - 1);
  return { ...next, trustScoreBps: trustScoreBps(next) };
}
