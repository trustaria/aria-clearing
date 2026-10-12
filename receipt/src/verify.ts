import {
  createPublicClient,
  getAbiItem,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ariaClearingAbi } from "./abi";
import { claimsHash, eventIdOf, normalizeRationale, requestKeyOf, Kind } from "./hash";

/** Monad public RPCs reject eth_getLogs spans wider than 100 blocks. */
export const MAX_LOG_RANGE = 100n;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_CAMPAIGN_SCAN_CHUNKS = 50;
const DEFAULT_CAMPAIGN_BACK_SCAN_CHUNKS = 200;
const DEFAULT_SETTLEMENT_SCAN_CHUNKS = 30;
/** Chunks searched on each side of the block found for an event's timestamp. */
const LOGGED_WINDOW_CHUNKS = 2n;

// Status enum values (IAriaClearing.Status).
const STATUS_NONE = 0;
const STATUS_LOGGED = 1;
const STATUS_DISPUTED = 2;
const STATUS_RELEASED = 3;
const STATUS_REJECTED = 4;

export type EventStatus = "logged" | "disputed" | "released" | "rejected";
export type LifecycleStage = "campaign" | "logged" | "disputed" | "settled";

interface Located {
  blockNumber: bigint;
  txHash: Hex;
}

export interface CampaignCreatedData {
  campaignId: Hex;
  advertiser: Address;
  /** Claims text from CampaignCreated; null when the log was not found. */
  claims: string | null;
  claimsHash: Hex;
  blockNumber: bigint | null;
  txHash: Hex | null;
}

export interface EventLoggedData extends Located {
  eventId: Hex;
  requestKey: Hex;
  campaignId: Hex;
  requestId: string;
  publisher: Address;
  kind: Kind;
  rationale: string;
  rationaleHash: Hex;
  claimRefs: number[];
  price: bigint;
}

export interface EventDisputedData extends Located {
  eventId: Hex;
}

export interface EventSettledData extends Located {
  eventId: Hex;
  /** Status enum value: 3 Released, 4 Rejected. */
  outcome: number;
}

/** State of one event from the contract's clearingEvent view. */
export interface EventView {
  /** Status enum value: 0 None, 1 Logged, 2 Disputed, 3 Released, 4 Rejected. */
  status: number;
  campaignId: Hex;
  publisher: Address;
  price: bigint;
  /** Block timestamp at which the event was logged. */
  loggedAt: bigint;
}

export interface ReceiptInput {
  campaign: CampaignCreatedData;
  /** claimsHash from the contract's campaign view. */
  claimsHashOnChain?: Hex;
  events: EventLoggedData[];
  /** Views by eventId; when present, status comes from the view rather than from logs. */
  views?: Record<Hex, EventView>;
  disputed: EventDisputedData[];
  settled: EventSettledData[];
}

export interface ReceiptEvent {
  kind: Kind;
  eventId: Hex;
  /** eventId equals keccak256(abi.encode(requestId, kind)) and the emitted requestId is the one asked about. */
  eventIdMatches: boolean;
  publisher: Address;
  rationale: string;
  rationaleHash: Hex;
  /** Emitted rationale hashes to the emitted rationaleHash and is already trimmed and NFC. */
  rationaleMatches: boolean;
  claimRefs: number[];
  /** Claim lines (as numbered in the claims text) the rationale cites; empty when the claims text is unavailable. */
  citedClaims: string[];
  /** Every claimRef points at an existing claim line (true when the claims text is unavailable). */
  claimRefsValid: boolean;
  /** The view's campaign, publisher and price equal the logged event (true when no view was read). */
  viewMatches: boolean;
  /** The event's campaign is the campaign in this receipt. */
  campaignMatches: boolean;
  price: bigint;
  status: EventStatus;
  loggedTx: Hex;
  /** Undefined when no matching log was found in the scanned window. */
  disputedTx?: Hex;
  settledTx?: Hex;
}

export interface LifecycleStep extends Located {
  stage: LifecycleStage;
  eventId?: Hex;
  detail?: string;
}

export interface Receipt {
  requestId: string;
  ok: boolean;
  campaign: {
    campaignId: Hex;
    advertiser: Address;
    /** Null when the CampaignCreated log was not found within the scan bound. */
    claims: string | null;
    claimsHash: Hex;
    /**
     * Claims text hashes to claimsHash and the emitted hash equals the on-chain one.
     * Null when neither comparison was possible.
     */
    claimsMatch: boolean | null;
    createdTx: Hex | null;
  };
  events: ReceiptEvent[];
  lifecycle: LifecycleStep[];
}

function statusFromCode(code: number): EventStatus | undefined {
  if (code === STATUS_LOGGED) return "logged";
  if (code === STATUS_DISPUTED) return "disputed";
  if (code === STATUS_RELEASED) return "released";
  if (code === STATUS_REJECTED) return "rejected";
  return undefined;
}

