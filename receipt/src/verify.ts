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

// Status enum values emitted in EventSettled.outcome.
const OUTCOME_RELEASED = 3;
const OUTCOME_REJECTED = 4;

export type EventStatus = "logged" | "disputed" | "released" | "rejected";
export type LifecycleStage = "campaign" | "logged" | "disputed" | "settled";

interface Located {
  blockNumber: bigint;
  txHash: Hex;
}

export interface CampaignCreatedData extends Located {
  campaignId: Hex;
  advertiser: Address;
  claims: string;
  claimsHash: Hex;
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

export interface ReceiptInput {
  campaign: CampaignCreatedData;
  events: EventLoggedData[];
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
  /** Claim lines (as numbered in the claims text) the rationale cites. */
  citedClaims: string[];
  /** Every claimRef points at an existing claim line. */
  claimRefsValid: boolean;
  /** The event's campaign is the campaign in this receipt. */
  campaignMatches: boolean;
  price: bigint;
  status: EventStatus;
  loggedTx: Hex;
  settledTx: Hex | null;
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
    claims: string;
    claimsHash: Hex;
    /** keccak256(claims) equals the emitted claimsHash. */
    claimsMatch: boolean;
    createdTx: Hex;
  };
  events: ReceiptEvent[];
  lifecycle: LifecycleStep[];
}

function statusOf(eventId: Hex, input: ReceiptInput): EventStatus {
  const settled = input.settled.find((s) => s.eventId === eventId);
  if (settled?.outcome === OUTCOME_RELEASED) return "released";
  if (settled?.outcome === OUTCOME_REJECTED) return "rejected";
  if (input.disputed.some((d) => d.eventId === eventId)) return "disputed";
  return "logged";
}

/** Recomputes every hash from the decoded logs and assembles the receipt. Pure. */
export function buildReceipt(requestId: string, input: ReceiptInput): Receipt {
  const { campaign } = input;
  const claimLines = campaign.claims.split("\n");
  const claimsMatch = claimsHash(campaign.claims) === campaign.claimsHash;

  const events: ReceiptEvent[] = input.events.map((event) => {
    const citedClaims = event.claimRefs.flatMap((ref) => (claimLines[ref - 1] === undefined ? [] : [claimLines[ref - 1]]));
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
      citedClaims,
      claimRefsValid: citedClaims.length === event.claimRefs.length,
      campaignMatches: event.campaignId === campaign.campaignId,
      price: event.price,
      status: statusOf(event.eventId, input),
      loggedTx: event.txHash,
      settledTx: input.settled.find((s) => s.eventId === event.eventId)?.txHash ?? null,
    };
  });

  const lifecycle: LifecycleStep[] = [
    { stage: "campaign" as const, blockNumber: campaign.blockNumber, txHash: campaign.txHash },
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
      detail: s.outcome === OUTCOME_RELEASED ? "released" : s.outcome === OUTCOME_REJECTED ? "rejected" : String(s.outcome),
      blockNumber: s.blockNumber,
      txHash: s.txHash,
    })),
  ].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));

  const ok =
    claimsMatch &&
    events.length > 0 &&
    events.every((e) => e.eventIdMatches && e.rationaleMatches && e.claimRefsValid && e.campaignMatches);

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
  /** First block to scan, normally the deploy block. */
  fromBlock: bigint;
  /** Last block to scan; defaults to the chain head. */
  toBlock?: bigint;
  /** Blocks per eth_getLogs call; defaults to the Monad public RPC limit. */
  maxRange?: bigint;
  concurrency?: number;
  /** Replaces the client built from rpcUrl (tests, shared clients). */
  client?: PublicClient;
}

const campaignCreatedEvent = getAbiItem({ abi: ariaClearingAbi, name: "CampaignCreated" });
const eventLoggedEvent = getAbiItem({ abi: ariaClearingAbi, name: "EventLogged" });
const eventDisputedEvent = getAbiItem({ abi: ariaClearingAbi, name: "EventDisputed" });
const eventSettledEvent = getAbiItem({ abi: ariaClearingAbi, name: "EventSettled" });

/** Reads the receipt's events from chain logs alone and verifies them. */
export async function verifyReceipt(requestId: string, options: VerifyOptions): Promise<Receipt> {
  const client: PublicClient =
    options.client ?? createPublicClient({ transport: http(options.rpcUrl, { retryCount: 5, retryDelay: 300 }) });
  const { address, fromBlock } = options;
  const maxRange = options.maxRange ?? MAX_LOG_RANGE;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const toBlock = options.toBlock ?? (await client.getBlockNumber());

  const scan = async <T>(from: bigint, to: bigint, getChunk: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>) =>
    (await mapLimit(chunkRange(from, to, maxRange), concurrency, getChunk)).flat();

  const loggedLogs = await scan(fromBlock, toBlock, (range) =>
    client.getLogs({ address, event: eventLoggedEvent, args: { requestKey: requestKeyOf(requestId) }, ...range }),
  );
  if (loggedLogs.length === 0) throw new Error(`No EventLogged found for requestId "${requestId}"`);

  const events: EventLoggedData[] = loggedLogs.map((log) => ({
    eventId: log.args.eventId!,
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
  }));

  const campaignId = events[0].campaignId;
  const firstLogged = events.reduce((min, e) => (e.blockNumber < min ? e.blockNumber : min), events[0].blockNumber);
  const eventIds = events.map((e) => e.eventId);

  const [campaignLogs, disputedLogs, settledLogs] = await Promise.all([
    scan(fromBlock, firstLogged, (range) =>
      client.getLogs({ address, event: campaignCreatedEvent, args: { campaignId }, ...range }),
    ),
    scan(firstLogged, toBlock, (range) =>
      client.getLogs({ address, event: eventDisputedEvent, args: { eventId: eventIds }, ...range }),
    ),
    scan(firstLogged, toBlock, (range) =>
      client.getLogs({ address, event: eventSettledEvent, args: { eventId: eventIds }, ...range }),
    ),
  ]);
  if (campaignLogs.length === 0) throw new Error(`No CampaignCreated found for campaign ${campaignId}`);

  const created = campaignLogs[0];
  return buildReceipt(requestId, {
    campaign: {
      campaignId: created.args.campaignId!,
      advertiser: created.args.advertiser!,
      claims: created.args.claims!,
      claimsHash: created.args.claimsHash!,
      blockNumber: created.blockNumber,
      txHash: created.transactionHash,
    },
    events,
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
