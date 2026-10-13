import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const CHAIN = 10143;
type Hex = `0x${string}`;

const [PUB_A, PUB_B, ADVERTISER] = TestHelpers.Addresses.mockAddresses;
const CAMPAIGN: Hex = `0x${"c".repeat(64)}`;
const id = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const tx = (n: number): Hex => `0x${(1000 + n).toString(16).padStart(64, "0")}`;

// Simulated events must sit after config.yaml's start_block, or envio drops them.
const START_BLOCK = Number(/start_block:\s*(\d+)/.exec(readFileSync(new URL("../config.yaml", import.meta.url), "utf8"))![1]);
let block = START_BLOCK + 100;
const at = () => {
  block += 1;
  return { number: block, timestamp: 1_760_000_000 + block };
};

const campaignCreated = () =>
  ({
    contract: "AriaClearing",
    event: "CampaignCreated",
    block: at(),
    params: {
      campaignId: CAMPAIGN,
      advertiser: ADVERTISER,
      claims: "1. Fast",
      claimsHash: id(99),
      priceImpression: 10_000n,
      priceClick: 50_000n,
      budget: 1_000_000n,
    },
  }) as const;

const logged = (n: number, publisher: Hex, kind = 0n, price = 10_000n) =>
  ({
    contract: "AriaClearing",
    event: "EventLogged",
    block: at(),
    transaction: { hash: tx(n) },
    params: {
      eventId: id(n),
      requestKey: id(500 + n),
      campaignId: CAMPAIGN,
      requestId: `req_${n}`,
      publisher,
      kind,
      rationale: "Because",
      rationaleHash: id(600 + n),
      claimRefs: [1n],
      price,
    },
  }) as const;

const disputed = (n: number) =>
  ({ contract: "AriaClearing", event: "EventDisputed", block: at(), params: { eventId: id(n) } }) as const;

const settled = (n: number, outcome: bigint) =>
  ({
    contract: "AriaClearing",
    event: "EventSettled",
    block: at(),
    transaction: { hash: tx(100 + n) },
    params: { eventId: id(n), outcome },
  }) as const;

const paidOut = (n: number, publisher: Hex, amount: bigint, fee = 0n) =>
  ({
    contract: "AriaClearing",
    event: "PaidOut",
    block: at(),
    transaction: { hash: tx(200 + n) },
    params: { eventId: id(n), publisher, amount, fee },
  }) as const;

const deferred = (n: number, publisher: Hex, amount: bigint, fee = 0n) =>
  ({
    contract: "AriaClearing",
    event: "PayoutDeferred",
    block: at(),
    params: { eventId: id(n), publisher, amount, fee },
  }) as const;

const feesWithdrawn = (recipient: Hex, amount: bigint) =>
  ({ contract: "AriaClearing", event: "FeesWithdrawn", block: at(), params: { recipient, amount } }) as const;

const RELEASED = 3n;
const REJECTED = 4n;

