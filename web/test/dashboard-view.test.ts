import { describe, expect, it } from "vitest";
import { activitySentence, ctr, formatRate, rejectedSummary, toDashboardView } from "../app/dashboard/view-model";
import type { DashboardJson } from "../lib/dashboard-data";

const ME = "0x67435bD1FCd81D6c25C6546a86af0eF6887F72cb";
const CLEARING = "0xeCED10b07169857eE91441BBDdeb9653bF7cC041";
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const NOW = 10_000;

const base = { kind: "Click" as const, advertiser: "Tagus Family Travel", earned: 0n, reason: null };

describe("activitySentence", () => {
  it("reads each status as a plain sentence", () => {
    expect(activitySentence({ ...base, status: "paid", earned: 250_000n })).toBe(
      "Click on “Tagus Family Travel” — verified, $0.25 paid",
    );
    expect(activitySentence({ ...base, status: "pending" })).toBe("Click on “Tagus Family Travel” — awaiting verification");
    expect(activitySentence({ ...base, status: "disputed" })).toBe(
      "Click on “Tagus Family Travel” — disputed by the advertiser, under review",
    );
    expect(activitySentence({ ...base, status: "deferred", earned: 10_000n })).toBe(
      "Click on “Tagus Family Travel” — verified, $0.01 payout waiting for a retry",
    );
  });

  it("gives the reason for a rejection", () => {
    expect(activitySentence({ ...base, kind: "Impression", advertiser: null, status: "rejected", reason: "not_viewed" })).toBe(
      "Impression — rejected: the ad was never on screen",
    );
    expect(activitySentence({ ...base, status: "rejected", reason: "no_redirect" })).toBe(
      "Click on “Tagus Family Travel” — rejected: the click did not go through the ad link",
    );
    expect(activitySentence({ ...base, status: "rejected", reason: "disputed" })).toBe(
      "Click on “Tagus Family Travel” — rejected: disputed by the advertiser",
    );
  });
});

describe("rejectedSummary", () => {
  it("lists non-zero reasons in one line", () => {
    expect(rejectedSummary({ not_viewed: 2, no_redirect: 1, disputed: 0 })).toBe("2 not viewed · 1 no click redirect");
    expect(rejectedSummary({ not_viewed: 0, no_redirect: 0, disputed: 3 })).toBe("3 disputed by advertiser");
    expect(rejectedSummary({ not_viewed: 0, no_redirect: 0, disputed: 0 })).toBe("Nothing rejected");
  });
});

describe("ctr", () => {
  it("divides clicks by impressions and is null without impressions", () => {
    expect(ctr(4, 1)).toBe(0.25);
    expect(ctr(0, 3)).toBeNull();
  });
});

function json(overrides: Partial<DashboardJson> = {}): DashboardJson {
  return {
    address: ME,
    clearing: CLEARING,
    usdc: "260000",
    credit: "0",
    mon: "0",
    totals: {
      paid: "260000",
      deferred: "0",
      pending: "250000",
      pendingCount: 1,
      impressions: 2,
      clicks: 1,
      rejected: 1,
      rejectedBy: { not_viewed: 1, no_redirect: 0, disputed: 0 },
    },
    activity: [
      {
        eventId: H(2),
        requestId: "req 2",
        kind: "Click",
        advertiser: "Tagus Family Travel",
        price: "250000",
        earned: "250000",
        status: "paid",
        reason: null,
        blockNumber: "1002",
        txHash: H(502),
        settledTx: H(702),
        time: NOW - 120,
      },
      {
        eventId: H(1),
        requestId: "req_1",
        kind: "Impression",
        advertiser: null,
        price: "10000",
        earned: "0",
        status: "rejected",
        reason: "not_viewed",
        blockNumber: "1001",
        txHash: H(501),
        settledTx: H(701),
        time: NOW - 7_200,
      },
    ],
    fromBlock: "1000",
    toBlock: "2000",
    ...overrides,
  };
}

describe("toDashboardView", () => {
  it("renders the overview cards in dollars and counts", () => {
    const view = toDashboardView(json(), NOW);
    expect(view.cards.map((c) => [c.label, c.value, c.hint])).toEqual([
      ["Earnings", "$0.26", "Paid out to you"],
      ["Pending verification", "$0.25", "1 event being checked"],
      ["Impressions", "2", "Ads seen in your app"],
      ["Clicks", "1", "Through the ad link"],
      ["CTR", "50.0%", "Clicks per impression"],
      ["Rejected", "1", "1 not viewed"],
    ]);
    expect(view.balance).toBe("$0.26");
    expect(view.publisherId).toBe("pk_live_••••72cb");
  });

  it("turns activity into sentences linked to their receipts", () => {
    const view = toDashboardView(json(), NOW);
    expect(view.feed).toEqual([
      {
        eventId: H(2),
        sentence: "Click on “Tagus Family Travel” — verified, $0.25 paid",
        tone: "good",
        when: "2 min ago",
        receiptUrl: "/receipt/req%202",
      },
      {
        eventId: H(1),
        sentence: "Impression — rejected: the ad was never on screen",
        tone: "bad",
        when: "2 h ago",
        receiptUrl: "/receipt/req_1",
      },
    ]);
    expect(view.latestReceiptUrl).toBe("/receipt/req%202");
  });

  it("offers a retry only when a payout is waiting as credit", () => {
    expect(toDashboardView(json(), NOW).retryAmount).toBeNull();
    expect(toDashboardView(json({ credit: "10000" }), NOW).retryAmount).toBe("$0.01");
  });

  it("handles a publisher with no activity", () => {
    const view = toDashboardView(
      json({
        activity: [],
        totals: {
          paid: "0",
          deferred: "0",
          pending: "0",
          pendingCount: 0,
          impressions: 0,
          clicks: 0,
          rejected: 0,
          rejectedBy: { not_viewed: 0, no_redirect: 0, disputed: 0 },
        },
      }),
      NOW,
    );
    expect(view.cards.find((c) => c.key === "ctr")?.value).toBe("—");
    expect(view.cards.find((c) => c.key === "pending")?.hint).toBe("Nothing waiting");
    expect(view.latestReceiptUrl).toBeNull();
  });
});

describe("verification rate", () => {
  it("formats basis points as a percentage", () => {
    expect(formatRate(10_000)).toBe("100%");
    expect(formatRate(9_550)).toBe("95.5%");
    expect(formatRate(0)).toBe("0%");
  });

  it("adds the card when the rate is known", () => {
    const view = toDashboardView(json({ trustScoreBps: 10_000 }), NOW);
    expect(view.cards.find((c) => c.key === "verification")).toEqual({
      key: "verification",
      label: "Verification rate",
      value: "100%",
      hint: "Share of your ads verified by Chainlink",
    });
    expect(view.hasVerificationRate).toBe(true);
  });

  it("hides the card when the rate is null or missing", () => {
    for (const overrides of [{ trustScoreBps: null }, {}]) {
      const view = toDashboardView(json(overrides), NOW);
      expect(view.cards.some((c) => c.key === "verification")).toBe(false);
      expect(view.hasVerificationRate).toBe(false);
    }
  });
});
