import type { Hex } from "viem";
import type { EventKind, EventStore } from "./store";

export type EvidenceEntry = {
  id: Hex;
  kind: EventKind;
  viewMs: number;
  visibleRatio: number;
  clickRedirected: boolean;
  firstSeenAt: string;
};

const EVENT_ID = /^0x[0-9a-fA-F]{64}$/;

/** Evidence for the requested eventIds; malformed and unknown ids are omitted. */
export function evidenceFor(body: unknown, store: EventStore): { evidence: EvidenceEntry[] } {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids)) return { evidence: [] };

  const seen = new Set<string>();
  const evidence: EvidenceEntry[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !EVENT_ID.test(id) || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    const record = store.getEvent(id);
    if (!record) continue;
    evidence.push({ id: id as Hex, kind: record.kind, ...record.evidence });
  }
  return { evidence };
}
