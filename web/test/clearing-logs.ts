import { ariaClearingAbi } from "@aria-clearing/receipt";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Address, type Hex, type Log } from "viem";

function log(address: Address, topics: Hex[], data: Hex): Log {
  return {
    address,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber: 70_800_000n,
    blockHash: `0x${"11".repeat(32)}`,
    transactionHash: `0x${"ab".repeat(32)}`,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as Log;
}

/** An `EventDisputed(eventId)` log emitted by `address`. */
export function disputedLog(address: Address, eventId: Hex): Log {
  const event = getAbiItem({ abi: ariaClearingAbi, name: "EventDisputed" });
  const topics = encodeEventTopics({ abi: [event], eventName: "EventDisputed", args: { eventId } });
  return log(address, topics as Hex[], "0x");
}

/** A `Withdrawn(campaignId, amount)` log emitted by `address`. */
export function withdrawnLog(address: Address, campaignId: Hex, amount: bigint): Log {
  const event = getAbiItem({ abi: ariaClearingAbi, name: "Withdrawn" });
  const topics = encodeEventTopics({ abi: [event], eventName: "Withdrawn", args: { campaignId } });
  return log(address, topics as Hex[], encodeAbiParameters([{ type: "uint256" }], [amount]));
}