function statusOf(eventId: Hex, input: ReceiptInput): EventStatus {
  const fromView = input.views?.[eventId] && statusFromCode(input.views[eventId].status);
  if (fromView) return fromView;
  const settled = input.settled.find((s) => s.eventId === eventId);
  if (settled?.outcome === STATUS_RELEASED) return "released";
  if (settled?.outcome === STATUS_REJECTED) return "rejected";
  if (input.disputed.some((d) => d.eventId === eventId)) return "disputed";
  return "logged";
}

function claimsMatchOf(campaign: CampaignCreatedData, onChain?: Hex): boolean | null {
  const checks: boolean[] = [];
  if (campaign.claims !== null) checks.push(claimsHash(campaign.claims) === campaign.claimsHash);
  if (onChain) checks.push(campaign.claimsHash === onChain);
  return checks.length === 0 ? null : checks.every(Boolean);
}

/** Recomputes every hash from the decoded logs and assembles the receipt. Pure. */
export function buildReceipt(requestId: string, input: ReceiptInput): Receipt {
  const { campaign } = input;
  const claimLines = campaign.claims === null ? null : campaign.claims.split("\n");
  const claimsMatch = claimsMatchOf(campaign, input.claimsHashOnChain);

  const events: ReceiptEvent[] = input.events.map((event) => {
    const cited = claimLines
      ? event.claimRefs.flatMap((ref) => (claimLines[ref - 1] === undefined ? [] : [claimLines[ref - 1]]))
      : [];
    const view = input.views?.[event.eventId];
    return {
      kind: event.kind,
      eventId: event.eventId,
      eventIdMatches: event.requestId === requestId && eventIdOf(requestId, event.kind) === event.eventId,
      publisher: event.publisher,
      rationale: event.rationale,
      rationaleHash: event.rationaleHash,
      rationaleMatches:
        keccak256(toBytes(event.rationale)) === event.rationaleHash &&
        normalizeRationale(event.rationale) === event.rationale,
      claimRefs: event.claimRefs,
      citedClaims: cited,
      claimRefsValid: claimLines === null || cited.length === event.claimRefs.length,
      viewMatches:
        view === undefined ||
        (view.campaignId === event.campaignId && view.publisher === event.publisher && view.price === event.price),
      campaignMatches: event.campaignId === campaign.campaignId,
      price: event.price,
      status: statusOf(event.eventId, input),
      loggedTx: event.txHash,
      disputedTx: input.disputed.find((d) => d.eventId === event.eventId)?.txHash,
      settledTx: input.settled.find((s) => s.eventId === event.eventId)?.txHash,
    };
  });

  const campaignStep: LifecycleStep[] =
    campaign.blockNumber !== null && campaign.txHash !== null
      ? [{ stage: "campaign", blockNumber: campaign.blockNumber, txHash: campaign.txHash }]
      : [];
  const lifecycle: LifecycleStep[] = [
    ...campaignStep,
    ...input.events.map((e) => ({
      stage: "logged" as const,
      eventId: e.eventId,
      detail: Kind[e.kind],
      blockNumber: e.blockNumber,
      txHash: e.txHash,
    })),
    ...input.disputed.map((d) => ({
      stage: "disputed" as const,
      eventId: d.eventId,
      blockNumber: d.blockNumber,
      txHash: d.txHash,
    })),
    ...input.settled.map((s) => ({
      stage: "settled" as const,
      eventId: s.eventId,
      detail: s.outcome === STATUS_RELEASED ? "released" : s.outcome === STATUS_REJECTED ? "rejected" : String(s.outcome),
      blockNumber: s.blockNumber,
      txHash: s.txHash,
    })),
  ].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));

  const ok =
    claimsMatch !== false &&
    events.length > 0 &&
    events.every(
      (e) => e.eventIdMatches && e.rationaleMatches && e.claimRefsValid && e.campaignMatches && e.viewMatches,
    );

  return {
    requestId,
    ok,
    campaign: {
      campaignId: campaign.campaignId,
      advertiser: campaign.advertiser,
      claims: campaign.claims,
      claimsHash: campaign.claimsHash,
      claimsMatch,
      createdTx: campaign.txHash,
    },
    events,
    lifecycle,
  };
}

/** Splits the inclusive range [from, to] into inclusive chunks of at most `size` blocks. */
export function chunkRange(from: bigint, to: bigint, size: bigint): { fromBlock: bigint; toBlock: bigint }[] {
  const chunks: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    chunks.push({ fromBlock: start, toBlock: end < to ? end : to });
  }
  return chunks;
}

/**
 * Smallest block in [lo, hi] whose timestamp is at least `target` (hi when none is).
 * Timestamps must be non-decreasing in the block number.
 */
