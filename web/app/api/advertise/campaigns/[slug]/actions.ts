import { ariaClearingAbi } from "@aria-clearing/receipt";
import type { Hex } from "viem";
import { verifyAdvertiser } from "@/lib/advertiser-auth";
import { advertiserWalletOf } from "@/lib/advertiser-wallet";
import { getStoredCampaign, updateCampaign } from "@/lib/campaign-store";
import { publicClient } from "@/lib/chain";
import { deployment } from "@/lib/deployment";
import { disputeEvent, withdrawCampaign } from "@/lib/treasury";
import { createCampaignActions } from "./handlers";

const RECEIPT_TIMEOUT_MS = 60_000;

/** Dispute and End wired to Privy auth, the campaign store, the treasury and, for wallet-funded campaigns, the RPC. */
export const campaignActions = createCampaignActions({
  auth: (req) => verifyAdvertiser(req),
  getRecord: getStoredCampaign,
  update: updateCampaign,
  dispute: (campaignId: Hex, eventId: Hex) => disputeEvent(campaignId, eventId),
  withdraw: (campaignId: Hex) => withdrawCampaign(campaignId),
  walletOf: advertiserWalletOf,
  walletReceipt: (hash) => publicClient().waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS }),
  eventCampaign: async (eventId) => {
    const event = await publicClient().readContract({
      address: deployment().clearing,
      abi: ariaClearingAbi,
      functionName: "clearingEvent",
      args: [eventId],
    });
    return event.campaignId;
  },
  clearing: () => deployment().clearing,
});
