import { ariaClearingAbi, campaignIdOf, Kind, MAX_LOG_RANGE } from "@aria-clearing/receipt";
import {
  createPublicClient,
  erc20Abi,
  getAbiItem,
  getAddress,
  http,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { monadTestnet } from "viem/chains";
import { campaigns } from "./campaigns";
import { deployment } from "./deployment";

/**
 * Blocks scanned back from the head. Monad makes ~2.5 blocks a second, so 20k blocks is the last ~2 hours,
 * clipped at the deploy block; older activity is not shown.
 */
export const SCAN_BLOCKS = 20_000n;
const CONCURRENCY = 6;
/** Chunks this close to the head are re-read on every scan instead of cached. */
const UNSETTLED_BLOCKS = 10n;

const STATUS_RELEASED = 3;
const STATUS_REJECTED = 4;

// PaidOut and PayoutDeferred are declared here until the receipt package ABI includes them.
const paidOutEvent = parseAbiItem(
  "event PaidOut(bytes32 indexed eventId, address indexed publisher, uint256 amount)",
);
const payoutDeferredEvent = parseAbiItem(
  "event PayoutDeferred(bytes32 indexed eventId, address indexed publisher, uint256 amount)",
);
const clearingEvents = [
  getAbiItem({ abi: ariaClearingAbi, name: "EventLogged" }),
  getAbiItem({ abi: ariaClearingAbi, name: "EventDisputed" }),
  getAbiItem({ abi: ariaClearingAbi, name: "EventSettled" }),
  paidOutEvent,
  payoutDeferredEvent,
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
  | (Located & { type: "paid" | "deferred"; publisher: Address; amount: bigint });

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
  /** Amount sent to the publisher for this event; 0 unless paid or deferred. */
  earned: bigint;
  status: ActivityStatus;
  reason: RejectReason | null;
  blockNumber: bigint;
  txHash: Hex;
  settledTx: Hex | null;
}

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
  activity: (Stringified<Activity> & { time: number })[];
  fromBlock: string;
  toBlock: string;
}

/** Advertiser names by onchain campaign id, from the seeded campaigns. */
export const ADVERTISERS: Record<string, string> = Object.fromEntries(
  campaigns.map((c) => [campaignIdOf(c.slug).toLowerCase(), c.advertiser]),
);

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
  advertisers: Record<string, string> = ADVERTISERS,
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
        // A release without a payout log comes from the pull-payment contract: the credit was the payout.
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

/** Earnings, pending value, counts and rejection reasons over a publisher's activity. Pure. */
export function totalsOf(activity: Activity[]): Totals {
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
      totals.pending += item.price;
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
  activity: Activity[];
  range: { fromBlock: bigint; toBlock: bigint };
  times: [BlockTime, BlockTime];
}): DashboardJson {
  const totals = totalsOf(input.activity);
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
    activity: input.activity.map((a) => ({
      ...a,
      price: a.price.toString(),
      earned: a.earned.toString(),
      blockNumber: a.blockNumber.toString(),
      time: estimateTime(a.blockNumber, ...input.times),
    })),
    fromBlock: input.range.fromBlock.toString(),
    toBlock: input.range.toBlock.toString(),
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
      return { ...base, type: "paid", publisher: log.args.publisher, amount: log.args.amount };
    case "PayoutDeferred":
      return { ...base, type: "deferred", publisher: log.args.publisher, amount: log.args.amount };
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

/** Balances, payout credit, totals and recent activity for one publisher, JSON-safe. */
export async function loadDashboard(address: string, rpc: PublicClient = client()): Promise<DashboardJson> {
  const publisher = getAddress(address);
  const { clearing, usdc, deployBlock } = deployment();
  // The head block gives its number and timestamp in one read, so a lagging RPC node cannot miss it.
  const last = await rpc.getBlock();
  const range = scanRange(last.number, SCAN_BLOCKS, deployBlock);

  const [logs, usdcBalance, credit, mon, first] = await Promise.all([
    getClearingLogs(clearing, range, rpc),
    rpc.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [publisher] }),
    rpc.readContract({ address: clearing, abi: ariaClearingAbi, functionName: "credit", args: [publisher] }),
    rpc.getBalance({ address: publisher }),
    rpc.getBlock({ blockNumber: range.fromBlock }),
  ]);

  return toDashboardJson({
    address: publisher,
    clearing,
    usdc: usdcBalance,
    credit,
    mon,
    activity: activityFrom(logs, publisher),
    range,
    times: [
      { block: range.fromBlock, time: Number(first.timestamp) },
      { block: range.toBlock, time: Number(last.timestamp) },
    ],
  });
}
