import { ariaClearingAbi, campaignIdOf, feeOf, Kind, MAX_LOG_RANGE } from "@aria-clearing/receipt";
import {
  createPublicClient,
  erc20Abi,
  getAbiItem,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { monadTestnet } from "viem/chains";
import { knownCampaigns } from "./campaigns";
import { deployment } from "./deployment";
import { getPublisherIndex, type IndexedEvent, type PublisherIndex } from "./envio";

/**
 * Blocks scanned back from the head when reading contract logs. Monad makes ~2.5 blocks a second, so 20k blocks
 * is the last ~2 hours, clipped at the deploy block.
 */
export const SCAN_BLOCKS = 20_000n;
/** Newest feed rows sent to the dashboard; totals cover every event. */
export const FEED_LIMIT = 50;
const CONCURRENCY = 6;
/** Chunks this close to the head are re-read on every scan instead of cached. */
const UNSETTLED_BLOCKS = 10n;

const STATUS_RELEASED = 3;
const STATUS_REJECTED = 4;

const clearingEvents = [
  getAbiItem({ abi: ariaClearingAbi, name: "EventLogged" }),
  getAbiItem({ abi: ariaClearingAbi, name: "EventDisputed" }),
  getAbiItem({ abi: ariaClearingAbi, name: "EventSettled" }),
  getAbiItem({ abi: ariaClearingAbi, name: "PaidOut" }),
  getAbiItem({ abi: ariaClearingAbi, name: "PayoutDeferred" }),
] as const;

interface Located {
  eventId: Hex;
  blockNumber: bigint;
  txHash: Hex;
}

/** One decoded contract log, reduced to what the dashboard needs. */
export type ClearingLog =
  | (Located & {
      type: "logged";
      requestId: string;
      campaignId: Hex;
      publisher: Address;
      kind: number;
      price: bigint;
    })
  | (Located & { type: "disputed" })
  | (Located & { type: "settled"; outcome: number })
  | (Located & { type: "paid" | "deferred"; publisher: Address; amount: bigint; fee: bigint });

/** pending: awaiting verification; deferred: verified but the transfer failed and sits as credit. */
export type ActivityStatus = "pending" | "disputed" | "paid" | "deferred" | "rejected";
export type RejectReason = "not_viewed" | "no_redirect" | "disputed";
export type KindName = "Impression" | "Click";

export interface Activity {
  eventId: Hex;
  requestId: string;
  kind: KindName;
  advertiser: string | null;
  price: bigint;
  /** Amount sent to the publisher for this event, net of the Aria fee; 0 unless paid or deferred. */
  earned: bigint;
  status: ActivityStatus;
  reason: RejectReason | null;
  blockNumber: bigint;
  txHash: Hex;
  settledTx: Hex | null;
}

/** A feed row with its time in unix seconds; rows read from logs also carry their block. */
export type FeedItem = Omit<Activity, "blockNumber"> & { time: number; blockNumber?: bigint };

/** envio: the Envio HyperIndex indexer; logs: the contract's logs over the last SCAN_BLOCKS blocks. */
export type DataSource = "envio" | "logs";

export interface Totals {
  paid: bigint;
  deferred: bigint;
  pending: bigint;
  pendingCount: number;
  /** Impressions and clicks that were not rejected. */
  impressions: number;
  clicks: number;
  rejected: number;
  rejectedBy: Record<RejectReason, number>;
}

export interface BlockTime {
  block: bigint;
  /** Unix seconds. */
  time: number;
}

type Stringified<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] };

export interface DashboardJson {
  address: string;
  clearing: string;
  /** USDC held by the publisher address, 6 decimals. */
  usdc: string;
  /** Payouts that failed and wait for a retry, 6 decimals. */
  credit: string;
  /** Native balance in wei, shown only in account details. */
  mon: string;
  totals: Stringified<Omit<Totals, "rejectedBy">> & { rejectedBy: Record<RejectReason, number> };
  /** Newest first, at most FEED_LIMIT rows. */
  activity: (Stringified<Omit<FeedItem, "blockNumber">> & { blockNumber?: string })[];
  source: DataSource;
  /** Blocks indexed (envio) or scanned (logs). */
  fromBlock: string;
  toBlock: string;
  /** Share of the publisher's events that were verified, in basis points; null when unknown. */
  trustScoreBps?: number | null;
  /** Aria's fee on each verified event, in basis points of the price; null when unknown. */
  feeBps: number | null;
}

/** Advertiser names by onchain campaign id, ended campaigns included. */
export function advertiserNames(): Record<string, string> {
  return Object.fromEntries(knownCampaigns().map((c) => [campaignIdOf(c.slug).toLowerCase(), c.advertiser]));
}

