import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublisherStats, getRecentEvents, toIndexedEvent, toPublisherStats } from "../lib/envio";

const PUBLISHER = "0x67435bD1FCd81D6c25C6546a86af0eF6887F72cb";

/** Live Hasura responses from the indexer on Monad testnet. */
const PUBLISHER_RESPONSE = {
  data: {
    Publisher_by_pk: {
      id: PUBLISHER,
      impressions: 1,
      clicks: 1,
      pending: 0,
      disputed: 0,
      released: 2,
      rejected: 0,
      earned: "260000",
      trustScoreBps: 10000,
      lastActivityAt: 1791831729,
    },
  },
};

const EVENTS_RESPONSE = {
  data: {
    ClearingEvent: [
      {
        id: "0x41e92d51c64fab56fe33aed6a1e1c245cd64b1df7882048705de843bae6f86b7",
        requestId: "req_QMLXC7I5jybiVDrywX5tRC",
        campaign_id: "0xebe836eea8bdd51ca542ca8da86d4d6bb1072dd47e7a319e57660019c6ded33f",
        kind: "click",
        price: "250000",
        status: "released",
        wasDisputed: false,
        paid: false,
        loggedAt: 1791831630,
        loggedTx: "0x15f2d8fa93fa3cd49001bbf23e07e5578e626e64c88af0ce0c8fc62511a2b521",
        settledAt: 1791831679,
        settledTx: "0x8752072a4b9673b64129af9c97859329f9f9cab1dc8b6d91afb02370da6647df",
        paidTx: null,
      },
      {
        id: "0x150196779bece6dd96d5ff3a9a4c505fdc2ed6ffcbdb133422d83efd0350afc9",
        requestId: "req_QMLXC7I5jybiVDrywX5tRC",
        campaign_id: "0xebe836eea8bdd51ca542ca8da86d4d6bb1072dd47e7a319e57660019c6ded33f",
        kind: "impression",
        price: "10000",
        status: "released",
        wasDisputed: false,
        paid: false,
        loggedAt: 1791831622,
        loggedTx: "0x9dfc05ee895a3ebaa7b6b66fac4964911f3b65c91fd274fe0d7c483b3d3bebd1",
        settledAt: 1791831679,
        settledTx: "0x8752072a4b9673b64129af9c97859329f9f9cab1dc8b6d91afb02370da6647df",
        paidTx: null,
      },
    ],
  },
} as const;

function respondWith(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("response mapping", () => {
  it("maps a publisher row with bigint earnings and a two-decimal score", () => {
    expect(toPublisherStats(PUBLISHER, PUBLISHER_RESPONSE.data.Publisher_by_pk)).toEqual({
      address: PUBLISHER,
      impressions: 1,
      clicks: 1,
      pending: 0,
      disputed: 0,
      released: 2,
      rejected: 0,
      earned: 260_000n,
      trustScoreBps: 10_000,
      trustScore: 1,
      lastActivityAt: 1791831729,
    });
    const partial = toPublisherStats(PUBLISHER, {
      ...PUBLISHER_RESPONSE.data.Publisher_by_pk,
      released: 2,
      rejected: 1,
      trustScoreBps: 6667,
    });
    expect(partial.trustScore).toBe(0.67);
  });

  it("returns empty stats with a null score for an unindexed publisher", () => {
    expect(toPublisherStats(PUBLISHER, null)).toMatchObject({ released: 0, earned: 0n, trustScoreBps: null, trustScore: null });
  });

  it("maps an event row", () => {
    expect(toIndexedEvent(EVENTS_RESPONSE.data.ClearingEvent[0])).toEqual({
      eventId: "0x41e92d51c64fab56fe33aed6a1e1c245cd64b1df7882048705de843bae6f86b7",
      requestId: "req_QMLXC7I5jybiVDrywX5tRC",
      campaignId: "0xebe836eea8bdd51ca542ca8da86d4d6bb1072dd47e7a319e57660019c6ded33f",
      kind: "click",
      price: 250_000n,
      status: "released",
      wasDisputed: false,
      paid: false,
      loggedAt: 1791831630,
      loggedTx: "0x15f2d8fa93fa3cd49001bbf23e07e5578e626e64c88af0ce0c8fc62511a2b521",
      settledAt: 1791831679,
      settledTx: "0x8752072a4b9673b64129af9c97859329f9f9cab1dc8b6d91afb02370da6647df",
      paidTx: null,
    });
  });
});

describe("getPublisherStats / getRecentEvents", () => {
  it("queries ENVIO_GRAPHQL_URL with the checksummed address", async () => {
    vi.stubEnv("ENVIO_GRAPHQL_URL", "http://indexer.test/v1/graphql");
    const fetchMock = respondWith(PUBLISHER_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    const stats = await getPublisherStats(PUBLISHER.toLowerCase());

    expect(stats?.released).toBe(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://indexer.test/v1/graphql");
    expect(JSON.parse(String(init?.body)).variables).toEqual({ id: PUBLISHER });
  });

  it("returns events newest first as sent, with the limit", async () => {
    vi.stubEnv("ENVIO_GRAPHQL_URL", "");
    const fetchMock = respondWith(EVENTS_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    const events = await getRecentEvents(PUBLISHER, 5);

    expect(events?.map((e) => e.kind)).toEqual(["click", "impression"]);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:8080/v1/graphql");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).variables).toEqual({ id: PUBLISHER, limit: 5 });
  });

  it("returns null when the indexer is down, errors or the address is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await getPublisherStats(PUBLISHER)).toBeNull();
    expect(await getRecentEvents(PUBLISHER)).toBeNull();

    vi.stubGlobal("fetch", respondWith({ errors: [{ message: "field not found" }] }));
    expect(await getPublisherStats(PUBLISHER)).toBeNull();

    vi.stubGlobal("fetch", respondWith({}, 500));
    expect(await getRecentEvents(PUBLISHER)).toBeNull();

    expect(await getPublisherStats("not-an-address")).toBeNull();
  });
});