describe("AriaClearing handlers", () => {
  it("logs, releases and pays an event", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [campaignCreated(), logged(1, PUB_A), logged(2, PUB_A, 1n, 50_000n)],
        },
      },
    });

    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({
      impressions: 1,
      clicks: 1,
      pending: 2,
      released: 0,
      trustScoreBps: undefined,
    });
    expect(await indexer.ClearingEvent.getOrThrow(id(2))).toMatchObject({
      requestId: "req_2",
      campaign_id: CAMPAIGN,
      publisher_id: PUB_A,
      kind: "click",
      status: "logged",
      paid: false,
      loggedTx: tx(2),
    });

    await indexer.process({
      chains: { [CHAIN]: { simulate: [settled(1, RELEASED), paidOut(1, PUB_A, 10_000n)] } },
    });

    expect(await indexer.ClearingEvent.getOrThrow(id(1))).toMatchObject({
      status: "released",
      paid: true,
      settledTx: tx(101),
      paidTx: tx(201),
    });
    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({
      pending: 1,
      released: 1,
      earned: 10_000n,
      trustScoreBps: 10_000,
    });
    expect(await indexer.Campaign.getOrThrow(CAMPAIGN)).toMatchObject({ spent: 10_000n, refunded: 0n });
  });

  it("moves a disputed event to rejected without counting it twice", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [campaignCreated(), logged(1, PUB_A), logged(2, PUB_A), settled(1, RELEASED), disputed(2)],
        },
      },
    });

    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({
      pending: 0,
      disputed: 1,
      released: 1,
      rejected: 0,
      trustScoreBps: 5_000,
    });
    expect((await indexer.ClearingEvent.getOrThrow(id(2))).status).toBe("disputed");

    await indexer.process({ chains: { [CHAIN]: { simulate: [settled(2, REJECTED)] } } });

    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({
      pending: 0,
      disputed: 0,
      released: 1,
      rejected: 1,
      trustScoreBps: 5_000,
    });
    expect(await indexer.ClearingEvent.getOrThrow(id(2))).toMatchObject({
      status: "rejected",
      wasDisputed: true,
      paid: false,
    });
    expect(await indexer.Campaign.getOrThrow(CAMPAIGN)).toMatchObject({ spent: 10_000n, refunded: 10_000n });
  });

  it("scores publishers independently and ignores repeats and unknown ids", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            campaignCreated(),
            logged(1, PUB_A),
            logged(2, PUB_B),
            logged(3, PUB_B),
            settled(1, RELEASED),
            settled(2, RELEASED),
            settled(3, REJECTED),
            settled(1, REJECTED),
            settled(42, RELEASED),
            disputed(43),
          ],
        },
      },
    });

    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({ released: 1, rejected: 0, trustScoreBps: 10_000 });
    expect(await indexer.Publisher.getOrThrow(PUB_B)).toMatchObject({ released: 1, rejected: 1, trustScoreBps: 5_000 });
    expect(await indexer.ClearingEvent.get(id(42))).toBeUndefined();
  });

  it("adds claimed credit to earned", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            campaignCreated(),
            logged(1, PUB_A),
            settled(1, RELEASED),
            deferred(1, PUB_A, 10_000n),
            { contract: "AriaClearing", event: "Claimed", block: at(), params: { publisher: PUB_A, amount: 10_000n } },
          ],
        },
      },
    });

    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({ released: 1, earned: 10_000n });
    expect((await indexer.ClearingEvent.getOrThrow(id(1))).paid).toBe(false);
  });

  it("records the fee on paid and deferred events and tracks protocol totals", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            campaignCreated(),
            logged(1, PUB_A),
            logged(2, PUB_A),
            logged(3, PUB_A),
            settled(1, RELEASED),
            settled(2, RELEASED),
            settled(3, REJECTED),
            paidOut(1, PUB_A, 9_000n, 1_000n),
            deferred(2, PUB_A, 9_000n, 1_000n),
          ],
        },
      },
    });

    expect(await indexer.ClearingEvent.getOrThrow(id(1))).toMatchObject({ paid: true, fee: 1_000n });
    expect(await indexer.ClearingEvent.getOrThrow(id(2))).toMatchObject({ paid: false, fee: 1_000n });
    expect((await indexer.ClearingEvent.getOrThrow(id(3))).fee).toBeUndefined();
    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({ earned: 9_000n });
    expect(await indexer.Campaign.getOrThrow(CAMPAIGN)).toMatchObject({ spent: 20_000n });
    expect(await indexer.Protocol.getOrThrow("aria")).toMatchObject({ feesAccrued: 2_000n, feesWithdrawn: 0n });

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "AriaClearing", event: "Claimed", block: at(), params: { publisher: PUB_A, amount: 9_000n } },
            feesWithdrawn(ADVERTISER, 1_500n),
            paidOut(1, PUB_A, 9_000n, 1_000n),
          ],
        },
      },
    });

    expect(await indexer.Publisher.getOrThrow(PUB_A)).toMatchObject({ earned: 18_000n });
    expect(await indexer.Protocol.getOrThrow("aria")).toMatchObject({ feesAccrued: 2_000n, feesWithdrawn: 1_500n });
  });
});