/** Why a rejected event was rejected: a dispute wins, else the rule its kind failed. */
export function rejectReason(kind: KindName, disputed: boolean): RejectReason {
  if (disputed) return "disputed";
  return kind === "Click" ? "no_redirect" : "not_viewed";
}

function newestFirst(a: { blockNumber: bigint }, b: { blockNumber: bigint }): number {
  return a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0;
}

/** This publisher's events with status and payout derived from the contract's logs, newest first. Pure. */
export function activityFrom(
  logs: ClearingLog[],
  publisher: string,
  advertisers: Record<string, string> = advertiserNames(),
): Activity[] {
  const me = publisher.toLowerCase();
  const disputed = new Set<Hex>();
  const settled = new Map<Hex, Extract<ClearingLog, { type: "settled" }>>();
  const payouts = new Map<Hex, Extract<ClearingLog, { type: "paid" | "deferred" }>>();
  for (const log of logs) {
    if (log.type === "disputed") disputed.add(log.eventId);
    else if (log.type === "settled") settled.set(log.eventId, log);
    else if ((log.type === "paid" || log.type === "deferred") && log.publisher.toLowerCase() === me) {
      payouts.set(log.eventId, log);
    }
  }

  return logs
    .filter((log): log is Extract<ClearingLog, { type: "logged" }> => log.type === "logged")
    .filter((log) => log.publisher.toLowerCase() === me)
    .sort(newestFirst)
    .map((log) => {
      const kind: KindName = log.kind === Kind.Click ? "Click" : "Impression";
      const settlement = settled.get(log.eventId);
      const payout = payouts.get(log.eventId);
      const wasDisputed = disputed.has(log.eventId);

      let status: ActivityStatus = wasDisputed ? "disputed" : "pending";
      let earned = 0n;
      if (settlement?.outcome === STATUS_REJECTED) status = "rejected";
      else if (payout) {
        status = payout.type === "paid" ? "paid" : "deferred";
        earned = payout.amount;
      } else if (settlement?.outcome === STATUS_RELEASED) {
        // A release without a PaidOut log was credited instead: the credit is the payout.
        status = "paid";
        earned = log.price;
      }

      return {
        eventId: log.eventId,
        requestId: log.requestId,
        kind,
        advertiser: advertisers[log.campaignId.toLowerCase()] ?? null,
        price: log.price,
        earned,
        status,
        reason: status === "rejected" ? rejectReason(kind, wasDisputed) : null,
        blockNumber: log.blockNumber,
        txHash: log.txHash,
        settledTx: settlement?.txHash ?? null,
      };
    });
}

/**
 * Feed rows from the indexer's events, in the order given. A release always emits PaidOut or PayoutDeferred in
 * the same transaction, so a released event that is not paid was deferred to credit. The publisher earns the price
 * less the indexed fee, or the full price when the indexer has no fee for the event. Pure.
 */
export function activityFromIndexed(
  events: IndexedEvent[],
  advertisers: Record<string, string> = advertiserNames(),
): FeedItem[] {
  return events.map((event) => {
    const kind: KindName = event.kind === "click" ? "Click" : "Impression";
    let status: ActivityStatus;
    if (event.status === "released") status = event.paid ? "paid" : "deferred";
    else if (event.status === "logged") status = "pending";
    else status = event.status;
    const released = status === "paid" || status === "deferred";
    return {
      eventId: event.eventId,
      requestId: event.requestId,
      kind,
      advertiser: advertisers[event.campaignId.toLowerCase()] ?? null,
      price: event.price,
      earned: released ? event.price - (event.fee ?? 0n) : 0n,
      status,
      reason: status === "rejected" ? rejectReason(kind, event.wasDisputed) : null,
      txHash: event.loggedTx,
      settledTx: event.settledTx,
      time: event.loggedAt,
    };
  });
}

/** Adds a time to each log-derived row, interpolated between two known blocks. Pure. */
export function withTimes(activity: Activity[], times: [BlockTime, BlockTime]): FeedItem[] {
  return activity.map((a) => ({ ...a, time: estimateTime(a.blockNumber, ...times) }));
}

/**
 * Earnings, pending value, counts and rejection reasons over a publisher's activity. Pending value is net of the
 * fee when `feeBps` is known. Pure.
 */
