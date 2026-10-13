import { walletLaunch } from "../wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Checks the createCampaign transaction onchain and makes the pending campaign live. */
export function POST(req: Request) {
  return walletLaunch.confirm(req);
}
