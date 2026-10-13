import { ariaClearingAbi, Kind, MAX_LOG_RANGE } from "@aria-clearing/receipt";
import { createPublicClient, getAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { monadTestnet } from "viem/chains";
import { fundingOf, type CampaignFunding, type CampaignStatus, type StoredCampaign } from "./campaign-store";
import { DISPUTE_WINDOW_S, rpcTransport } from "./chain";
import { deployment } from "./deployment";

/** Blocks scanned back from the head (~2 hours on Monad); the funds come from contract state regardless. */
export const SCAN_BLOCKS = 20_000n;
/** Sentences returned to the campaign page. */
export const RECENT_LIMIT = 20;
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

/** One decoded contract log, reduced to what the campaign page needs. A deferred payout counts as paid. */
export type CampaignLog =
  | (Located & { type: "logged"; requestId: string; campaignId: Hex; kind: number; price: bigint; rationale: string })
  | (Located & { type: "disputed" })
  | (Located & { type: "settled"; outcome: number })
  | (Located & { type: "paid" });

/** disputed: the advertiser disputed it and the verdict is not in yet. */
export type SentenceStatus = "verified" | "being_verified" | "disputed" | "rejected";
export type RejectReason = "not_viewed" | "no_redirect" | "disputed";
export type KindName = "Impression" | "Click";

export interface Sentence {
  eventId: Hex;
  requestId: string;
  kind: KindName;
  rationale: string;
  price: bigint;
  status: SentenceStatus;
  reason: RejectReason | null;
  blockNumber: bigint;
  txHash: Hex;
}

export interface Funds {
  budget: bigint;
  spent: bigint;
  remaining: bigint;
  pending: bigint;
  refunded: bigint;
}

export interface Counts {
  /** Impressions and clicks that were not rejected. */
  impressions: number;
  clicks: number;
  verified: number;
  /** Awaiting verification, disputed ones included. */
  beingVerified: number;
  rejected: number;
  rejectedBy: Record<RejectReason, number>;
}

export interface SentenceJson {
  eventId: string;
  requestId: string;
  kind: KindName;
  rationale: string;
  price: string;
  status: SentenceStatus;
  reason: RejectReason | null;
  /** Unix seconds of the block that logged it. */
  time: number;
  /** Seconds left to dispute it; 0 once closed or no longer disputable. */
  disputeSecondsLeft: number;
}

export interface CampaignStatsJson {
  slug: string;
  brand: string;
  url: string;
  status: CampaignStatus;
  /** wallet: the advertiser's wallet signs Dispute and End. */
  funding?: CampaignFunding;
  claims: string[];
  /** USDC amounts with 6 decimals, as strings. */
  funds: Record<keyof Funds, string>;
  counts: Counts;
  /** Newest first, at most RECENT_LIMIT. */
  sentences: SentenceJson[];
  account: { campaignId: string; treasury: string; txHash: string; clearing: string; network: string };
  /** Server time in unix seconds. */
  now: number;
  scanned: { fromBlock: string; toBlock: string };
}

/** Remaining = available, Pending = reserved, Spent = the rest of the budget after refunds (never negative). */
export function fundsOf(input: { budget: bigint; available: bigint; reserved: bigint; refunded: bigint }): Funds {
  const spent = input.budget - input.available - input.reserved - input.refunded;
  return {
    budget: input.budget,
    spent: spent > 0n ? spent : 0n,
    remaining: input.available,
    pending: input.reserved,
    refunded: input.refunded,
  };
}

function rejectReason(kind: KindName, disputed: boolean): RejectReason {
  if (disputed) return "disputed";
  return kind === "Click" ? "no_redirect" : "not_viewed";
}

/** This campaign's logged events with their verification status, newest first. Pure. */
export function campaignSentences(logs: CampaignLog[], campaignId: Hex): Sentence[] {
  const mine = campaignId.toLowerCase();
  const disputed = new Set<Hex>();
  const outcomes = new Map<Hex, number>();
  const paid = new Set<Hex>();
  for (const log of logs) {
    if (log.type === "disputed") disputed.add(log.eventId);
    else if (log.type === "settled") outcomes.set(log.eventId, log.outcome);
    else if (log.type === "paid") paid.add(log.eventId);
  }

  return logs
    .filter((log): log is Extract<CampaignLog, { type: "logged" }> => log.type === "logged")
    .filter((log) => log.campaignId.toLowerCase() === mine)
    .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0))
    .map((log) => {
      const kind: KindName = log.kind === Kind.Click ? "Click" : "Impression";
      const outcome = outcomes.get(log.eventId);
      const wasDisputed = disputed.has(log.eventId);
      let status: SentenceStatus = wasDisputed ? "disputed" : "being_verified";
      if (outcome === STATUS_REJECTED) status = "rejected";
      else if (outcome === STATUS_RELEASED || paid.has(log.eventId)) status = "verified";
      return {
        eventId: log.eventId,
        requestId: log.requestId,
        kind,
        rationale: log.rationale,
        price: log.price,
        status,
        reason: status === "rejected" ? rejectReason(kind, wasDisputed) : null,
        blockNumber: log.blockNumber,
        txHash: log.txHash,
      };
    });
}

