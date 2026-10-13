import { describe, expect, it } from "vitest";
import { NO_ACTIONS, reduceActions, type ActionEvent, type Actions } from "../components/advertise/campaign/actions";
import { ago, toCampaignView, verificationLine } from "../components/advertise/campaign/view-model";
import type { CampaignStatsJson } from "../lib/advertiser-data";

const NOW = 1_700_000_100;

const json: CampaignStatsJson = {
  slug: "crema-works-a1b2",
  brand: "Crema Works",
  url: "https://crema.works",
  status: "live",
  claims: ["Compact espresso machines for kitchens.", "Free EU shipping in 3 days."],
  funds: { budget: "5000000", spent: "980000", remaining: "3770000", pending: "250000", refunded: "0" },
  counts: {
    impressions: 48,
    clicks: 3,
    verified: 50,
    beingVerified: 1,
    rejected: 2,
    rejectedBy: { not_viewed: 1, no_redirect: 0, disputed: 1 },
  },
  sentences: [
    {
      eventId: "0x01",
      requestId: "req_a",
      kind: "Impression",
      rationale: "Crema Works offers free EU shipping in 3 days.",
      price: "10000",
      status: "being_verified",
      reason: null,
      time: NOW - 4,
      disputeSecondsLeft: 16,
    },
    {
      eventId: "0x02",
      requestId: "req_b",
      kind: "Click",
      rationale: "Crema Works makes compact machines with a 15-bar pump.",
      price: "250000",
      status: "verified",
      reason: null,
      time: NOW - 12,
      disputeSecondsLeft: 0,
    },
    {
      eventId: "0x03",
      requestId: "req_c",
      kind: "Impression",
      rationale: "Crema Works ships in 3 days.",
      price: "10000",
      status: "rejected",
      reason: "disputed",
      time: NOW - 600,
      disputeSecondsLeft: 0,
    },
  ],
  account: {
    campaignId: `0x${"ab".repeat(32)}`,
    treasury: "0x00000000000000000000000000000000000000bb",
    txHash: `0x${"cd".repeat(32)}`,
    clearing: "0x00000000000000000000000000000000000000aa",
    network: "Monad testnet",
  },
  now: NOW,
  source: "envio",
  fromBlock: "1",
  toBlock: "2",
};

describe("toCampaignView", () => {
  const view = toCampaignView(json, NOW);

  it("shows the money and delivery cards from the spec", () => {
    expect(view.cards.map((c) => [c.label, c.value, c.hint])).toEqual([
      ["Spent", "$0.98", "of $5.00"],
      ["Remaining", "$3.77", null],
      ["Pending", "$0.25", "being verified"],
      ["Impressions", "48", null],
      ["Clicks", "3", null],
      ["CTR", "6.3%", null],
    ]);
    expect(view.status).toEqual({ label: "Live", tone: "good" });
    expect(view.endedNotice).toBeNull();
  });

  it("writes one verification line with rejection reasons", () => {
    expect(view.verification).toBe("Verified 50 · Being verified 1 · Rejected 2 (not viewed 1, disputed 1)");
  });

  it("describes each sentence with kind, status, price and age, and links its proof", () => {
    expect(view.sentences.map((s) => s.meta)).toEqual([
      "Impression · being verified · $0.01 · 4 s ago",
      "Click · verified · $0.25 · 12 s ago",
      "Impression · rejected · disputed · 10 min ago",
    ]);
    expect(view.sentences[0]).toMatchObject({ receiptUrl: "/receipt/req_a", disputeSecondsLeft: 16 });
  });

  it("uses no crypto words or hex outside account details", () => {
    const { account, ...visible } = view;
    expect(account.network).toBe("Monad testnet");
    const text = JSON.stringify(visible).replace(/"eventId":"[^"]*"/g, "");
    expect(text).not.toMatch(/wallet|gas|usdc|signature|0x[0-9a-f]/i);
  });

  it("states the refund once ended", () => {
    const ended = toCampaignView(
      { ...json, status: "ended", funds: { ...json.funds, remaining: "0", refunded: "3770000" } },
      NOW,
    );
    expect(ended.status.label).toBe("Ended");
    expect(ended.endedNotice).toBe("Ended. $3.77 returned.");
  });
});

