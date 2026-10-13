import { ariaClearingAbi } from "@aria-clearing/receipt";
import { zeroAddress, type Hex } from "viem";
import { verifyAdvertiser } from "@/lib/advertiser-auth";
import { advertiserWalletOf } from "@/lib/advertiser-wallet";
import { getStoredCampaign, listCampaignsByOwner, saveCampaign, updateCampaign } from "@/lib/campaign-store";
import { campaignBySlug } from "@/lib/campaigns";
import { publicClient } from "@/lib/chain";
import { hasDemoKey } from "@/lib/demo-key";
import { deployment } from "@/lib/deployment";
import { createWalletLaunchHandlers, fundingModeFromEnv, launchLimitsFromEnv } from "./handlers";

const RECEIPT_TIMEOUT_MS = 60_000;

/** True when the campaign id already has an advertiser onchain. */
export async function campaignExists(campaignId: Hex): Promise<boolean> {
  const state = await publicClient().readContract({
    address: deployment().clearing,
    abi: ariaClearingAbi,
    functionName: "campaign",
    args: [campaignId],
  });
  return state.advertiser !== zeroAddress;
}

/** Prepare and confirm wired to Privy, the campaign store and the Monad RPC. */
export const walletLaunch = createWalletLaunchHandlers({
  auth: (req) => verifyAdvertiser(req),
  funding: fundingModeFromEnv,
  walletOf: advertiserWalletOf,
  getRecord: getStoredCampaign,
  save: saveCampaign,
  update: updateCampaign,
  listByOwner: listCampaignsByOwner,
  slugTaken: (slug) => campaignBySlug(slug) !== undefined,
  campaignExists,
  receipt: (hash) => publicClient().waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS }),
  addresses: () => deployment(),
  limits: launchLimitsFromEnv,
  bypass: hasDemoKey,
});