/** Delivery and verification counts over a campaign's sentences. Pure. */
export function countsOf(sentences: Sentence[]): Counts {
  const counts: Counts = {
    impressions: 0,
    clicks: 0,
    verified: 0,
    beingVerified: 0,
    rejected: 0,
    rejectedBy: { not_viewed: 0, no_redirect: 0, disputed: 0 },
  };
  for (const s of sentences) {
    if (s.status === "rejected") {
      counts.rejected += 1;
      counts.rejectedBy[s.reason ?? rejectReason(s.kind, false)] += 1;
      continue;
    }
    if (s.kind === "Click") counts.clicks += 1;
    else counts.impressions += 1;
    if (s.status === "verified") counts.verified += 1;
    else counts.beingVerified += 1;
  }
  return counts;
}

/** Blocks to scan: from the campaign's creation block, at most the last `blocks` blocks up to `head`. */
export function scanWindow(head: bigint, createdBlock: bigint, blocks: bigint): { fromBlock: bigint; toBlock: bigint } {
  const floor = head - blocks + 1n;
  return { fromBlock: createdBlock > floor ? createdBlock : floor, toBlock: head };
}

/** The campaign page's JSON from the record, contract state and decoded sentences. Pure. */
export function toCampaignStatsJson(input: {
  record: StoredCampaign;
  onchain: { advertiser: string; available: bigint; reserved: bigint };
  sentences: Sentence[];
  /** Unix seconds by block number, for the recent sentences. */
  times: Map<bigint, number>;
  now: number;
  clearing: string;
  range: { fromBlock: bigint; toBlock: bigint };
  disputeWindow: number;
}): CampaignStatsJson {
  const { record, onchain, now } = input;
  const funds = fundsOf({
    budget: BigInt(record.budget),
    available: onchain.available,
    reserved: onchain.reserved,
    refunded: BigInt(record.refunded ?? 0),
  });
  return {
    slug: record.slug,
    brand: record.advertiser,
    url: record.url,
    status: record.status,
    funding: fundingOf(record),
    claims: record.claims,
    funds: {
      budget: funds.budget.toString(),
      spent: funds.spent.toString(),
      remaining: funds.remaining.toString(),
      pending: funds.pending.toString(),
      refunded: funds.refunded.toString(),
    },
    counts: countsOf(input.sentences),
    sentences: input.sentences.slice(0, RECENT_LIMIT).map((s) => {
      const time = input.times.get(s.blockNumber) ?? now;
      const left = s.status === "being_verified" ? Math.floor(time + input.disputeWindow - now) : 0;
      return {
        eventId: s.eventId,
        requestId: s.requestId,
        kind: s.kind,
        rationale: s.rationale,
        price: s.price.toString(),
        status: s.status,
        reason: s.reason,
        time,
        disputeSecondsLeft: Math.max(0, left),
      };
    }),
    account: {
      campaignId: record.campaignId,
      treasury: onchain.advertiser,
      txHash: record.txHash,
      clearing: input.clearing,
      network: "Monad testnet",
    },
    now,
    scanned: { fromBlock: input.range.fromBlock.toString(), toBlock: input.range.toBlock.toString() },
  };
}

let sharedClient: PublicClient | undefined;