export function totalsOf(
  activity: Pick<Activity, "kind" | "status" | "reason" | "price" | "earned">[],
  feeBps: number | null = null,
): Totals {
  const totals: Totals = {
    paid: 0n,
    deferred: 0n,
    pending: 0n,
    pendingCount: 0,
    impressions: 0,
    clicks: 0,
    rejected: 0,
    rejectedBy: { not_viewed: 0, no_redirect: 0, disputed: 0 },
  };
  for (const item of activity) {
    if (item.status === "rejected") {
      totals.rejected += 1;
      totals.rejectedBy[item.reason ?? rejectReason(item.kind, false)] += 1;
      continue;
    }
    if (item.kind === "Click") totals.clicks += 1;
    else totals.impressions += 1;
    if (item.status === "paid") totals.paid += item.earned;
    else if (item.status === "deferred") totals.deferred += item.earned;
    else {
      totals.pending += feeBps === null ? item.price : item.price - feeOf(item.price, feeBps);
      totals.pendingCount += 1;
    }
  }
  return totals;
}

/** Unix seconds for `block`, interpolated linearly between two known blocks. */
export function estimateTime(block: bigint, a: BlockTime, b: BlockTime): number {
  if (a.block === b.block) return a.time;
  const span = Number(b.block - a.block);
  return Math.round(a.time + ((b.time - a.time) * Number(block - a.block)) / span);
}

/** The last `blocks` blocks up to `head`, clipped at the deploy block. */
export function scanRange(head: bigint, blocks: bigint, floor: bigint): { fromBlock: bigint; toBlock: bigint } {
  const start = head - blocks + 1n;
  return { fromBlock: start > floor ? start : floor, toBlock: head };
}

/** [from, to] split on multiples of `size`, so the same chunks repeat across scans and can be cached. */
export function alignedChunks(from: bigint, to: bigint, size: bigint): { fromBlock: bigint; toBlock: bigint }[] {
  const chunks: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = (from / size) * size; start <= to; start += size) {
    const end = start + size - 1n;
    chunks.push({ fromBlock: start, toBlock: end < to ? end : to });
  }
  return chunks;
}

export function toDashboardJson(input: {
  address: string;
  clearing: string;
  usdc: bigint;
  credit: bigint;
  mon: bigint;
  /** Every event, newest first. */
  activity: FeedItem[];
  range: { fromBlock: bigint; toBlock: bigint };
  source: DataSource;
  trustScoreBps?: number | null;
  feeBps: number | null;
}): DashboardJson {
  const totals = totalsOf(input.activity, input.feeBps);
  return {
    address: input.address,
    clearing: input.clearing,
    usdc: input.usdc.toString(),
    credit: input.credit.toString(),
    mon: input.mon.toString(),
    totals: {
      ...totals,
      paid: totals.paid.toString(),
      deferred: totals.deferred.toString(),
      pending: totals.pending.toString(),
    },
    activity: input.activity.slice(0, FEED_LIMIT).map(({ blockNumber, ...a }) => ({
      ...a,
      price: a.price.toString(),
      earned: a.earned.toString(),
      ...(blockNumber === undefined ? {} : { blockNumber: blockNumber.toString() }),
    })),
    source: input.source,
    fromBlock: input.range.fromBlock.toString(),
    toBlock: input.range.toBlock.toString(),
    trustScoreBps: input.trustScoreBps ?? null,
    feeBps: input.feeBps,
  };
}

let sharedClient: PublicClient | undefined;

