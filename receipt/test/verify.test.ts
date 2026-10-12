import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { claimsHash, eventIdOf, formatClaims, Kind, requestKeyOf } from "../src/hash";
import {
  buildReceipt,
  chunkRange,
  type CampaignCreatedData,
  type EventLoggedData,
  type ReceiptInput,
} from "../src/verify";

const requestId = "req_0001";
const claims = formatClaims(["Kids under 6 stay free.", "Free cancellation up to 48 hours.", "Breakfast included."]);
const campaignId = keccak256(toBytes("hotel-lumen"));
const publisher = "0x00000000000000000000000000000000000000a1";
const advertiser = "0x00000000000000000000000000000000000000b2";
const rationale = "Hotel Lumen: kids under 6 stay free and you can cancel up to 48 hours before.";
const impressionId = eventIdOf(requestId, Kind.Impression);

function campaignLog(overrides: Partial<CampaignCreatedData> = {}): CampaignCreatedData {
  return {
    campaignId,
    advertiser,
    claims,
    claimsHash: claimsHash(claims),
    blockNumber: 100n,
    txHash: "0xc0",
    ...overrides,
  };
}

function eventLog(overrides: Partial<EventLoggedData> = {}): EventLoggedData {
  return {
    eventId: impressionId,
    requestKey: requestKeyOf(requestId),
    campaignId,
    requestId,
    publisher,
    kind: Kind.Impression,
    rationale,
    rationaleHash: keccak256(toBytes(rationale)),
    claimRefs: [1, 2],
    price: 10_000n,
    blockNumber: 110n,
    txHash: "0xe1",
    ...overrides,
  };
}

function input(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return { campaign: campaignLog(), events: [eventLog()], disputed: [], settled: [], ...overrides };
}

