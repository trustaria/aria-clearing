import { getAddress, isAddress, type Address, type Hex } from "viem";

/** Hasura endpoint of the local Envio indexer. */
export const DEFAULT_ENVIO_GRAPHQL_URL = "http://localhost:8080/v1/graphql";
const TIMEOUT_MS = 3_000;

export type IndexedStatus = "logged" | "disputed" | "released" | "rejected";

export interface PublisherStats {
  address: Address;
  impressions: number;
  clicks: number;
  pending: number;
  disputed: number;
  released: number;
  rejected: number;
  /** USDC transferred to the publisher, net of the Aria fee, 6 decimals. */
  earned: bigint;
  /** released / (released + rejected + disputed) in basis points; null before any event is settled or disputed. */
  trustScoreBps: number | null;
  /** Same ratio as 0..1 with two decimals; null when trustScoreBps is null. */
  trustScore: number | null;
  /** Unix seconds; 0 when the publisher has no indexed activity. */
  lastActivityAt: number;
}

export interface IndexedEvent {
  eventId: Hex;
  requestId: string;
  campaignId: Hex;
  kind: "impression" | "click";
  /** USDC, 6 decimals. */
  price: bigint;
  status: IndexedStatus;
  wasDisputed: boolean;
  paid: boolean;
  /** Unix seconds. */
  loggedAt: number;
  loggedTx: Hex;
  settledAt: number | null;
  settledTx: Hex | null;
  paidTx: Hex | null;
  /** Aria fee taken from the price on release; null before release or when the indexer does not record it. */
  fee: bigint | null;
}

/** Publisher_by_pk row as Hasura returns it (BigInt columns as strings). */
export interface PublisherRow {
  id: string;
  impressions: number;
  clicks: number;
  pending: number;
  disputed: number;
  released: number;
  rejected: number;
  earned: string;
  trustScoreBps: number | null;
  lastActivityAt: number;
}

export interface ClearingEventRow {
  id: string;
  requestId: string;
  campaign_id: string;
  kind: "impression" | "click";
  price: string;
  status: IndexedStatus;
  wasDisputed: boolean;
  paid: boolean;
  loggedAt: number;
  loggedTx: string;
  settledAt: number | null;
  settledTx: string | null;
  paidTx: string | null;
  /** Absent on an indexer without the fee column. */
  fee?: string | null;
}

const PUBLISHER_QUERY = `query PublisherStats($id: String!) {
  Publisher_by_pk(id: $id) {
    id impressions clicks pending disputed released rejected earned trustScoreBps lastActivityAt
  }
}`;

const INDEX_QUERY = `query PublisherIndex($id: String!, $limit: Int!, $offset: Int!) {
  Publisher_by_pk(id: $id) {
    id impressions clicks pending disputed released rejected earned trustScoreBps lastActivityAt
  }
  ClearingEvent(
    where: { publisher_id: { _eq: $id } }
    order_by: [{ loggedAt: desc }, { id: asc }]
    limit: $limit
    offset: $offset
  ) {
    id requestId campaign_id kind price status wasDisputed paid loggedAt loggedTx settledAt settledTx paidTx fee
  }
  chain_metadata { start_block latest_processed_block }
}`;

/** Events fetched per request, and the most requests one index read makes. */
const PAGE_SIZE = 1_000;
const MAX_PAGES = 20;

export function envioUrl(): string {
  return process.env.ENVIO_GRAPHQL_URL || DEFAULT_ENVIO_GRAPHQL_URL;
}

/** Maps a Publisher row; a missing row means no indexed activity yet. */
export function toPublisherStats(address: Address, row: PublisherRow | null): PublisherStats {
  if (!row) {
    return {
      address,
      impressions: 0,
      clicks: 0,
      pending: 0,
      disputed: 0,
      released: 0,
      rejected: 0,
      earned: 0n,
      trustScoreBps: null,
      trustScore: null,
      lastActivityAt: 0,
    };
  }
  const bps = row.trustScoreBps === null ? null : Number(row.trustScoreBps);
  return {
    address: getAddress(row.id),
    impressions: Number(row.impressions),
    clicks: Number(row.clicks),
    pending: Number(row.pending),
    disputed: Number(row.disputed),
    released: Number(row.released),
    rejected: Number(row.rejected),
    earned: BigInt(row.earned),
    trustScoreBps: bps,
    trustScore: bps === null ? null : Math.round(bps / 100) / 100,
    lastActivityAt: Number(row.lastActivityAt),
  };
}

export function toIndexedEvent(row: ClearingEventRow): IndexedEvent {
  return {
    eventId: row.id as Hex,
    requestId: row.requestId,
    campaignId: row.campaign_id as Hex,
    kind: row.kind,
    price: BigInt(row.price),
    status: row.status,
    wasDisputed: row.wasDisputed,
    paid: row.paid,
    loggedAt: Number(row.loggedAt),
    loggedTx: row.loggedTx as Hex,
    settledAt: row.settledAt === null ? null : Number(row.settledAt),
    settledTx: row.settledTx as Hex | null,
    paidTx: row.paidTx as Hex | null,
    fee: row.fee === null || row.fee === undefined ? null : BigInt(row.fee),
  };
}

async function query<T>(text: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(envioUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Envio GraphQL ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) throw new Error(body.errors?.[0]?.message ?? "Envio GraphQL: no data");
  return body.data;
}

/** Indexed counts, earnings and trust score for a publisher; null when the indexer is unreachable. */
export async function getPublisherStats(address: string): Promise<PublisherStats | null> {
  if (!isAddress(address, { strict: false })) return null;
  const id = getAddress(address);
  try {
    const data = await query<{ Publisher_by_pk: PublisherRow | null }>(PUBLISHER_QUERY, { id });
    return toPublisherStats(id, data.Publisher_by_pk);
  } catch {
    return null;
  }
}

export interface ChainMetadataRow {
  start_block: number;
  latest_processed_block: number | null;
}

interface IndexPage {
  Publisher_by_pk: PublisherRow | null;
  ClearingEvent: ClearingEventRow[];
  chain_metadata: ChainMetadataRow[];
}

/** Everything the indexer holds for one publisher. */
export interface PublisherIndex {
  stats: PublisherStats;
  /** All of the publisher's events, newest first. */
  events: IndexedEvent[];
  /** First and last block the indexer has processed. */
  fromBlock: number;
  toBlock: number;
}

/** Stats, every event and the indexed block range for a publisher; null when the indexer is unreachable. */
export async function getPublisherIndex(address: string): Promise<PublisherIndex | null> {
  if (!isAddress(address, { strict: false })) return null;
  const id = getAddress(address);
  try {
    const first = await query<IndexPage>(INDEX_QUERY, { id, limit: PAGE_SIZE, offset: 0 });
    const rows = [...first.ClearingEvent];
    let last = first.ClearingEvent.length;
    for (let page = 1; page < MAX_PAGES && last === PAGE_SIZE; page++) {
      const next = await query<IndexPage>(INDEX_QUERY, { id, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      rows.push(...next.ClearingEvent);
      last = next.ClearingEvent.length;
    }
    const chain = first.chain_metadata[0];
    const fromBlock = Number(chain?.start_block ?? 0);
    return {
      stats: toPublisherStats(id, first.Publisher_by_pk),
      events: rows.map(toIndexedEvent),
      fromBlock,
      toBlock: Number(chain?.latest_processed_block ?? fromBlock),
    };
  } catch {
    return null;
  }
}
