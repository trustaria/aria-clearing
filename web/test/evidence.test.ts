import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf, eventIdOf, Kind } from "@aria-clearing/receipt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evidenceFor } from "../lib/evidence";
import { createEventStore, type EventStore } from "../lib/store";

const REQ = "req_0123456789abcdefABCDEF";
const impressionId = eventIdOf(REQ, Kind.Impression);
const clickId = eventIdOf(REQ, Kind.Click);
const unknownId = eventIdOf("req_unknownunknownunknown", Kind.Impression);

describe("evidenceFor", () => {
  let dir: string;
  let store: EventStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-evidence-"));
    store = createEventStore(join(dir, "events.json"));
    const base = {
      requestId: REQ,
      campaignId: campaignIdOf("lisbon-family-trips"),
      publisher: "0x1111111111111111111111111111111111111111" as const,
      forged: false,
      status: "logged" as const,
      createdAt: 1,
    };
    store.claimEvent({
      ...base,
      eventId: impressionId,
      kind: "impression",
      evidence: { viewMs: 1500, visibleRatio: 0.8, clickRedirected: false, firstSeenAt: "2026-10-12T10:00:00.000Z" },
    });
    store.claimEvent({
      ...base,
      eventId: clickId,
      kind: "click",
      evidence: { viewMs: 0, visibleRatio: 0, clickRedirected: true, firstSeenAt: "2026-10-12T10:00:05.000Z" },
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the evidence contract shape for known ids", () => {
    expect(evidenceFor({ ids: [impressionId, clickId] }, store)).toEqual({
      evidence: [
        {
          id: impressionId,
          kind: "impression",
          viewMs: 1500,
          visibleRatio: 0.8,
          clickRedirected: false,
          firstSeenAt: "2026-10-12T10:00:00.000Z",
        },
        {
          id: clickId,
          kind: "click",
          viewMs: 0,
          visibleRatio: 0,
          clickRedirected: true,
          firstSeenAt: "2026-10-12T10:00:05.000Z",
        },
      ],
    });
  });

  it("omits unknown and malformed ids", () => {
    const { evidence } = evidenceFor({ ids: [unknownId, "0x1234", 42, impressionId] }, store);
    expect(evidence.map((e) => e.id)).toEqual([impressionId]);
  });

  it("matches ids case-insensitively", () => {
    const upper = `0x${impressionId.slice(2).toUpperCase()}`;
    const { evidence } = evidenceFor({ ids: [upper] }, store);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].id.toLowerCase()).toBe(impressionId);
    expect(evidence[0].viewMs).toBe(1500);
  });

  it("returns each id once", () => {
    expect(evidenceFor({ ids: [clickId, clickId.toUpperCase().replace("0X", "0x")] }, store).evidence).toHaveLength(1);
  });

  it("returns an empty list for a malformed body", () => {
    expect(evidenceFor(null, store)).toEqual({ evidence: [] });
    expect(evidenceFor({ ids: "nope" }, store)).toEqual({ evidence: [] });
  });
});