describe("buildReceipt", () => {
  it("is ok when every recomputed hash matches what the chain emitted", () => {
    const receipt = buildReceipt(requestId, input());

    expect(receipt.ok).toBe(true);
    expect(receipt.campaign.claimsMatch).toBe(true);
    expect(receipt.events[0].eventIdMatches).toBe(true);
    expect(receipt.events[0].rationaleMatches).toBe(true);
  });

  it("flags a tampered rationale", () => {
    const tampered = eventLog({ rationale: rationale.replace("48", "72") });

    const receipt = buildReceipt(requestId, input({ events: [tampered] }));

    expect(receipt.events[0].rationaleMatches).toBe(false);
    expect(receipt.ok).toBe(false);
  });

  it("flags a rationale that is not in normalized form even when its hash matches", () => {
    const padded = ` ${rationale} `;
    const log = eventLog({ rationale: padded, rationaleHash: keccak256(toBytes(padded)) });

    const receipt = buildReceipt(requestId, input({ events: [log] }));

    expect(receipt.events[0].rationaleMatches).toBe(false);
  });

  it("flags tampered claims", () => {
    const tampered = campaignLog({ claims: claims.replace("48", "1") });

    const receipt = buildReceipt(requestId, input({ campaign: tampered }));

    expect(receipt.campaign.claimsMatch).toBe(false);
    expect(receipt.ok).toBe(false);
  });

  it("flags an eventId that does not derive from the requestId and kind", () => {
    const wrong = eventLog({ eventId: eventIdOf("other_request", Kind.Impression) });

    const receipt = buildReceipt(requestId, input({ events: [wrong] }));

    expect(receipt.events[0].eventIdMatches).toBe(false);
    expect(receipt.ok).toBe(false);
  });

  it("flags an event whose emitted requestId differs from the one asked about", () => {
    const wrong = eventLog({ requestId: "other_request", eventId: eventIdOf("other_request", Kind.Impression) });

    const receipt = buildReceipt(requestId, input({ events: [wrong] }));

    expect(receipt.events[0].eventIdMatches).toBe(false);
  });

  it("maps 1-based claimRefs to the numbered claim lines", () => {
    const receipt = buildReceipt(requestId, input({ events: [eventLog({ claimRefs: [3, 1] })] }));

    expect(receipt.events[0].citedClaims).toEqual(["3. Breakfast included.", "1. Kids under 6 stay free."]);
  });

  it("is not ok when a claimRef points outside the claims", () => {
    const receipt = buildReceipt(requestId, input({ events: [eventLog({ claimRefs: [1, 9] })] }));

    expect(receipt.events[0].citedClaims).toEqual(["1. Kids under 6 stay free."]);
    expect(receipt.ok).toBe(false);
  });

  it("is not ok when the event belongs to a different campaign than the one supplied", () => {
    const other = eventLog({ campaignId: keccak256(toBytes("someone-else")) });

    expect(buildReceipt(requestId, input({ events: [other] })).ok).toBe(false);
  });

  it("is not ok without any logged event", () => {
    expect(buildReceipt(requestId, input({ events: [] })).ok).toBe(false);
  });

  describe("status", () => {
    it("is logged when nothing followed", () => {
      expect(buildReceipt(requestId, input()).events[0].status).toBe("logged");
    });

    it("is disputed after EventDisputed", () => {
      const receipt = buildReceipt(
        requestId,
        input({ disputed: [{ eventId: impressionId, blockNumber: 120n, txHash: "0xd1" }] }),
      );

      expect(receipt.events[0].status).toBe("disputed");
    });

    it("is released when settled with the Released outcome", () => {
      const receipt = buildReceipt(
        requestId,
        input({ settled: [{ eventId: impressionId, outcome: 3, blockNumber: 130n, txHash: "0x51" }] }),
      );

      expect(receipt.events[0].status).toBe("released");
      expect(receipt.events[0].settledTx).toBe("0x51");
    });

    it("is rejected when a disputed event is settled with the Rejected outcome", () => {
      const receipt = buildReceipt(
        requestId,
        input({
          disputed: [{ eventId: impressionId, blockNumber: 120n, txHash: "0xd1" }],
          settled: [{ eventId: impressionId, outcome: 4, blockNumber: 130n, txHash: "0x52" }],
        }),
      );

      expect(receipt.events[0].status).toBe("rejected");
    });

    it("only applies settlement to the event it names", () => {
      const click = eventLog({ kind: Kind.Click, eventId: eventIdOf(requestId, Kind.Click), txHash: "0xe2" });
      const receipt = buildReceipt(
        requestId,
        input({
          events: [eventLog(), click],
          settled: [{ eventId: impressionId, outcome: 3, blockNumber: 130n, txHash: "0x51" }],
        }),
      );

      expect(receipt.events.map((e) => e.status)).toEqual(["released", "logged"]);
    });
  });

  it("lists lifecycle steps in block order", () => {
    const receipt = buildReceipt(
      requestId,
      input({
        settled: [{ eventId: impressionId, outcome: 3, blockNumber: 130n, txHash: "0x51" }],
        disputed: [{ eventId: impressionId, blockNumber: 120n, txHash: "0xd1" }],
      }),
    );

    expect(receipt.lifecycle.map((step) => step.stage)).toEqual(["campaign", "logged", "disputed", "settled"]);
  });
});

describe("chunkRange", () => {
  it("splits an inclusive range into chunks of at most the given size", () => {
    expect(chunkRange(0n, 249n, 100n)).toEqual([
      { fromBlock: 0n, toBlock: 99n },
      { fromBlock: 100n, toBlock: 199n },
      { fromBlock: 200n, toBlock: 249n },
    ]);
  });

  it("returns one chunk for a range that fits", () => {
    expect(chunkRange(5n, 5n, 100n)).toEqual([{ fromBlock: 5n, toBlock: 5n }]);
  });

  it("returns nothing for an empty range", () => {
    expect(chunkRange(10n, 9n, 100n)).toEqual([]);
  });
});
