import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf, eventIdOf, Kind } from "@aria-clearing/receipt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventStore, type EventRecord } from "../lib/store";

const REQ = "req_0123456789abcdefABCDEF";
const PUBLISHER = "0x1111111111111111111111111111111111111111";

function impression(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    eventId: eventIdOf(REQ, Kind.Impression),
    requestId: REQ,
    kind: "impression",
    campaignId: campaignIdOf("lisbon-family-trips"),
    publisher: PUBLISHER,
    evidence: { viewMs: 1200, visibleRatio: 0.9, clickRedirected: false, firstSeenAt: "2026-10-12T10:00:00.000Z" },
    forged: false,
    status: "queued",
    createdAt: 1,
    ...overrides,
  };
}

describe("event store", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-events-"));
    file = join(dir, ".data", "events.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts a new event once and returns the existing one on a duplicate", () => {
    const store = createEventStore(file);
    const first = store.claimEvent(impression());
    expect(first.created).toBe(true);

    const second = store.claimEvent(impression({ evidence: { ...impression().evidence, viewMs: 0, visibleRatio: 0 } }));
    expect(second.created).toBe(false);
    expect(second.record.evidence.viewMs).toBe(1200);
    expect(store.listEvents()).toHaveLength(1);
  });

  it("lets a failed event be claimed again", () => {
    const store = createEventStore(file);
    store.claimEvent(impression());
    store.updateEvent(impression().eventId, { status: "failed", error: "boom" });
    const retry = store.claimEvent(impression());
    expect(retry.created).toBe(true);
    expect(retry.record.status).toBe("queued");
    expect(retry.record.error).toBeUndefined();
  });

  it("keeps the first claim's evidence and origin when a failed event is claimed again", () => {
    const store = createEventStore(file);
    store.claimEvent(impression());
    store.updateEvent(impression().eventId, { status: "failed", error: "boom" });
    const replay = impression({
      evidence: { viewMs: 5000, visibleRatio: 0.6, clickRedirected: false, firstSeenAt: "2026-10-12T11:00:00.000Z" },
      forged: true,
      createdAt: 99,
    });
    const retry = store.claimEvent(replay);
    expect(retry.created).toBe(true);
    expect(retry.record.status).toBe("queued");
    expect(retry.record.evidence).toEqual(impression().evidence);
    expect(retry.record.forged).toBe(false);
    expect(retry.record.createdAt).toBe(1);
  });

  it("looks events up case-insensitively", () => {
    const store = createEventStore(file);
    store.claimEvent(impression());
    expect(store.getEvent(impression().eventId.toUpperCase().replace("0X", "0x"))?.requestId).toBe(REQ);
  });

  it("moves an event from queued to logged", () => {
    const store = createEventStore(file);
    store.claimEvent(impression());
    const updated = store.updateEvent(impression().eventId, { status: "logged", txHash: "0xabc", loggedAt: 5 });
    expect(updated).toMatchObject({ status: "logged", txHash: "0xabc", loggedAt: 5 });
  });

  it("keeps events and served picks across a restart", () => {
    const store = createEventStore(file);
    store.claimEvent(impression());
    store.updateEvent(impression().eventId, { status: "logged", txHash: "0xabc" });
    store.putServed({
      requestId: REQ,
      slug: "lisbon-family-trips",
      campaignId: campaignIdOf("lisbon-family-trips"),
      rationale: "Children under 6 stay free in partner hotels.",
      claimRefs: [2],
      servedAt: 1,
    });

    const reloaded = createEventStore(file);
    expect(reloaded.getEvent(impression().eventId)?.txHash).toBe("0xabc");
    expect(reloaded.getServed(REQ)?.claimRefs).toEqual([2]);
    expect(JSON.parse(readFileSync(file, "utf8")).events).toBeDefined();
  });
});
