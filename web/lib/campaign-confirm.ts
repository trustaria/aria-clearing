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
