import type { Hex } from "viem";
import { verifyAdvertiser } from "@/lib/advertiser-auth";
import { getStoredCampaign, updateCampaign } from "@/lib/campaign-store";
import { disputeEvent, withdrawCampaign } from "@/lib/treasury";
import { createCampaignActions } from "./handlers";

/** Dispute and End wired to Privy auth, the campaign store and the treasury. */
export const campaignActions = createCampaignActions({
  auth: (req) => verifyAdvertiser(req),
  getRecord: getStoredCampaign,
  update: updateCampaign,
  dispute: (campaignId: Hex, eventId: Hex) => disputeEvent(campaignId, eventId),
  withdraw: (campaignId: Hex) => withdrawCampaign(campaignId),
});