function client(): PublicClient {
  sharedClient ??= createPublicClient({
    chain: monadTestnet,
    transport: http(deployment().rpcUrl, { retryCount: 3, retryDelay: 300 }),
  }) as PublicClient;
  return sharedClient;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type RawLog = Awaited<ReturnType<typeof readChunk>>[number];

async function readChunk(rpc: PublicClient, clearing: Address, chunk: { fromBlock: bigint; toBlock: bigint }) {
  return rpc.getLogs({ address: clearing, events: clearingEvents, strict: true, ...chunk });
}

function toClearingLog(log: RawLog): ClearingLog {
  const base = { eventId: log.args.eventId, blockNumber: log.blockNumber, txHash: log.transactionHash };
  switch (log.eventName) {
    case "EventLogged":
      return {
        ...base,
        type: "logged",
        requestId: log.args.requestId,
        campaignId: log.args.campaignId,
        publisher: log.args.publisher,
        kind: Number(log.args.kind),
        price: log.args.price,
      };
    case "EventDisputed":
      return { ...base, type: "disputed" };
    case "EventSettled":
      return { ...base, type: "settled", outcome: Number(log.args.outcome) };
    case "PaidOut":
      return { ...base, type: "paid", publisher: log.args.publisher, amount: log.args.amount, fee: log.args.fee };
    case "PayoutDeferred":
      return { ...base, type: "deferred", publisher: log.args.publisher, amount: log.args.amount, fee: log.args.fee };
  }
}

/**
 * Reads of 100-block chunks keyed by contract and chunk range. Concurrent scans share a pending read;
 * only full chunks behind the head stay cached, and failed reads are dropped.
 */
const chunkCache = new Map<string, Promise<ClearingLog[]>>();

/**
 * Every clearing log in [fromBlock, toBlock], one getLogs per 100-block chunk (the public RPC limit).
 * EventLogged does not index the publisher, so all events are read and filtered by the caller.
 */
export async function getClearingLogs(
  clearing: Address,
  range: { fromBlock: bigint; toBlock: bigint },
  rpc: PublicClient = client(),
): Promise<ClearingLog[]> {
  const chunks = alignedChunks(range.fromBlock, range.toBlock, MAX_LOG_RANGE);
  const perChunk = await mapLimit(chunks, CONCURRENCY, (chunk) => {
    const key = `${clearing}:${chunk.fromBlock}-${chunk.toBlock}`;
    const cached = chunkCache.get(key);
    if (cached) return cached;
    const complete = chunk.toBlock - chunk.fromBlock + 1n === MAX_LOG_RANGE;
    const keep = complete && chunk.toBlock + UNSETTLED_BLOCKS < range.toBlock;
    const read = readChunk(rpc, clearing, chunk).then((logs) => logs.map(toClearingLog));
    chunkCache.set(key, read);
    read.then(
      () => keep || chunkCache.delete(key),
      () => chunkCache.delete(key),
    );
    return read;
  });
  return perChunk.flat().filter((log) => log.blockNumber >= range.fromBlock);
}

/** Fee rates by contract address. The rate is immutable, so only successful reads are kept. */
const feeBpsCache = new Map<string, Promise<number | null>>();

/** The contract's fee in basis points, read once per contract; null when the read fails. */
export function readFeeBps(clearing: Address, rpc: PublicClient = client()): Promise<number | null> {
  const key = clearing.toLowerCase();
  const cached = feeBpsCache.get(key);
  if (cached) return cached;
  const read = rpc
    .readContract({ address: clearing, abi: ariaClearingAbi, functionName: "feeBps" })
    .then(Number)
    .catch(() => {
      feeBpsCache.delete(key);
      return null;
    });
  feeBpsCache.set(key, read);
  return read;
}

/** The publisher's events from the last SCAN_BLOCKS blocks of contract logs. */
async function activityFromLogs(
  rpc: PublicClient,
  clearing: Address,
  publisher: Address,
  deployBlock: bigint,
): Promise<{ activity: FeedItem[]; range: { fromBlock: bigint; toBlock: bigint } }> {
  // The head block gives its number and timestamp in one read, so a lagging RPC node cannot miss it.
  const last = await rpc.getBlock();
  const range = scanRange(last.number, SCAN_BLOCKS, deployBlock);
  const [logs, first] = await Promise.all([
    getClearingLogs(clearing, range, rpc),
    rpc.getBlock({ blockNumber: range.fromBlock }),
  ]);
  const activity = withTimes(activityFrom(logs, publisher), [
    { block: range.fromBlock, time: Number(first.timestamp) },
    { block: range.toBlock, time: Number(last.timestamp) },
  ]);
  return { activity, range };
}

/**
 * Balances, payout credit, totals and activity for one publisher, JSON-safe. Totals and the feed come from the
 * Envio indexer; when it is unreachable they are read from the last SCAN_BLOCKS blocks of contract logs.
 */
export async function loadDashboard(
  address: string,
  rpc: PublicClient = client(),
  readIndex: (address: string) => Promise<PublisherIndex | null> = getPublisherIndex,
): Promise<DashboardJson> {
  const publisher = getAddress(address);
  const { clearing, usdc, deployBlock } = deployment();

  const [index, usdcBalance, credit, mon, feeBps] = await Promise.all([
    readIndex(publisher),
    rpc.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [publisher] }),
    rpc.readContract({ address: clearing, abi: ariaClearingAbi, functionName: "credit", args: [publisher] }),
    rpc.getBalance({ address: publisher }),
    readFeeBps(clearing, rpc),
  ]);
  const balances = { address: publisher, clearing, usdc: usdcBalance, credit, mon, feeBps };

  if (index) {
    return toDashboardJson({
      ...balances,
      activity: activityFromIndexed(index.events),
      range: { fromBlock: BigInt(index.fromBlock), toBlock: BigInt(index.toBlock) },
      source: "envio",
      trustScoreBps: index.stats.trustScoreBps,
    });
  }

  const { activity, range } = await activityFromLogs(rpc, clearing, publisher, deployBlock);
  return toDashboardJson({ ...balances, activity, range, source: "logs", trustScoreBps: null });
}
