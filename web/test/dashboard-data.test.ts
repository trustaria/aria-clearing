import { campaignIdOf } from "@aria-clearing/receipt";
import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  advertiserNames,
  activityFrom,
  activityFromIndexed,
  alignedChunks,
  estimateTime,
  FEED_LIMIT,
  loadDashboard,
  rejectReason,
  scanRange,
  toDashboardJson,
  totalsOf,
  withTimes,
  type ClearingLog,
  type FeedItem,
} from "../lib/dashboard-data";
import { getPublisherIndex, type IndexedEvent, type IndexedStatus, type PublisherIndex } from "../lib/envio";
import { LIVE_INDEX_RESPONSE, LIVE_PUBLISHER } from "./envio-fixtures";

const ME = "0x67435bD1FCd81D6c25C6546a86af0eF6887F72cb";
const OTHER = "0x1111111111111111111111111111111111111111";
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const LISBON = campaignIdOf("lisbon-family-trips");
const UNKNOWN_CAMPAIGN = H(999);

const IMPRESSION = 0;
const CLICK = 1;
const IMPRESSION_PRICE = 10_000n;
const CLICK_PRICE = 250_000n;

function logged(n: number, kind: number, publisher = ME, campaignId: `0x${string}` = LISBON): ClearingLog {
  return {
    type: "logged",
    eventId: H(n),
    requestId: `req_${n}`,
    campaignId,
    publisher: publisher as `0x${string}`,
    kind,
    price: kind === CLICK ? CLICK_PRICE : IMPRESSION_PRICE,
    blockNumber: 1_000n + BigInt(n),
    txHash: H(500 + n),
  };
}

const settled = (n: number, outcome: number): ClearingLog => ({
  type: "settled",
  eventId: H(n),
  outcome,
  blockNumber: 2_000n + BigInt(n),
  txHash: H(700 + n),
});
const disputed = (n: number): ClearingLog => ({ type: "disputed", eventId: H(n), blockNumber: 1_500n, txHash: H(600 + n) });
const payout = (n: number, type: "paid" | "deferred", amount: bigint, publisher = ME): ClearingLog => ({
  type,
  eventId: H(n),
  publisher: publisher as `0x${string}`,
  amount,
  blockNumber: 2_000n + BigInt(n),
  txHash: H(700 + n),
});

/** Old contract: released click and impression ($0.26), a forged impression rejected, one click pending. */
const legacyLogs: ClearingLog[] = [
  logged(1, IMPRESSION),
  logged(2, CLICK),
  logged(3, IMPRESSION),
  logged(4, CLICK),
  logged(5, IMPRESSION, OTHER),
  settled(1, 3),
  settled(2, 3),
  settled(3, 4),
  settled(5, 3),
];

/** New contract: paid out directly, one deferred payout, one disputed then rejected, one click without redirect. */
const payoutLogs: ClearingLog[] = [
  logged(10, CLICK),
  logged(11, IMPRESSION),
  logged(12, IMPRESSION),
  logged(13, CLICK),
  logged(14, IMPRESSION, ME, UNKNOWN_CAMPAIGN),
  settled(10, 3),
  payout(10, "paid", CLICK_PRICE),
  settled(11, 3),
  payout(11, "deferred", IMPRESSION_PRICE),
  disputed(12),
  settled(12, 4),
  settled(13, 4),
  disputed(14),
];

describe("advertiserNames", () => {
  it("names a campaign by its onchain id", () => {
    expect(advertiserNames()[LISBON.toLowerCase()]).toBe("Tagus Family Travel");
  });
});

describe("rejectReason", () => {
  it("blames the rule the kind failed, unless the advertiser disputed", () => {
    expect(rejectReason("Impression", false)).toBe("not_viewed");
    expect(rejectReason("Click", false)).toBe("no_redirect");
    expect(rejectReason("Click", true)).toBe("disputed");
    expect(rejectReason("Impression", true)).toBe("disputed");
  });
});

