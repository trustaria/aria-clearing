import { campaignIdOf } from "@aria-clearing/receipt";
import { describe, expect, it } from "vitest";
import {
  ADVERTISERS,
  activityFrom,
  alignedChunks,
  estimateTime,
  rejectReason,
  scanRange,
  toDashboardJson,
  totalsOf,
  type ClearingLog,
} from "../lib/dashboard-data";

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

describe("ADVERTISERS", () => {
  it("names a campaign by its onchain id", () => {
    expect(ADVERTISERS[LISBON.toLowerCase()]).toBe("Tagus Family Travel");
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
    const activity = activityFrom([logged(1, CLICK), settled(1, 3)], ME);
    const json = toDashboardJson({
      address: ME,
      clearing: OTHER,
      usdc: 260_000n,
      credit: 0n,
      mon: 5n,
      activity,
      range: { fromBlock: 1_000n, toBlock: 2_000n },
      times: [
        { block: 1_000n, time: 100 },
        { block: 2_000n, time: 500 },
      ],
    });
    expect(json).toMatchObject({
      usdc: "260000",
      credit: "0",
      mon: "5",
      totals: { paid: "250000", pending: "0", deferred: "0", clicks: 1 },
      activity: [{ requestId: "req_1", price: "250000", earned: "250000", blockNumber: "1001", time: 100 }],
      fromBlock: "1000",
      toBlock: "2000",
    });
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});
