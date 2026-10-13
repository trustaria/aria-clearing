import { ariaClearingAbi, claimsHash, formatClaims } from "@aria-clearing/receipt";
import { isAddressEqual, parseEventLogs, type Address, type Hex, type Log, type TransactionReceipt } from "viem";
import type { StoredCampaign } from "./campaign-store";

/** The fields of a `CampaignCreated` log. Amounts are USDC with 6 decimals. */
export type CampaignCreatedLog = {
  campaignId: Hex;
  advertiser: Address;
  claimsHash: Hex;
  priceImpression: bigint;
  priceClick: bigint;
  budget: bigint;
};

export type ConfirmReceipt = Pick<TransactionReceipt, "status"> & { logs: Log[] };

/** The single `CampaignCreated` log the clearing contract emitted in a successful receipt, or why there is none. Pure. */
export function campaignCreatedIn(receipt: ConfirmReceipt, clearing: Address): { log: CampaignCreatedLog } | { error: string } {
  if (receipt.status !== "success") return { error: "reverted" };
  const logs = parseEventLogs({ abi: ariaClearingAbi, eventName: "CampaignCreated", logs: receipt.logs }).filter((log) =>
    isAddressEqual(log.address, clearing),
  );
  if (logs.length === 0) return { error: "no CampaignCreated log" };
  if (logs.length > 1) return { error: "more than one CampaignCreated log" };
  const { campaignId, advertiser, claimsHash, priceImpression, priceClick, budget } = logs[0].args;
  return { log: { campaignId, advertiser, claimsHash, priceImpression, priceClick, budget } };
}

/** Why a CampaignCreated log does not match the pending record, or null when it does. Pure. */
export function confirmMismatch(log: CampaignCreatedLog, pending: StoredCampaign, wallet: Address): string | null {
  if (log.campaignId.toLowerCase() !== pending.campaignId.toLowerCase()) return "campaign id";
  if (!isAddressEqual(log.advertiser, wallet)) return "advertiser";
  if (log.claimsHash.toLowerCase() !== claimsHash(formatClaims(pending.claims)).toLowerCase()) return "claims";
  if (log.priceImpression !== BigInt(pending.priceImpression)) return "price impression";
  if (log.priceClick !== BigInt(pending.priceClick)) return "price click";
  if (log.budget !== BigInt(pending.budget)) return "budget";
  return null;
}

/** Why a createCampaign receipt does not launch the pending record from `wallet`, or null when it does. Pure. */
export function checkCampaignCreated(
  receipt: ConfirmReceipt,
  clearing: Address,
  pending: StoredCampaign,
  wallet: Address,
): string | null {
  const found = campaignCreatedIn(receipt, clearing);
  return "error" in found ? found.error : confirmMismatch(found.log, pending, wallet);
}

/** A mined transaction sent by the advertiser's wallet. */
export type WalletReceipt = ConfirmReceipt & { from: Address };

function sentBy(receipt: WalletReceipt, wallet: Address): string | null {
  if (receipt.status !== "success") return "reverted";
  if (!isAddressEqual(receipt.from, wallet)) return "sender";
  return null;
}

/** Why a receipt does not show `wallet` disputing `eventId` on the clearing contract, or null when it does. Pure. */
export function disputeMismatch(receipt: WalletReceipt, clearing: Address, wallet: Address, eventId: Hex): string | null {
  const sender = sentBy(receipt, wallet);
  if (sender) return sender;
  const found = parseEventLogs({ abi: ariaClearingAbi, eventName: "EventDisputed", logs: receipt.logs }).some(
    (log) => isAddressEqual(log.address, clearing) && log.args.eventId.toLowerCase() === eventId.toLowerCase(),
  );
  return found ? null : "no EventDisputed log";
}

/** The amount `wallet` withdrew from the campaign according to the receipt's `Withdrawn` log, or why not. Pure. */
export function withdrawnBy(
  receipt: WalletReceipt,
  clearing: Address,
  wallet: Address,
  campaignId: Hex,
): { amount: bigint } | { error: string } {
  const sender = sentBy(receipt, wallet);
  if (sender) return { error: sender };
  const log = parseEventLogs({ abi: ariaClearingAbi, eventName: "Withdrawn", logs: receipt.logs }).find(
    (l) => isAddressEqual(l.address, clearing) && l.args.campaignId.toLowerCase() === campaignId.toLowerCase(),
  );
  return log ? { amount: log.args.amount } : { error: "no Withdrawn log" };
}
