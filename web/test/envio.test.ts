import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCampaignIndex,
  getPublisherIndex,
  getPublisherStats,
  toIndexedEvent,
  toIndexedSentence,
  toPublisherStats,
} from "../lib/envio";
import { LIVE_CAMPAIGN_ID, LIVE_CAMPAIGN_RESPONSE, LIVE_INDEX_RESPONSE, LIVE_PUBLISHER } from "./envio-fixtures";

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
      fee: null,
    });
  });

  it("reads the event's fee, and null when the indexer has none", () => {
    const row = EVENTS_RESPONSE.data.ClearingEvent[0];
    expect(toIndexedEvent({ ...row, fee: "50000" }).fee).toBe(50_000n);
    expect(toIndexedEvent({ ...row, fee: null }).fee).toBeNull();
    expect(toIndexedEvent(row).fee).toBeNull();
  });
});

describe("getPublisherStats", () => {
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

  it("returns null when the indexer is down, errors or the address is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await getPublisherStats(PUBLISHER)).toBeNull();
    expect(await getPublisherIndex(PUBLISHER)).toBeNull();

    vi.stubGlobal("fetch", respondWith({ errors: [{ message: "field not found" }] }));
    expect(await getPublisherStats(PUBLISHER)).toBeNull();
    expect(await getPublisherIndex(PUBLISHER)).toBeNull();

    vi.stubGlobal("fetch", respondWith({}, 500));
    expect(await getPublisherIndex(PUBLISHER)).toBeNull();

    expect(await getPublisherStats("not-an-address")).toBeNull();
    expect(await getPublisherIndex("not-an-address")).toBeNull();
  });
});

describe("getPublisherIndex", () => {
  it("returns stats, events newest first and the indexed block range", async () => {
    vi.stubEnv("ENVIO_GRAPHQL_URL", "");
    const fetchMock = respondWith(LIVE_INDEX_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    const index = await getPublisherIndex(LIVE_PUBLISHER.toLowerCase());

    expect(index?.stats).toMatchObject({ address: LIVE_PUBLISHER, released: 5, rejected: 2, earned: 530_000n, trustScoreBps: 7143 });
    expect(index?.events).toHaveLength(7);
    expect(index?.events[0]).toMatchObject({ requestId: "req_ECxfg5BC2dgs1C9xg04VKX", status: "rejected", wasDisputed: true });
    expect(index?.events.map((e) => e.loggedAt)).toEqual([...index!.events.map((e) => e.loggedAt)].sort((a, b) => b - a));
    expect(index).toMatchObject({ fromBlock: 70478614, toBlock: 70496822 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:8080/v1/graphql");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).variables).toEqual({
      id: LIVE_PUBLISHER,
      limit: 1000,
      offset: 0,
    });
  });

  it("asks for each event's fee", async () => {
    const fetchMock = respondWith(LIVE_INDEX_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    await getPublisherIndex(LIVE_PUBLISHER);

    const { query } = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(query).toMatch(/ClearingEvent\([\s\S]*\bfee\b/);
  });

  it("pages until a short page", async () => {
    const row = LIVE_INDEX_RESPONSE.data.ClearingEvent[0];
    const page = (n: number) => ({
      data: {
        ...LIVE_INDEX_RESPONSE.data,
        ClearingEvent: Array.from({ length: n }, (_, i) => ({ ...row, id: `0x${i.toString(16).padStart(64, "0")}` })),
      },
    });
    const fetchMock = vi
      .fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(page(3))))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(1000))));
    vi.stubGlobal("fetch", fetchMock);

    const index = await getPublisherIndex(LIVE_PUBLISHER);

    expect(index?.events).toHaveLength(1003);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).variables.offset)).toEqual([0, 1000]);
  });

  it("returns an empty event list for a publisher with no indexed activity", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ data: { Publisher_by_pk: null, ClearingEvent: [], chain_metadata: LIVE_INDEX_RESPONSE.data.chain_metadata } }),
    );
    const index = await getPublisherIndex(PUBLISHER);
    expect(index?.events).toEqual([]);
    expect(index?.stats.trustScoreBps).toBeNull();
  });
});