export async function findBlockAtTimestamp(
  getTimestamp: (block: bigint) => Promise<bigint>,
  lo: bigint,
  hi: bigint,
  target: bigint,
): Promise<bigint> {
  let low = lo;
  let high = hi;
  while (low < high) {
    const mid = (low + high) / 2n;
    if ((await getTimestamp(mid)) >= target) high = mid;
    else low = mid + 1n;
  }
  return low;
}

/**
 * Walks [floor, start] from `start` downward in chunks of at most `size` blocks, at most
 * `maxChunks` of them, `batch` chunks at a time. Returns the results of the first
 * batch (nearest chunk first) that has any, or [] when none does.
 */
export async function scanBackward<T>(
  start: bigint,
  floor: bigint,
  size: bigint,
  maxChunks: number,
  batch: number,
  getChunk: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>,
): Promise<T[]> {
  const chunks: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let to = start; to >= floor && chunks.length < maxChunks; to -= size) {
    const from = to - size + 1n;
    chunks.push({ fromBlock: from > floor ? from : floor, toBlock: to });
  }
  for (let i = 0; i < chunks.length; i += batch) {
    const found = (await mapLimit(chunks.slice(i, i + batch), batch, getChunk)).flat();
    if (found.length > 0) return found;
  }
  return [];
}

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping result order. */
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

export interface VerifyOptions {
  rpcUrl: string;
  address: Address;
  /**
   * Deploy block. Lower bound for the timestamp search and start of the CampaignCreated scan;
   * without it the claims text is reported unavailable.
   */
  fromBlock?: bigint;
  /** Upper bound for the timestamp search; defaults to the chain head. */
  toBlock?: bigint;
  /** Blocks per eth_getLogs call; defaults to the Monad public RPC limit. */
  maxRange?: bigint;
  concurrency?: number;
  /** Chunks scanned forward from fromBlock (or campaignFromBlock) for CampaignCreated. */
  campaignScanChunks?: number;
  /** Chunks scanned backward from the logged block for CampaignCreated, never below fromBlock. */
  campaignBackScanChunks?: number;
  /** Block where the forward CampaignCreated scan starts; when set, the backward scan is skipped. */
  campaignFromBlock?: bigint;
  /** Chunks scanned forward from the logged block for EventDisputed and EventSettled. */
  settlementScanChunks?: number;
  /** Replaces the client built from rpcUrl (tests, shared clients). */
  client?: PublicClient;
}

const campaignCreatedEvent = getAbiItem({ abi: ariaClearingAbi, name: "CampaignCreated" });
const eventLoggedEvent = getAbiItem({ abi: ariaClearingAbi, name: "EventLogged" });
const eventDisputedEvent = getAbiItem({ abi: ariaClearingAbi, name: "EventDisputed" });
const eventSettledEvent = getAbiItem({ abi: ariaClearingAbi, name: "EventSettled" });

/**
 * Reads a receipt from the chain with plain RPC: state from the contract views, block
 * located by timestamp search, then logs from small bounded windows.
 */
