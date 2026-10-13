import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { claimsHash, eventIdOf, formatClaims, Kind, rationaleHash, requestKeyOf } from "../src/hash";
import {
  buildReceipt,
  withExpected,
  chunkRange,
  feeOf,
  findBlockAtTimestamp,
  scanBackward,
  type CampaignCreatedData,
  type EventLoggedData,
  type EventView,
  type PayoutData,
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

describe("buildReceipt payment split", () => {
  const released = { eventId: impressionId, outcome: 3, blockNumber: 130n, txHash: "0x51" as const };
  const paid = (overrides: Partial<PayoutData> = {}): PayoutData => ({
    eventId: impressionId,
    publisher,
    amount: 8_000n,
    fee: 2_000n,
    deferred: false,
    blockNumber: 130n,
    txHash: "0x51",
    ...overrides,
  });
  const split = (overrides: Partial<ReceiptInput> = {}) =>
    buildReceipt(requestId, input({ settled: [released], payouts: [paid()], feeBps: 2000, ...overrides }));

  it("passes when the publisher amount plus the Aria fee is the price at the contract's rate", () => {
    const receipt = split();

    expect(receipt.feeBps).toBe(2000);
    expect(receipt.events[0].payout).toEqual({ amount: 8_000n, fee: 2_000n, deferred: false, txHash: "0x51" });
    expect(receipt.events[0].splitMatches).toBe(true);
    expect(receipt.ok).toBe(true);
  });

  it("fails when the publisher amount plus the fee is not the price", () => {
    const receipt = split({ payouts: [paid({ amount: 9_000n })] });

    expect(receipt.events[0].splitMatches).toBe(false);
    expect(receipt.consistent).toBe(false);
    expect(receipt.ok).toBe(false);
  });

  it("fails when the fee adds up but is not price * feeBps / 10000", () => {
    const receipt = split({ payouts: [paid({ amount: 7_000n, fee: 3_000n })] });

    expect(receipt.events[0].splitMatches).toBe(false);
    expect(receipt.ok).toBe(false);
  });

  it("rounds the fee down", () => {
    const receipt = split({
      events: [eventLog({ price: 1n })],
      payouts: [paid({ amount: 1n, fee: 0n })],
    });

    expect(receipt.events[0].splitMatches).toBe(true);
  });

  it("checks only the sum when the fee rate is unknown", () => {
    const receipt = split({ feeBps: undefined, payouts: [paid({ amount: 7_000n, fee: 3_000n })] });

    expect(receipt.feeBps).toBeNull();
    expect(receipt.events[0].splitMatches).toBe(true);
  });

  it("reads a deferred payout the same way", () => {
    const receipt = split({ payouts: [paid({ deferred: true })] });

    expect(receipt.events[0].payout?.deferred).toBe(true);
    expect(receipt.events[0].splitMatches).toBe(true);
  });

  it("stays ok when a released event's payout log was not found", () => {
    const receipt = split({ payouts: [] });

    expect(receipt.events[0].payout).toBeNull();
    expect(receipt.events[0].splitMatches).toBe(true);
    expect(receipt.ok).toBe(true);
  });

  it("fails when a rejected event was paid", () => {
    const receipt = split({ settled: [{ ...released, outcome: 4 }] });

    expect(receipt.events[0].status).toBe("rejected");
    expect(receipt.events[0].splitMatches).toBe(false);
  });

  it("fails when the payout went to another publisher", () => {
    const receipt = split({ payouts: [paid({ publisher: advertiser })] });

    expect(receipt.events[0].splitMatches).toBe(false);
  });

  it("feeOf takes price * feeBps / 10000 rounded down", () => {
    expect(feeOf(10_000n, 2000)).toBe(2_000n);
    expect(feeOf(4n, 2000)).toBe(0n);
    expect(feeOf(250_001n, 2000)).toBe(50_000n);
  });
});

describe("buildReceipt with expected values", () => {
  const contract = "0xfb6bA8e6c48c806AFC40aFee5F85deE42Ce8F2fb";
  const seenInput = input({ contract, chainId: 10143 });
  const cardReceipt = {
    chainId: 10143,
    contract,
    campaignId,
    claimsHash: claimsHash(claims),
    rationaleHash: rationaleHash(rationale),
  };
  const otherHash = keccak256(toBytes("something else"));

  it("has no seen checks and stays ok without expected values", () => {
    const receipt = buildReceipt(requestId, seenInput);

    expect(receipt.seen).toBeNull();
    expect(receipt.consistent).toBe(true);
    expect(receipt.ok).toBe(true);
  });

  it("matches every field of the card's receipt", () => {
    const receipt = buildReceipt(requestId, seenInput, cardReceipt);

    expect(receipt.seen).toEqual([
      { field: "chainId", expected: "10143", actual: "10143", matches: true },
      { field: "contract", expected: contract, actual: contract, matches: true },
      { field: "campaignId", expected: campaignId, actual: campaignId, matches: true },
      { field: "claimsHash", expected: claimsHash(claims), actual: claimsHash(claims), matches: true },
      { field: "rationaleHash", expected: rationaleHash(rationale), actual: rationaleHash(rationale), matches: true },
    ]);
    expect(receipt.ok).toBe(true);
  });

  it("compares hex and addresses case-insensitively", () => {
    const receipt = buildReceipt(requestId, seenInput, {
      contract: contract.toLowerCase(),
      rationaleHash: rationaleHash(rationale).toUpperCase().replace("0X", "0x"),
    });

    expect(receipt.seen!.every((c) => c.matches)).toBe(true);
  });

  it.each([
    ["chainId", { chainId: 1 }],
    ["contract", { contract: "0x0000000000000000000000000000000000000001" }],
    ["campaignId", { campaignId: keccak256(toBytes("other-campaign")) }],
    ["claimsHash", { claimsHash: otherHash }],
    ["rationaleHash", { rationaleHash: otherHash }],
  ] as const)("flags a %s that differs from the logged one", (field, override) => {
    const receipt = buildReceipt(requestId, seenInput, { ...cardReceipt, ...override });

    expect(receipt.seen!.filter((c) => !c.matches).map((c) => c.field)).toEqual([field]);
    expect(receipt.consistent).toBe(true);
    expect(receipt.ok).toBe(false);
  });

  it("does not match a chainId or contract it was not told about", () => {
    const receipt = buildReceipt(requestId, input(), { chainId: 10143, contract });

    expect(receipt.seen).toEqual([
      { field: "chainId", expected: "10143", actual: null, matches: false },
      { field: "contract", expected: contract, actual: null, matches: false },
    ]);
  });

  it("requires every logged event to carry the expected rationaleHash", () => {
    const click = eventLog({
      eventId: eventIdOf(requestId, Kind.Click),
      kind: Kind.Click,
      rationale: "A different sentence.",
      rationaleHash: keccak256(toBytes("A different sentence.")),
    });
    const receipt = buildReceipt(requestId, input({ events: [eventLog(), click] }), {
      rationaleHash: rationaleHash(rationale),
    });

    expect(receipt.seen![0].matches).toBe(false);
    expect(receipt.ok).toBe(false);
  });

  it("matches the hash of a sentence the reader copied with extra spaces or decomposed accents", () => {
    const accented = "Café Lumen: kids under 6 stay free.";
    const logged = eventLog({ rationale: accented, rationaleHash: keccak256(toBytes(accented)) });
    const copied = `  ${accented.normalize("NFD")}\n`;
    const receipt = buildReceipt(requestId, input({ events: [logged] }), { rationaleHash: rationaleHash(copied) });

    expect(receipt.seen![0].matches).toBe(true);
  });

  it("withExpected adds seen checks to an already built receipt", () => {
    const built = buildReceipt(requestId, seenInput);

    expect(withExpected(built, { rationaleHash: otherHash }).ok).toBe(false);
    expect(withExpected(built, { rationaleHash: rationaleHash(rationale) }).ok).toBe(true);
    expect(withExpected(built, undefined).seen).toBeNull();
  });

  it("is not ok when the logged event is inconsistent even if the expected values match", () => {
    const tampered = eventLog({ rationaleHash: otherHash });
    const receipt = buildReceipt(requestId, input({ events: [tampered] }), { rationaleHash: otherHash });

    expect(receipt.seen![0].matches).toBe(true);
    expect(receipt.consistent).toBe(false);
    expect(receipt.ok).toBe(false);
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

describe("buildReceipt with on-chain views", () => {
  const view: EventView = {
    status: 3,
    campaignId,
    publisher,
    price: 10_000n,
    loggedAt: 1_000n,
  };

  it("takes status from the view when no settlement log was found", () => {
    const receipt = buildReceipt(requestId, input({ views: { [impressionId]: view } }));

    expect(receipt.events[0].status).toBe("released");
    expect(receipt.events[0].settledTx).toBeUndefined();
    expect(receipt.ok).toBe(true);
  });

  it("prefers the view over a log-derived status", () => {
    const receipt = buildReceipt(
      requestId,
      input({
        views: { [impressionId]: { ...view, status: 2 } },
        settled: [{ eventId: impressionId, outcome: 3, blockNumber: 130n, txHash: "0x51" }],
      }),
    );

    expect(receipt.events[0].status).toBe("disputed");
  });

  it("flags a view that disagrees with the logged event", () => {
    const receipt = buildReceipt(requestId, input({ views: { [impressionId]: { ...view, price: 1n } } }));

    expect(receipt.events[0].viewMatches).toBe(false);
    expect(receipt.ok).toBe(false);
  });

  it("verifies the claims hash from the view when the claims text is unavailable", () => {
    const campaign = campaignLog({ claims: null, blockNumber: null, txHash: null });

    const receipt = buildReceipt(requestId, input({ campaign, events: [eventLog({ claimRefs: [] })] }));

    expect(receipt.campaign.claims).toBeNull();
    expect(receipt.campaign.claimsMatch).toBeNull();
    expect(receipt.events[0].citedClaims).toEqual([]);
    expect(receipt.ok).toBe(true);
    expect(receipt.lifecycle.map((step) => step.stage)).toEqual(["logged"]);
  });

  it("flags an emitted claimsHash that differs from the one the view reports", () => {
    const campaign = campaignLog({ claims: null, claimsHash: keccak256(toBytes("something else")) });

    const receipt = buildReceipt(requestId, input({ campaign, claimsHashOnChain: claimsHash(claims) }));

    expect(receipt.campaign.claimsMatch).toBe(false);
  });
});

describe("findBlockAtTimestamp", () => {
  // One block every 0.4 s: two blocks per second, then three.
  const timestampOf = async (block: bigint) => 1_000n + (block * 2n) / 5n;

  it("finds the first block whose timestamp reaches the target", async () => {
    const block = await findBlockAtTimestamp(timestampOf, 0n, 10_000n, 1_100n);

    expect(await timestampOf(block)).toBeGreaterThanOrEqual(1_100n);
    expect(await timestampOf(block - 1n)).toBeLessThan(1_100n);
  });

  it("uses logarithmically many lookups", async () => {
    let calls = 0;
    await findBlockAtTimestamp(async (b) => (calls++, timestampOf(b)), 0n, 100_000_000n, 1_000_000n);

    expect(calls).toBeLessThanOrEqual(30);
  });

  it("returns the lower bound when the target predates it", async () => {
    expect(await findBlockAtTimestamp(timestampOf, 50n, 100n, 0n)).toBe(50n);
  });

  it("returns the upper bound when the target is later than every block", async () => {
    expect(await findBlockAtTimestamp(timestampOf, 0n, 100n, 9_999n)).toBe(100n);
  });
});

describe("scanBackward", () => {
  const fetcher = (hitBlock: bigint | null) => {
    const calls: { fromBlock: bigint; toBlock: bigint }[] = [];
    const getChunk = async (r: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push(r);
      return hitBlock !== null && hitBlock >= r.fromBlock && hitBlock <= r.toBlock ? [hitBlock] : [];
    };
    return { calls, getChunk };
  };

  it("finds a hit in the starting chunk", async () => {
    const { getChunk } = fetcher(995n);
    expect(await scanBackward(1000n, 0n, 100n, 200, 4, getChunk)).toEqual([995n]);
  });

  it("finds a hit many chunks back and stops after the batch that holds it", async () => {
    const { calls, getChunk } = fetcher(250n);
    expect(await scanBackward(10_000n, 0n, 100n, 200, 4, getChunk)).toEqual([250n]);
    expect(calls.length).toBeLessThanOrEqual(100 + 4);
  });

  it("respects the chunk bound", async () => {
    const { calls, getChunk } = fetcher(0n);
    expect(await scanBackward(10_000n, 0n, 100n, 5, 2, getChunk)).toEqual([]);
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.fromBlock >= 9_501n)).toBe(true);
  });

  it("never goes below the floor and clips the last chunk", async () => {
    const { calls, getChunk } = fetcher(null);
    expect(await scanBackward(250n, 120n, 100n, 200, 4, getChunk)).toEqual([]);
    expect(Math.min(...calls.map((c) => Number(c.fromBlock)))).toBe(120);
    expect(calls.every((c) => c.toBlock - c.fromBlock < 100n)).toBe(true);
  });

  it("returns nothing when the start is below the floor", async () => {
    const { calls, getChunk } = fetcher(null);
    expect(await scanBackward(10n, 20n, 100n, 200, 4, getChunk)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
