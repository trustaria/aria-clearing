import { ariaClearingAbi, campaignIdOf, claimsHash, formatClaims } from "@aria-clearing/receipt";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, getAddress, type Address, type Hex, type Log } from "viem";
import { describe, expect, it } from "vitest";
import type { StoredCampaign } from "../lib/campaign-store";
import {
  campaignCreatedIn,
  checkCampaignCreated,
  confirmMismatch,
  disputeMismatch,
  withdrawnBy,
  type CampaignCreatedLog,
} from "../lib/campaign-confirm";
import { disputedLog, withdrawnLog } from "./clearing-logs";

const CLEARING = "0x431e97E2EB23ac06C9f807cC8DCe54499C1bDC7B" as Address;
const OTHER = "0x00000000000000000000000000000000000000c1" as Address;
const WALLET = getAddress("0x9f1c2a8b7e6d5c4b3a2918070605040302010abc");
const SLUG = "crema-works-k3x9";
const CLAIMS = ["Compact espresso machines for kitchens.", "15-bar pump with a steam wand."];

const pending: StoredCampaign = {
  slug: SLUG,
  advertiser: "Crema Works",
  url: "https://crema.works",
  category: "food and drink",
  claims: CLAIMS,
  keywords: [],
  priceImpression: 10_000,
  priceClick: 250_000,
  budget: 5_000_000,
  campaignId: campaignIdOf(SLUG),
  ownerId: "did:privy:ana",
  ownerEmail: "ana@crema.works",
  txHash: "0x",
  createdBlock: 0,
  createdAt: 1,
  status: "pending",
  funding: "wallet",
};

function created(overrides: Partial<CampaignCreatedLog & { claims: string; address: Address }> = {}): Log {
  const claims = overrides.claims ?? formatClaims(CLAIMS);
  const event = getAbiItem({ abi: ariaClearingAbi, name: "CampaignCreated" });
  const topics = encodeEventTopics({
    abi: [event],
    eventName: "CampaignCreated",
    args: { campaignId: overrides.campaignId ?? campaignIdOf(SLUG), advertiser: overrides.advertiser ?? WALLET },
  });
  const data = encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [
      claims,
      overrides.claimsHash ?? claimsHash(claims),
      overrides.priceImpression ?? 10_000n,
      overrides.priceClick ?? 250_000n,
      overrides.budget ?? 5_000_000n,
    ],
  );
  return {
    address: overrides.address ?? CLEARING,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber: 70_800_000n,
    blockHash: `0x${"11".repeat(32)}`,
    transactionHash: `0x${"ab".repeat(32)}`,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as Log;
}

const ok = (logs: Log[]) => ({ status: "success" as const, logs });

describe("campaignCreatedIn", () => {
  it("reads the one CampaignCreated log of the clearing contract", () => {
    const result = campaignCreatedIn(ok([created()]), CLEARING);
    expect(result).toEqual({
      log: {
        campaignId: campaignIdOf(SLUG),
        advertiser: WALLET,
        claimsHash: claimsHash(formatClaims(CLAIMS)),
        priceImpression: 10_000n,
        priceClick: 250_000n,
        budget: 5_000_000n,
      },
    });
  });

  it("refuses a reverted receipt", () => {
    expect(campaignCreatedIn({ status: "reverted", logs: [created()] }, CLEARING)).toEqual({ error: "reverted" });
  });

  it("ignores a CampaignCreated log from another address", () => {
    expect(campaignCreatedIn(ok([created({ address: OTHER })]), CLEARING)).toEqual({ error: "no CampaignCreated log" });
  });

  it("refuses two CampaignCreated logs", () => {
    const second = created({ campaignId: campaignIdOf("other") });
    expect(campaignCreatedIn(ok([created(), second]), CLEARING)).toEqual({ error: "more than one CampaignCreated log" });
  });

  it("matches the clearing address case-insensitively", () => {
    expect("log" in campaignCreatedIn(ok([created()]), CLEARING.toLowerCase() as Address)).toBe(true);
  });
});