describe("activityFrom", () => {
  it("keeps this publisher's events newest first and treats a legacy release as paid", () => {
    const activity = activityFrom(legacyLogs, ME.toLowerCase());
    expect(activity.map((a) => [a.requestId, a.kind, a.status, a.earned, a.reason])).toEqual([
      ["req_4", "Click", "pending", 0n, null],
      ["req_3", "Impression", "rejected", 0n, "not_viewed"],
      ["req_2", "Click", "paid", CLICK_PRICE, null],
      ["req_1", "Impression", "paid", IMPRESSION_PRICE, null],
    ]);
    expect(activity[0]).toMatchObject({ advertiser: "Tagus Family Travel", txHash: H(504), settledTx: null });
    expect(activity[2].settledTx).toBe(H(702));
  });

  it("uses PaidOut and PayoutDeferred amounts and dispute history", () => {
    const activity = activityFrom(payoutLogs, ME);
    expect(activity.map((a) => [a.requestId, a.status, a.earned, a.reason, a.advertiser])).toEqual([
      ["req_14", "disputed", 0n, null, null],
      ["req_13", "rejected", 0n, "no_redirect", "Tagus Family Travel"],
      ["req_12", "rejected", 0n, "disputed", "Tagus Family Travel"],
      ["req_11", "deferred", IMPRESSION_PRICE, null, "Tagus Family Travel"],
      ["req_10", "paid", CLICK_PRICE, null, "Tagus Family Travel"],
    ]);
  });

  it("ignores payouts addressed to someone else", () => {
    const logs = [logged(20, CLICK), settled(20, 3), payout(20, "paid", 1n, OTHER)];
    expect(activityFrom(logs, ME)[0]).toMatchObject({ status: "paid", earned: CLICK_PRICE });
  });
});

describe("totalsOf", () => {
  it("sums paid and pending dollars and counts non-rejected impressions and clicks", () => {
    expect(totalsOf(activityFrom(legacyLogs, ME))).toEqual({
      paid: 260_000n,
      deferred: 0n,
      pending: CLICK_PRICE,
      pendingCount: 1,
      impressions: 1,
      clicks: 2,
      rejected: 1,
      rejectedBy: { not_viewed: 1, no_redirect: 0, disputed: 0 },
    });
  });

  it("keeps deferred payouts apart from paid and counts disputes as pending", () => {
    expect(totalsOf(activityFrom(payoutLogs, ME))).toEqual({
      paid: CLICK_PRICE,
      deferred: IMPRESSION_PRICE,
      pending: IMPRESSION_PRICE,
      pendingCount: 1,
      impressions: 2,
      clicks: 1,
      rejected: 2,
      rejectedBy: { not_viewed: 0, no_redirect: 1, disputed: 1 },
    });
  });

  it("is all zeros with no activity", () => {
    expect(totalsOf([])).toMatchObject({ paid: 0n, pending: 0n, impressions: 0, clicks: 0, rejected: 0 });
  });
});

describe("scanRange", () => {
  it("covers the last N blocks but never before the deploy block", () => {
    expect(scanRange(30_000n, 20_000n, 0n)).toEqual({ fromBlock: 10_001n, toBlock: 30_000n });
    expect(scanRange(30_000n, 20_000n, 25_000n)).toEqual({ fromBlock: 25_000n, toBlock: 30_000n });
  });
});

describe("alignedChunks", () => {
  it("splits on multiples of the chunk size so chunks repeat across scans", () => {
    expect(alignedChunks(150n, 420n, 100n)).toEqual([
      { fromBlock: 100n, toBlock: 199n },
      { fromBlock: 200n, toBlock: 299n },
      { fromBlock: 300n, toBlock: 399n },
      { fromBlock: 400n, toBlock: 420n },
    ]);
  });
});

describe("estimateTime", () => {
  it("interpolates between two known blocks", () => {
    const a = { block: 1_000n, time: 1_000 };
    const b = { block: 2_000n, time: 1_400 };
    expect(estimateTime(1_500n, a, b)).toBe(1_200);
    expect(estimateTime(2_000n, a, b)).toBe(1_400);
    expect(estimateTime(1_000n, a, a)).toBe(1_000);
  });
});

