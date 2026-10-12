import { campaignIdOf } from "@aria-clearing/receipt";
import { describe, expect, it } from "vitest";
import {
  campaignSentences,
  countsOf,
  fundsOf,
  scanWindow,
  toCampaignStatsJson,
  type CampaignLog,
} from "../lib/advertiser-data";
import type { StoredCampaign } from "../lib/campaign-store";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const MINE = campaignIdOf("crema-works-a1b2");
const OTHER = campaignIdOf("lisbon-family-trips");
const IMPRESSION = 0;
const CLICK = 1;
const RELEASED = 3;
const REJECTED = 4;

function logged(n: number, kind: number, campaignId: `0x${string}` = MINE): CampaignLog {
  return {
    type: "logged",
    eventId: H(n),
    requestId: `req_${n}`,
    campaignId,
    kind,
    price: kind === CLICK ? 250_000n : 10_000n,
    rationale: `Sentence ${n}.`,
    blockNumber: 1_000n + BigInt(n),
    txHash: H(500 + n),
  };
}
const settled = (n: number, outcome: number): CampaignLog => ({
  type: "settled",
  eventId: H(n),
  outcome,
  blockNumber: 2_000n + BigInt(n),
  txHash: H(700 + n),
});
const disputed = (n: number): CampaignLog => ({ type: "disputed", eventId: H(n), blockNumber: 1_500n, txHash: H(600 + n) });
const paid = (n: number): CampaignLog => ({ type: "paid", eventId: H(n), blockNumber: 2_000n + BigInt(n), txHash: H(700 + n) });

/** Verified click and impression, one pending, one disputed and open, one rejected unseen, one rejected disputed. */
const logs: CampaignLog[] = [
  logged(1, CLICK),
  logged(2, IMPRESSION),
  logged(3, IMPRESSION),
  logged(4, IMPRESSION),
  logged(5, IMPRESSION),
  logged(6, IMPRESSION),
  logged(7, CLICK),
  logged(8, IMPRESSION, OTHER),
  settled(1, RELEASED),
  paid(1),
  paid(2),
  disputed(4),
  settled(5, REJECTED),
  disputed(6),
  settled(6, REJECTED),
  settled(7, REJECTED),
  settled(8, RELEASED),
];

function crema(overrides: Partial<StoredCampaign> = {}): StoredCampaign {
  return {
    slug: "crema-works-a1b2",
    advertiser: "Crema Works",
    url: "https://crema.works",
    category: "food and drink",
    claims: ["Compact espresso machines for kitchens.", "Free EU shipping in 3 days."],
    priceImpression: 10_000,
    priceClick: 250_000,
    budget: 5_000_000,
    keywords: ["espresso machine"],
    campaignId: MINE,
    ownerId: "did:privy:ana",
    ownerEmail: "ana@crema.works",
    txHash: H(42),
    createdBlock: 900,
    createdAt: 1,
    status: "live",
    ...overrides,
  };
}

describe("fundsOf", () => {
  it("derives spent so that spent + remaining + pending + refunded = budget", () => {
    const funds = fundsOf({ budget: 5_000_000n, available: 3_770_000n, reserved: 250_000n, refunded: 0n });
    expect(funds).toEqual({ budget: 5_000_000n, spent: 980_000n, remaining: 3_770_000n, pending: 250_000n, refunded: 0n });
    expect(funds.spent + funds.remaining + funds.pending + funds.refunded).toBe(funds.budget);
  });

  it("subtracts the refund of an ended campaign", () => {
    const funds = fundsOf({ budget: 5_000_000n, available: 0n, reserved: 10_000n, refunded: 3_770_000n });
    expect(funds.spent).toBe(1_220_000n);
    expect(funds.spent + funds.remaining + funds.pending + funds.refunded).toBe(funds.budget);
  });

  it("never reports negative spend", () => {
    expect(fundsOf({ budget: 1_000_000n, available: 1_000_000n, reserved: 0n, refunded: 1_000_000n }).spent).toBe(0n);
  });
});