export async function verifyReceipt(requestId: string, options: VerifyOptions): Promise<Receipt> {
  const client: PublicClient =
    options.client ?? createPublicClient({ transport: http(options.rpcUrl, { retryCount: 5, retryDelay: 300 }) });
  const { address } = options;
  const maxRange = options.maxRange ?? MAX_LOG_RANGE;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const head = options.toBlock ?? (await client.getBlockNumber());
  const floor = options.fromBlock ?? 0n;

  const scan = async <T>(
    from: bigint,
    to: bigint,
    maxChunks: number,
    getChunk: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>,
  ) => {
    const chunks = chunkRange(from, to, maxRange).slice(0, maxChunks);
    return (await mapLimit(chunks, concurrency, getChunk)).flat();
  };

  // 1. Authoritative state from the views.
  const kinds = [Kind.Impression, Kind.Click];
  const eventIds = kinds.map((kind) => eventIdOf(requestId, kind));
  const rawViews = await Promise.all(
    eventIds.map((eventId) =>
      client.readContract({ address, abi: ariaClearingAbi, functionName: "clearingEvent", args: [eventId] }),
    ),
  );
  const views: Record<Hex, EventView> = {};
  rawViews.forEach((raw, i) => {
    if (raw.status === STATUS_NONE) return;
    views[eventIds[i]] = {
      status: raw.status,
      campaignId: raw.campaignId,
      publisher: raw.publisher,
      price: raw.price,
      loggedAt: raw.loggedAt,
    };
  });
  const knownIds = Object.keys(views) as Hex[];
  if (knownIds.length === 0) throw new Error(`No event found on chain for requestId "${requestId}"`);

  // 2. Locate the logging blocks by timestamp and read EventLogged around them.
  const timestamps = new Map<bigint, Promise<bigint>>();
  const timestampOf = (block: bigint) => {
    if (!timestamps.has(block)) timestamps.set(block, client.getBlock({ blockNumber: block }).then((b) => b.timestamp));
    return timestamps.get(block)!;
  };
  const loggedBlocks = await Promise.all(
    knownIds.map((id) => findBlockAtTimestamp(timestampOf, floor, head, views[id].loggedAt)),
  );
  const requestKey = requestKeyOf(requestId);
  const windows = new Map<string, { fromBlock: bigint; toBlock: bigint }>();
  for (const block of loggedBlocks) {
    const fromBlock = block - LOGGED_WINDOW_CHUNKS * maxRange > floor ? block - LOGGED_WINDOW_CHUNKS * maxRange : floor;
    const toBlock = block + LOGGED_WINDOW_CHUNKS * maxRange < head ? block + LOGGED_WINDOW_CHUNKS * maxRange : head;
    windows.set(`${fromBlock}-${toBlock}`, { fromBlock, toBlock });
  }
  const loggedLogs = (
    await Promise.all(
      [...windows.values()].map((w) =>
        scan(w.fromBlock, w.toBlock, Number.MAX_SAFE_INTEGER, (range) =>
          client.getLogs({ address, event: eventLoggedEvent, args: { requestKey }, ...range }),
        ),
      ),
    )
  ).flat();

  const seen = new Set<Hex>();
  const events: EventLoggedData[] = [];
  for (const log of loggedLogs) {
    const eventId = log.args.eventId!;
    if (seen.has(eventId)) continue;
    seen.add(eventId);
    events.push({
      eventId,
      requestKey: log.args.requestKey!,
      campaignId: log.args.campaignId!,
      requestId: log.args.requestId!,
      publisher: log.args.publisher!,
      kind: log.args.kind! as Kind,
      rationale: log.args.rationale!,
      rationaleHash: log.args.rationaleHash!,
      claimRefs: [...log.args.claimRefs!],
      price: log.args.price!,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
    });
  }
  const missing = knownIds.filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`EventLogged not found near its logging block for ${missing.join(", ")}`);

  // 3. Campaign: claims hash from the view, claims text from a bounded backward then forward scan.
  const campaignId = events[0].campaignId;
  const firstLogged = events.reduce((min, e) => (e.blockNumber < min ? e.blockNumber : min), events[0].blockNumber);
  const campaignView = await client.readContract({
    address,
    abi: ariaClearingAbi,
    functionName: "campaign",
    args: [campaignId],
  });

  const getCampaignLogs = (range: { fromBlock: bigint; toBlock: bigint }) =>
    client.getLogs({ address, event: campaignCreatedEvent, args: { campaignId }, ...range });
  const forwardCampaignScan = (from: bigint) =>
    scan(from, firstLogged, options.campaignScanChunks ?? DEFAULT_CAMPAIGN_SCAN_CHUNKS, getCampaignLogs);
  const findCampaignLogs = async () => {
    if (options.campaignFromBlock !== undefined) return forwardCampaignScan(options.campaignFromBlock);
    if (options.fromBlock === undefined) return [];
    const back = await scanBackward(
      firstLogged,
      floor,
      maxRange,
      options.campaignBackScanChunks ?? DEFAULT_CAMPAIGN_BACK_SCAN_CHUNKS,
      concurrency,
      getCampaignLogs,
    );
    return back.length > 0 ? back : forwardCampaignScan(floor);
  };
  const campaignScan = findCampaignLogs();

  // 4. Dispute and settlement transactions from a bounded forward scan.
  const settlementChunks = options.settlementScanChunks ?? DEFAULT_SETTLEMENT_SCAN_CHUNKS;
  const [campaignLogs, disputedLogs, settledLogs] = await Promise.all([
    campaignScan,
    scan(firstLogged, head, settlementChunks, (range) =>
      client.getLogs({ address, event: eventDisputedEvent, args: { eventId: knownIds }, ...range }),
    ),
    scan(firstLogged, head, settlementChunks, (range) =>
      client.getLogs({ address, event: eventSettledEvent, args: { eventId: knownIds }, ...range }),
    ),
  ]);

  const created = campaignLogs[0];
  return buildReceipt(requestId, {
    campaign: {
      campaignId,
      advertiser: created?.args.advertiser ?? campaignView.advertiser,
      claims: created?.args.claims ?? null,
      claimsHash: created?.args.claimsHash ?? campaignView.claimsHash,
      blockNumber: created?.blockNumber ?? null,
      txHash: created?.transactionHash ?? null,
    },
    claimsHashOnChain: campaignView.claimsHash,
    events,
    views,
    disputed: disputedLogs.map((log) => ({
      eventId: log.args.eventId!,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
    })),
    settled: settledLogs.map((log) => ({
      eventId: log.args.eventId!,
      outcome: Number(log.args.outcome!),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
    })),
  });
}