describe("toDashboardJson", () => {
  it("serializes amounts as base-unit strings and adds an estimated time", () => {
    const activity = withTimes(activityFrom([logged(1, CLICK), settled(1, 3)], ME), [
      { block: 1_000n, time: 100 },
      { block: 2_000n, time: 500 },
    ]);
    const json = toDashboardJson({
      address: ME,
      clearing: OTHER,
      usdc: 260_000n,
      credit: 0n,
      mon: 5n,
      activity,
      range: { fromBlock: 1_000n, toBlock: 2_000n },
      source: "logs",
    });
    expect(json).toMatchObject({
      usdc: "260000",
      credit: "0",
      mon: "5",
      totals: { paid: "250000", pending: "0", deferred: "0", clicks: 1 },
      activity: [{ requestId: "req_1", price: "250000", earned: "250000", blockNumber: "1001", time: 100 }],
      fromBlock: "1000",
      toBlock: "2000",
      source: "logs",
    });
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});

/** One indexed event; `n` matches the ids and hashes of the log fixtures above. */
function indexed(
  n: number,
  kind: "impression" | "click",
  status: IndexedStatus,
  extra: Partial<IndexedEvent> = {},
): IndexedEvent {
  const settledNow = status === "released" || status === "rejected";
  return {
    eventId: H(n),
    requestId: `req_${n}`,
    campaignId: LISBON,
    kind,
    price: kind === "click" ? CLICK_PRICE : IMPRESSION_PRICE,
    status,
    wasDisputed: false,
    paid: false,
    loggedAt: 1_000 + n,
    loggedTx: H(500 + n),
    settledAt: settledNow ? 2_000 + n : null,
    settledTx: settledNow ? H(700 + n) : null,
    paidTx: null,
    ...extra,
  };
}

/** `payoutLogs` plus one pending impression, as the indexer stores them. */
const parityLogs: ClearingLog[] = [...payoutLogs, logged(15, IMPRESSION)];
const parityEvents: IndexedEvent[] = [
  indexed(15, "impression", "logged"),
  indexed(14, "impression", "disputed", { wasDisputed: true, campaignId: UNKNOWN_CAMPAIGN }),
  indexed(13, "click", "rejected"),
  indexed(12, "impression", "rejected", { wasDisputed: true }),
  indexed(11, "impression", "released"),
  indexed(10, "click", "released", { paid: true, paidTx: H(710) }),
];

async function liveIndex(): Promise<PublisherIndex> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(LIVE_INDEX_RESPONSE))));
  try {
    const index = await getPublisherIndex(LIVE_PUBLISHER);
    if (!index) throw new Error("fixture did not parse");
    return index;
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("activityFromIndexed", () => {
  it("maps live indexer rows to feed items with exact times and advertiser names", async () => {
    const activity = activityFromIndexed((await liveIndex()).events);
    expect(activity.map((a) => [a.requestId, a.kind, a.status, a.earned, a.reason])).toEqual([
      ["req_ECxfg5BC2dgs1C9xg04VKX", "Impression", "rejected", 0n, "disputed"],
      ["req_bwfPV1noaDv4rCShDSWuc6", "Impression", "rejected", 0n, "not_viewed"],
      ["req_jCBhSKa8I8sxmXS310BG2G", "Click", "paid", CLICK_PRICE, null],
      ["req_jCBhSKa8I8sxmXS310BG2G", "Impression", "paid", IMPRESSION_PRICE, null],
      ["req_bqJymQAubWx7q03A1zA2FD", "Click", "paid", CLICK_PRICE, null],
      ["req_bqJymQAubWx7q03A1zA2FD", "Impression", "paid", IMPRESSION_PRICE, null],
      ["req_payout1791832698", "Impression", "paid", IMPRESSION_PRICE, null],
    ]);
    expect(activity[2]).toMatchObject({
      advertiser: "Tagus Family Travel",
      time: 1791835776,
      txHash: "0x79f700616d1273cbaad84d2a8ff73227620fce2aadd34d3dbef6ef14d9fef130",
      settledTx: "0x7ce6e2d369f32206095bf123f87b2b487580390aecb1f4e197c9a2140ff55c84",
    });
  });

  it("treats a release without a payout as deferred credit", () => {
    expect(activityFromIndexed([indexed(11, "impression", "released")])[0]).toMatchObject({
      status: "deferred",
      earned: IMPRESSION_PRICE,
    });
  });

  it("agrees with the indexer's own publisher counts on the live fixture", async () => {
    const { events, stats } = await liveIndex();
    const totals = totalsOf(activityFromIndexed(events));
    expect(totals.paid).toBe(stats.earned);
    expect(totals.rejected).toBe(stats.rejected);
    expect(totals.pendingCount).toBe(stats.pending + stats.disputed);
    expect(totals.impressions + totals.clicks + totals.rejected).toBe(stats.impressions + stats.clicks);
  });
});

describe("source parity", () => {
  it("gives the same totals from contract logs and from the indexer", () => {
    expect(totalsOf(activityFromIndexed(parityEvents))).toEqual(totalsOf(activityFrom(parityLogs, ME)));
  });

  it("gives the same feed rows from both sources", () => {
    const strip = ({ requestId, kind, advertiser, price, earned, status, reason, txHash, settledTx }: Omit<FeedItem, "time">) => ({
      requestId,
      kind,
      advertiser,
      price,
      earned,
      status,
      reason,
      txHash,
      settledTx,
    });
    expect(activityFromIndexed(parityEvents).map(strip)).toEqual(activityFrom(parityLogs, ME).map(strip));
  });
});

describe("toDashboardJson from the indexer", () => {
  it("keeps totals over every event but sends only the newest feed rows", () => {
    const count = FEED_LIMIT + 5;
    const many = Array.from({ length: count }, (_, i) => indexed(count - i, "impression", "released", { paid: true }));
    const json = toDashboardJson({
      address: ME,
      clearing: OTHER,
      usdc: 0n,
      credit: 0n,
      mon: 0n,
      activity: activityFromIndexed(many),
      range: { fromBlock: 10n, toBlock: 20n },
      source: "envio",
    });
    expect(json.activity).toHaveLength(FEED_LIMIT);
    expect(json.activity[0].requestId).toBe(`req_${count}`);
    expect(json.totals.impressions).toBe(count);
    expect(json).toMatchObject({ source: "envio", fromBlock: "10", toBlock: "20" });
    expect(json.activity[0]).not.toHaveProperty("blockNumber");
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});

describe("loadDashboard", () => {
  const HEAD = 70_496_000n;

  function stubRpc() {
    const rpc = {
      getBlock: vi.fn(async (args?: { blockNumber?: bigint }) => ({
        number: args?.blockNumber ?? HEAD,
        timestamp: args?.blockNumber ? 1_000n : 9_000n,
      })),
      getLogs: vi.fn(async () => []),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "credit" ? 0n : 530_000n,
      ),
      getBalance: vi.fn(async () => 7n),
    };
    return { rpc, client: rpc as unknown as PublicClient };
  }

  it("serves totals and the feed from Envio without reading logs", async () => {
    const { rpc, client } = stubRpc();
    const index = await liveIndex();
    const json = await loadDashboard(LIVE_PUBLISHER, client, async () => index);
    expect(json.source).toBe("envio");
    expect(json.totals).toMatchObject({ paid: "530000", impressions: 3, clicks: 2, rejected: 2, pendingCount: 0 });
    expect(json.activity).toHaveLength(7);
    expect(json.activity[0].time).toBe(1791835792);
    expect(json).toMatchObject({ trustScoreBps: 7143, fromBlock: "70478614", toBlock: "70496822", usdc: "530000" });
    expect(rpc.getLogs).not.toHaveBeenCalled();
    expect(rpc.getBlock).not.toHaveBeenCalled();
  });

  it("falls back to contract logs when Envio is unreachable", async () => {
    const { rpc, client } = stubRpc();
    const json = await loadDashboard(LIVE_PUBLISHER, client, async () => null);
    expect(json.source).toBe("logs");
    expect(json.trustScoreBps).toBeNull();
    expect(rpc.getLogs).toHaveBeenCalled();
    expect(json.toBlock).toBe(HEAD.toString());
  });
});