describe("toCampaignView data source", () => {
  it("names Envio and the indexed blocks, and scopes the sentences to all history", () => {
    const view = toCampaignView({ ...json, fromBlock: "70726907", toBlock: "70772183" }, NOW);
    expect(view.account).toMatchObject({
      source: "Indexed by Envio HyperIndex",
      blocksLabel: "Blocks indexed",
      blocks: "70726907–70772183",
    });
    expect(view.recent).toEqual({
      aside: "Latest 3 of 53",
      empty: "Nothing yet. When an AI answer recommends Crema Works, the sentence shows up here within a minute.",
    });
  });

  it("says when every sentence is shown", () => {
    const counts = { ...json.counts, impressions: 2, clicks: 1, verified: 2, beingVerified: 1, rejected: 0 };
    expect(toCampaignView({ ...json, counts }, NOW).recent.aside).toBe("All sentences");
  });

  it("names contract logs and limits the scope to the last 2 hours", () => {
    const logs = toCampaignView({ ...json, source: "logs" }, NOW);
    expect(logs.account).toMatchObject({ source: "Read from contract logs", blocksLabel: "Blocks scanned", blocks: "1–2" });
    expect(logs.recent).toEqual({
      aside: "Latest 3 of 53 in the last 2 hours",
      empty: "Nothing in the last 2 hours. When an AI answer recommends Crema Works, the sentence shows up here within seconds.",
    });
    const counts = { ...json.counts, impressions: 2, clicks: 1, rejected: 0 };
    expect(toCampaignView({ ...json, source: "logs", counts }, NOW).recent.aside).toBe("Last 2 hours");
    expect(toCampaignView({ ...json, source: "logs", sentences: [] }, NOW).recent.aside).toBeUndefined();
  });
});

describe("toCampaignView with page actions", () => {
  const after = (...events: ActionEvent[]): Actions => events.reduce(reduceActions, NO_ACTIONS);

  it("marks a sentence being disputed, then disputed once the tx is in", () => {
    const sending = toCampaignView(json, NOW, after({ type: "dispute-start", eventId: "0x01" }));
    expect(sending.sentences[0]).toMatchObject({ dispute: { phase: "sending" }, disputeSecondsLeft: 16 });

    const sent = toCampaignView(
      json,
      NOW,
      after({ type: "dispute-start", eventId: "0x01" }, { type: "dispute-done", eventId: "0x01" }),
    );
    expect(sent.sentences[0]).toMatchObject({
      meta: "Impression · disputed · being verified · $0.01 · 4 s ago",
      tone: "warn",
      disputeSecondsLeft: 0,
    });
    expect(sent.sentences[1].dispute).toBeNull();
  });

  it("keeps the window open and shows the error when a dispute fails", () => {
    const failed = toCampaignView(
      json,
      NOW,
      after({ type: "dispute-start", eventId: "0x01" }, { type: "dispute-failed", eventId: "0x01", message: "Closed." }),
    );
    expect(failed.sentences[0]).toMatchObject({ dispute: { phase: "error", message: "Closed." }, disputeSecondsLeft: 16 });
  });

  it("shows Ending while End is sending, then Ended with the refund", () => {
    const sending = toCampaignView(json, NOW, after({ type: "end-ask" }, { type: "end-start" }));
    expect(sending.status).toEqual({ label: "Ending", tone: "warn" });
    expect(sending.endable).toBe(true);
    expect(sending.endedNotice).toBeNull();

    const ended = toCampaignView(json, NOW, after({ type: "end-ask" }, { type: "end-start" }, { type: "end-done", refunded: 377 }));
    expect(ended.status).toEqual({ label: "Ended", tone: "idle" });
    expect(ended.endable).toBe(false);
    expect(ended.endedNotice).toBe("Ended. $3.77 returned.");
  });

  it("returns to Live with the error when End fails", () => {
    const failed = toCampaignView(
      json,
      NOW,
      after({ type: "end-ask" }, { type: "end-start" }, { type: "end-failed", message: "Try again." }),
    );
    expect(failed.status.label).toBe("Live");
    expect(failed.endable).toBe(true);
  });

  it("hides End for a campaign another tab is ending", () => {
    expect(toCampaignView({ ...json, status: "ending" }, NOW).endable).toBe(false);
  });
});

describe("reduceActions", () => {
  it("asks before ending and can cancel", () => {
    const asked = reduceActions(NO_ACTIONS, { type: "end-ask" });
    expect(asked.end).toEqual({ phase: "confirming" });
    expect(reduceActions(asked, { type: "end-cancel" }).end).toEqual({ phase: "idle" });
  });

  it("asks again after a failed End", () => {
    const failed = reduceActions(NO_ACTIONS, { type: "end-failed", message: "x" });
    expect(reduceActions(failed, { type: "end-ask" }).end).toEqual({ phase: "confirming" });
  });
});

describe("verificationLine", () => {
  it("omits the reasons when nothing was rejected", () => {
    expect(
      verificationLine({
        impressions: 0,
        clicks: 0,
        verified: 0,
        beingVerified: 0,
        rejected: 0,
        rejectedBy: { not_viewed: 0, no_redirect: 0, disputed: 0 },
      }),
    ).toBe("Verified 0 · Being verified 0 · Rejected 0");
  });
});

describe("ago", () => {
  it("counts seconds under a minute", () => {
    expect(ago(NOW - 12, NOW)).toBe("12 s ago");
    expect(ago(NOW - 120, NOW)).toBe("2 min ago");
  });
});
