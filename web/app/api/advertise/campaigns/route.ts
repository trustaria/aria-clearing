import { ariaClearingAbi } from "@aria-clearing/receipt";
import type { Hex } from "viem";
import { verifyAdvertiser } from "@/lib/advertiser-auth";
import { listCampaignsByOwner, saveCampaign } from "@/lib/campaign-store";
import { campaignBySlug } from "@/lib/campaigns";
import { publicClient } from "@/lib/chain";
import { deployment } from "@/lib/deployment";
import { launchCampaign, treasuryUsdcBalance } from "@/lib/treasury";
import { createCampaignHandlers } from "./handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function campaignState(campaignId: Hex) {
  const state = await publicClient().readContract({
    address: deployment().clearing,
    abi: ariaClearingAbi,
    functionName: "campaign",
    args: [campaignId],
  });
  return { available: state.available, reserved: state.reserved };
}

const handlers = createCampaignHandlers({
  auth: (req) => verifyAdvertiser(req),
  balance: () => treasuryUsdcBalance(),
  launch: (args) => launchCampaign(args),
  save: saveCampaign,
  listByOwner: listCampaignsByOwner,
  slugTaken: (slug) => campaignBySlug(slug) !== undefined,
  campaignState,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
