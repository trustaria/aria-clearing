import { ariaClearingAbi, chunkRange, Kind, MAX_LOG_RANGE, type EventStatus } from "@aria-clearing/receipt";
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
import { deployment } from "./deployment";

/** Blocks scanned back from the head for the recent events list. */
export const RECENT_BLOCKS = 2_000n;
const CONCURRENCY = 6;

const STATUS_BY_CODE: Record<number, EventStatus> = { 1: "logged", 2: "disputed", 3: "released", 4: "rejected" };
const eventLoggedEvent = getAbiItem({ abi: ariaClearingAbi, name: "EventLogged" });

export interface PublisherSummary {
  address: Address;
  /** Native MON balance in wei (gas for claim). */
  mon: bigint;
  /** USDC already in the wallet, 6 decimals. */
  usdc: bigint;
  /** Released credit claimable from the contract, 6 decimals. */
  claimable: bigint;
}

export interface LoggedLog {
  eventId: Hex;
  requestId: string;
  publisher: Address;
  kind: number;
  price: bigint;
  blockNumber: bigint;
  txHash: Hex;
}

export interface PublisherEvent extends Omit<LoggedLog, "kind"> {
  kind: string;
  status: EventStatus;
}

export interface DashboardJson {
  address: string;
  mon: string;
  usdc: string;
  claimable: string;
  events: (Omit<PublisherEvent, "price" | "blockNumber"> & { price: string; blockNumber: string })[];
  fromBlock: string;
  toBlock: string;
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

/** The last `blocks` blocks up to `head`, clipped at the deploy block. */
export function scanRange(head: bigint, blocks: bigint, floor: bigint): { fromBlock: bigint; toBlock: bigint } {
  const start = head - blocks + 1n;
  return { fromBlock: start > floor ? start : floor, toBlock: head };
}

/** This publisher's logged events, newest first, with status codes read from the contract. Pure. */
export function publisherEventsFrom(
  logs: LoggedLog[],
  statusCodes: Record<string, number>,
  publisher: string,
): PublisherEvent[] {
  const me = publisher.toLowerCase();
  return logs
    .filter((log) => log.publisher.toLowerCase() === me)
    .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0))
    .map((log) => ({
      ...log,
      kind: Kind[log.kind] ?? String(log.kind),
      status: STATUS_BY_CODE[statusCodes[log.eventId]] ?? "logged",
    }));
}

export async function getPublisherSummary(address: string, rpc: PublicClient = client()): Promise<PublisherSummary> {
  const publisher = getAddress(address);
  const { clearing, usdc } = deployment();
  const [mon, usdcBalance, claimable] = await Promise.all([
    rpc.getBalance({ address: publisher }),
    rpc.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [publisher] }),
    rpc.readContract({ address: clearing, abi: ariaClearingAbi, functionName: "credit", args: [publisher] }),
  ]);
  return { address: publisher, mon, usdc: usdcBalance, claimable };
}

/**
 * Events credited to `address` in a recent block window. EventLogged does not index the publisher,
 * so every EventLogged in the window is read and filtered here.
 */
export async function getPublisherEvents(
  address: string,
  options: { blocks?: bigint; fromBlock?: bigint; toBlock?: bigint } = {},
  rpc: PublicClient = client(),
): Promise<{ events: PublisherEvent[]; fromBlock: bigint; toBlock: bigint }> {
  const { clearing, deployBlock } = deployment();
  const head = options.toBlock ?? (await rpc.getBlockNumber());
  const range =
    options.fromBlock !== undefined
      ? { fromBlock: options.fromBlock, toBlock: head }
      : scanRange(head, options.blocks ?? RECENT_BLOCKS, deployBlock);

  const chunks = chunkRange(range.fromBlock, range.toBlock, MAX_LOG_RANGE);
  const raw = (
    await mapLimit(chunks, CONCURRENCY, (chunk) =>
      rpc.getLogs({ address: clearing, event: eventLoggedEvent, ...chunk }),
    )
  ).flat();
  const logs: LoggedLog[] = raw.map((log) => ({
    eventId: log.args.eventId!,
    requestId: log.args.requestId!,
    publisher: log.args.publisher!,
    kind: Number(log.args.kind!),
    price: log.args.price!,
    blockNumber: log.blockNumber,
    txHash: log.transactionHash,
  }));

  const mine = logs.filter((log) => log.publisher.toLowerCase() === address.toLowerCase());
  const views = await mapLimit(mine, CONCURRENCY, (log) =>
    rpc.readContract({ address: clearing, abi: ariaClearingAbi, functionName: "clearingEvent", args: [log.eventId] }),
  );
  const statusCodes = Object.fromEntries(mine.map((log, i) => [log.eventId, Number(views[i].status)]));
  return { events: publisherEventsFrom(mine, statusCodes, address), ...range };
}

export function toDashboardJson(
  summary: PublisherSummary,
  events: PublisherEvent[],
  range: { fromBlock: bigint; toBlock: bigint },
): DashboardJson {
  return {
    address: summary.address,
    mon: summary.mon.toString(),
    usdc: summary.usdc.toString(),
    claimable: summary.claimable.toString(),
    events: events.map((e) => ({ ...e, price: e.price.toString(), blockNumber: e.blockNumber.toString() })),
    fromBlock: range.fromBlock.toString(),
    toBlock: range.toBlock.toString(),
  };
}

/** Balances, claimable credit and recent events for one publisher, JSON-safe. */
export async function loadDashboard(address: string): Promise<DashboardJson> {
  const [summary, recent] = await Promise.all([getPublisherSummary(address), getPublisherEvents(address)]);
  return toDashboardJson(summary, recent.events, recent);
}
