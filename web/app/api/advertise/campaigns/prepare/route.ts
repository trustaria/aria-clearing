import { walletLaunch } from "../wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saves a pending wallet-funded campaign and returns the createCampaign call for the advertiser's wallet. */
export function POST(req: Request) {
  return walletLaunch.prepare(req);
}