describe("campaignSentences", () => {
  it("keeps only this campaign's events, newest first, with status and reason", () => {
    const rows = campaignSentences(logs, MINE);
    expect(rows.map((r) => [r.requestId, r.kind, r.status, r.reason])).toEqual([
      ["req_7", "Click", "rejected", "no_redirect"],
      ["req_6", "Impression", "rejected", "disputed"],
      ["req_5", "Impression", "rejected", "not_viewed"],
      ["req_4", "Impression", "disputed", null],
      ["req_3", "Impression", "being_verified", null],
      ["req_2", "Impression", "verified", null],
      ["req_1", "Click", "verified", null],
    ]);
    expect(rows[6]).toMatchObject({ rationale: "Sentence 1.", price: 250_000n, txHash: H(501) });
  });

  it("matches the campaign id regardless of case", () => {
    expect(campaignSentences(logs, MINE.toUpperCase().replace("0X", "0x") as `0x${string}`)).toHaveLength(7);
  });
});

describe("countsOf", () => {
  it("excludes rejected events from impressions and clicks and splits rejections by reason", () => {
    expect(countsOf(campaignSentences(logs, MINE))).toEqual({
      impressions: 3,
      clicks: 1,
      verified: 2,
      beingVerified: 2,
      rejected: 3,
      rejectedBy: { not_viewed: 1, no_redirect: 1, disputed: 1 },
    });
  });
});

describe("scanWindow", () => {
  it("starts at the campaign's creation block when it is recent", () => {
    expect(scanWindow(30_000n, 25_000n, 20_000n)).toEqual({ fromBlock: 25_000n, toBlock: 30_000n });
  });

  it("clips older campaigns to the last `blocks` blocks", () => {
    expect(scanWindow(100_000n, 10n, 20_000n)).toEqual({ fromBlock: 80_001n, toBlock: 100_000n });
  });
});

describe("toCampaignStatsJson", () => {
  const sentences = campaignSentences(logs, MINE);
  const times = new Map<bigint, number>(sentences.map((s) => [s.blockNumber, 1_700_000_000 + Number(s.blockNumber)]));
  const now = 1_700_000_000 + 1_003 + 6;

  const json = toCampaignStatsJson({
    record: crema(),
    onchain: { advertiser: "0x00000000000000000000000000000000000000bb", available: 3_770_000n, reserved: 20_000n },
    sentences,
    times,
    now,
    clearing: "0x00000000000000000000000000000000000000aa",
    range: { fromBlock: 900n, toBlock: 1_100n },
    disputeWindow: 20,
  });

  it("serialises funds as strings that add up to the budget", () => {
    const { budget, spent, remaining, pending, refunded } = json.funds;
    expect(BigInt(spent) + BigInt(remaining) + BigInt(pending) + BigInt(refunded)).toBe(BigInt(budget));
    expect(json.funds).toEqual({ budget: "5000000", spent: "1210000", remaining: "3770000", pending: "20000", refunded: "0" });
  });

  it("gives each sentence its time and the dispute window left only while it can be disputed", () => {
    const pending = json.sentences.find((s) => s.requestId === "req_3");
    expect(pending).toMatchObject({ time: 1_700_001_003, disputeSecondsLeft: 14, price: "10000", kind: "Impression" });
    expect(json.sentences.find((s) => s.requestId === "req_4")?.disputeSecondsLeft).toBe(0);
    expect(json.sentences.find((s) => s.requestId === "req_1")?.disputeSecondsLeft).toBe(0);
  });

  it("carries the record, counts and account details", () => {
    expect(json).toMatchObject({
      slug: "crema-works-a1b2",
      brand: "Crema Works",
      status: "live",
      claims: crema().claims,
      counts: { impressions: 3, clicks: 1 },
      account: {
        campaignId: MINE,
        treasury: "0x00000000000000000000000000000000000000bb",
        txHash: H(42),
        clearing: "0x00000000000000000000000000000000000000aa",
      },
      scanned: { fromBlock: "900", toBlock: "1100" },
    });
  });

  it("reports the recorded refund of an ended campaign", () => {
    const ended = toCampaignStatsJson({
      record: crema({ status: "ended", refunded: 3_770_000 }),
      onchain: { advertiser: "0x00000000000000000000000000000000000000bb", available: 0n, reserved: 0n },
      sentences: [],
      times: new Map(),
      now,
      clearing: "0x00000000000000000000000000000000000000aa",
      range: { fromBlock: 900n, toBlock: 1_100n },
      disputeWindow: 20,
    });
    expect(ended.funds).toMatchObject({ refunded: "3770000", remaining: "0", spent: "1230000" });
  });
});
