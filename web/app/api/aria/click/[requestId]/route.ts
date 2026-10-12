import { campaignBySlug } from "@/lib/campaigns";
import { submitEvent } from "@/lib/events";
import { getServed } from "@/lib/served";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marks the click as redirected, logs it onchain in the background, and redirects to the advertiser. */
export async function GET(_req: Request, { params }: { params: { requestId: string } }) {
  const pick = getServed(params.requestId);
  const campaign = pick && campaignBySlug(pick.slug);
  if (!pick || !campaign) return Response.json({ error: "Unknown requestId" }, { status: 404 });

  try {
    const result = submitEvent({ requestId: pick.requestId, kind: "click", evidence: { clickRedirected: true } });
    if (!result.ok) console.warn(`click ${pick.requestId} not logged: ${result.error}`);
  } catch (err) {
    console.warn(`click ${pick.requestId} not recorded: ${(err as Error).message}`);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: campaign.url, "Cache-Control": "no-store" },
  });
}