describe("confirmMismatch", () => {
  const log = (overrides: Partial<CampaignCreatedLog> = {}): CampaignCreatedLog => ({
    campaignId: campaignIdOf(SLUG),
    advertiser: WALLET,
    claimsHash: claimsHash(formatClaims(CLAIMS)),
    priceImpression: 10_000n,
    priceClick: 250_000n,
    budget: 5_000_000n,
    ...overrides,
  });

  it("accepts a log that matches the pending record and the wallet", () => {
    expect(confirmMismatch(log(), pending, WALLET)).toBeNull();
    expect(confirmMismatch(log({ advertiser: WALLET.toLowerCase() as Address }), pending, WALLET)).toBeNull();
  });

  it.each([
    ["campaign id", { campaignId: campaignIdOf("someone-else") }],
    ["advertiser", { advertiser: OTHER }],
    ["claims", { claimsHash: claimsHash("1. Something else entirely.") }],
    ["price impression", { priceImpression: 1n }],
    ["price click", { priceClick: 1n }],
    ["budget", { budget: 1n }],
  ] as const)("names the %s when it differs", (field, overrides) => {
    expect(confirmMismatch(log(overrides), pending, WALLET)).toBe(field);
  });
});

describe("checkCampaignCreated", () => {
  it("passes a matching receipt", () => {
    expect(checkCampaignCreated(ok([created()]), CLEARING, pending, WALLET)).toBeNull();
  });

  it("names the first problem", () => {
    expect(checkCampaignCreated({ status: "reverted", logs: [] }, CLEARING, pending, WALLET)).toBe("reverted");
    expect(checkCampaignCreated(ok([created({ budget: 1n })]), CLEARING, pending, WALLET)).toBe("budget");
    expect(checkCampaignCreated(ok([created({ advertiser: OTHER })]), CLEARING, pending, WALLET)).toBe("advertiser");
  });
});

describe("wallet dispute and withdraw receipts", () => {
  const EVENT = `0x${"0e".repeat(32)}` as Hex;
  const CAMPAIGN = campaignIdOf(SLUG);
  const sent = (logs: Log[], from: Address = WALLET, status: "success" | "reverted" = "success") => ({ status, from, logs });

  it("accepts a dispute of the event sent by the wallet to the clearing contract", () => {
    expect(disputeMismatch(sent([disputedLog(CLEARING, EVENT)]), CLEARING, WALLET, EVENT)).toBeNull();
  });

  it.each([
    ["reverted", sent([disputedLog(CLEARING, EVENT)], WALLET, "reverted")],
    ["sender", sent([disputedLog(CLEARING, EVENT)], OTHER)],
    ["no EventDisputed log", sent([disputedLog(OTHER, EVENT)])],
    ["no EventDisputed log", sent([disputedLog(CLEARING, `0x${"0f".repeat(32)}`)])],
    ["no EventDisputed log", sent([])],
  ] as const)("refuses a dispute receipt: %s", (reason, receipt) => {
    expect(disputeMismatch(receipt, CLEARING, WALLET, EVENT)).toBe(reason);
  });

  it("reads the withdrawn amount of the campaign", () => {
    expect(withdrawnBy(sent([withdrawnLog(CLEARING, CAMPAIGN, 3_770_000n)]), CLEARING, WALLET, CAMPAIGN)).toEqual({
      amount: 3_770_000n,
    });
  });

  it.each([
    ["reverted", sent([withdrawnLog(CLEARING, CAMPAIGN, 1n)], WALLET, "reverted")],
    ["sender", sent([withdrawnLog(CLEARING, CAMPAIGN, 1n)], OTHER)],
    ["no Withdrawn log", sent([withdrawnLog(OTHER, CAMPAIGN, 1n)])],
    ["no Withdrawn log", sent([withdrawnLog(CLEARING, campaignIdOf("other"), 1n)])],
  ] as const)("refuses a withdraw receipt: %s", (error, receipt) => {
    expect(withdrawnBy(receipt, CLEARING, WALLET, CAMPAIGN)).toEqual({ error });
  });
});