function client(): PublicClient {
  sharedClient ??= createPublicClient({
    chain: monadTestnet,
    transport: rpcTransport(deployment().rpcUrl, { retryCount: 3, retryDelay: 300 }),
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

/** [from, to] split on multiples of `size`, so the same chunks repeat across polls and can be cached. */
function alignedChunks(from: bigint, to: bigint, size: bigint): { fromBlock: bigint; toBlock: bigint }[] {
  const chunks: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = (from / size) * size; start <= to; start += size) {
    const end = start + size - 1n;
    chunks.push({ fromBlock: start, toBlock: end < to ? end : to });
  }
  return chunks;
}

type RawLog = Awaited<ReturnType<typeof readChunk>>[number];

async function readChunk(rpc: PublicClient, clearing: Address, chunk: { fromBlock: bigint; toBlock: bigint }) {
  return rpc.getLogs({ address: clearing, events: clearingEvents, strict: true, ...chunk });
}

function toCampaignLog(log: RawLog): CampaignLog {
  const base = { eventId: log.args.eventId, blockNumber: log.blockNumber, txHash: log.transactionHash };
  switch (log.eventName) {
    case "EventLogged":
      return {
        ...base,
        type: "logged",
        requestId: log.args.requestId,
        campaignId: log.args.campaignId,
        kind: Number(log.args.kind),
        price: log.args.price,
        rationale: log.args.rationale,
      };
    case "EventDisputed":
      return { ...base, type: "disputed" };
    case "EventSettled":
      return { ...base, type: "settled", outcome: Number(log.args.outcome) };
    case "PaidOut":
    case "PayoutDeferred":
      return { ...base, type: "paid" };
  }
}

// Shared across route bundles and dev reloads: full chunks behind the head never change.
const globalCache = globalThis as typeof globalThis & {
  __ariaCampaignChunks?: Map<string, Promise<CampaignLog[]>>;
  __ariaBlockTimes?: Map<bigint, number>;
};
const chunkCache = (globalCache.__ariaCampaignChunks ??= new Map<string, Promise<CampaignLog[]>>());
const blockTimes = (globalCache.__ariaBlockTimes ??= new Map<bigint, number>());
const MAX_BLOCK_TIMES = 5_000;

/** Clearing logs in [fromBlock, toBlock], one getLogs per 100-block chunk (the Monad RPC limit). */
export async function getCampaignLogs(
  clearing: Address,
  range: { fromBlock: bigint; toBlock: bigint },
  rpc: PublicClient = client(),
): Promise<CampaignLog[]> {
  const chunks = alignedChunks(range.fromBlock, range.toBlock, MAX_LOG_RANGE);
  const perChunk = await mapLimit(chunks, CONCURRENCY, (chunk) => {
    const key = `${clearing}:${chunk.fromBlock}-${chunk.toBlock}`;
    const cached = chunkCache.get(key);
    if (cached) return cached;
    const complete = chunk.toBlock - chunk.fromBlock + 1n === MAX_LOG_RANGE;
    const keep = complete && chunk.toBlock + UNSETTLED_BLOCKS < range.toBlock;
    const read = readChunk(rpc, clearing, chunk).then((logs) => logs.map(toCampaignLog));
    chunkCache.set(key, read);
    read.then(
      () => keep || chunkCache.delete(key),
      () => chunkCache.delete(key),
    );
    return read;
  });
  return perChunk.flat().filter((log) => log.blockNumber >= range.fromBlock);
}

/** Unix seconds of each block, read once and cached. */
async function timesOf(blocks: bigint[], rpc: PublicClient): Promise<Map<bigint, number>> {
  const missing = Array.from(new Set(blocks)).filter((b) => !blockTimes.has(b));
  await mapLimit(missing, CONCURRENCY, async (blockNumber) => {
    const block = await rpc.getBlock({ blockNumber });
    if (blockTimes.size >= MAX_BLOCK_TIMES) blockTimes.clear();
    blockTimes.set(blockNumber, Number(block.timestamp));
  });
  return new Map(blocks.map((b) => [b, blockTimes.get(b) ?? 0]));
}

/** Funds from contract state, counts and recent sentences from the logs since the campaign was created. */
export async function loadCampaignStats(
  record: StoredCampaign,
  rpc: PublicClient = client(),
): Promise<CampaignStatsJson> {
  const { clearing, deployBlock } = deployment();
  const head = await rpc.getBlockNumber();
  const created = BigInt(record.createdBlock) > deployBlock ? BigInt(record.createdBlock) : deployBlock;
  const range = scanWindow(head, created, SCAN_BLOCKS);

  const [state, logs] = await Promise.all([
    rpc.readContract({ address: clearing, abi: ariaClearingAbi, functionName: "campaign", args: [record.campaignId] }),
    getCampaignLogs(clearing, range, rpc),
  ]);
  const sentences = campaignSentences(logs, record.campaignId);
  const times = await timesOf(
    sentences.slice(0, RECENT_LIMIT).map((s) => s.blockNumber),
    rpc,
  );

  return toCampaignStatsJson({
    record,
    onchain: { advertiser: state.advertiser, available: state.available, reserved: state.reserved },
    sentences,
    times,
    now: Date.now() / 1000,
    clearing,
    range,
    disputeWindow: DISPUTE_WINDOW_S,
  });
}