describe("getCampaignIndex", () => {
  it("maps a campaign event row with its sentence", () => {
    expect(toIndexedSentence(LIVE_CAMPAIGN_RESPONSE.data.ClearingEvent[2])).toEqual({
      eventId: "0xc7231c4d3a06eced5395186e5e9f39b8342a0df659851d62483d973389c78d56",
      requestId: "req_ECxfg5BC2dgs1C9xg04VKX",
      kind: "impression",
      price: 10_000n,
      status: "rejected",
      wasDisputed: false,
      loggedAt: 1791835792,
      loggedTx: "0x5373b1d5d7580ba9d9b125a939548511502c02ff37de6c9c660a1539edf00754",
      rationale: "Tagus Family Travel books stroller-friendly tram tours.",
    });
  });

  it("returns the campaign's sentences newest first and the indexed block range in one request", async () => {
    vi.stubEnv("ENVIO_GRAPHQL_URL", "http://indexer.test/v1/graphql");
    const fetchMock = respondWith(LIVE_CAMPAIGN_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    const index = await getCampaignIndex(LIVE_CAMPAIGN_ID);

    expect(index).toMatchObject({ indexed: true, fromBlock: 70726907, toBlock: 70772183 });
    expect(index?.events.map((e) => [e.requestId, e.kind, e.status])).toEqual([
      ["req_36wX7fR79VnTOVHwllgYhA", "click", "released"],
      ["req_36wX7fR79VnTOVHwllgYhA", "impression", "released"],
      ["req_ECxfg5BC2dgs1C9xg04VKX", "impression", "rejected"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://indexer.test/v1/graphql");
    const { query, variables } = JSON.parse(String(init?.body));
    expect(variables).toEqual({ id: LIVE_CAMPAIGN_ID, limit: 1000, offset: 0 });
    expect(query).toMatch(/Campaign_by_pk\(id: \$id\)/);
    expect(query).toMatch(/campaign_id: \{ _eq: \$id \}/);
    expect(query).toMatch(/order_by: \[\{ loggedAt: desc \}, \{ id: asc \}\]/);
    expect(query).toMatch(/ClearingEvent\([\s\S]*\brationale\b/);
    expect(query).toMatch(/chain_metadata/);
  });

  it("queries by the lowercase campaign id, as the indexer stores bytes32", async () => {
    const fetchMock = respondWith(LIVE_CAMPAIGN_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    await getCampaignIndex(LIVE_CAMPAIGN_ID.toUpperCase().replace("0X", "0x"));

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).variables.id).toBe(LIVE_CAMPAIGN_ID);
  });

  it("pages until a short page", async () => {
    const row = LIVE_CAMPAIGN_RESPONSE.data.ClearingEvent[0];
    const page = (n: number) => ({
      data: {
        ...LIVE_CAMPAIGN_RESPONSE.data,
        ClearingEvent: Array.from({ length: n }, (_, i) => ({ ...row, id: `0x${i.toString(16).padStart(64, "0")}` })),
      },
    });
    const fetchMock = vi
      .fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(page(2))))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(1000))));
    vi.stubGlobal("fetch", fetchMock);

    const index = await getCampaignIndex(LIVE_CAMPAIGN_ID);

    expect(index?.events).toHaveLength(1002);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).variables.offset)).toEqual([0, 1000]);
  });

  it("reports a campaign the indexer has not reached yet", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ data: { Campaign_by_pk: null, ClearingEvent: [], chain_metadata: LIVE_CAMPAIGN_RESPONSE.data.chain_metadata } }),
    );
    expect(await getCampaignIndex(LIVE_CAMPAIGN_ID)).toMatchObject({ indexed: false, events: [] });
  });

  it("returns null when the indexer is down, lacks the sentence column or the id is not bytes32", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await getCampaignIndex(LIVE_CAMPAIGN_ID)).toBeNull();

    // The hosted indexer's answer before it is redeployed with the sentence column.
    vi.stubGlobal(
      "fetch",
      respondWith({
        errors: [
          {
            message: "field 'rationale' not found in type: 'ClearingEvent'",
            extensions: { path: "$.selectionSet.ClearingEvent.selectionSet.rationale", code: "validation-failed" },
          },
        ],
      }),
    );
    expect(await getCampaignIndex(LIVE_CAMPAIGN_ID)).toBeNull();

    vi.stubGlobal("fetch", respondWith({}, 500));
    expect(await getCampaignIndex(LIVE_CAMPAIGN_ID)).toBeNull();

    const fetchMock = respondWith(LIVE_CAMPAIGN_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);
    expect(await getCampaignIndex("0x1234")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
