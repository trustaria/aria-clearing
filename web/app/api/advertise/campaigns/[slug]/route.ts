import { verifyAdvertiser } from "@/lib/advertiser-auth";
import { loadCampaignStats } from "@/lib/advertiser-data";
import { getStoredCampaign } from "@/lib/campaign-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stats for one of the signed-in advertiser's campaigns; any other slug is "not found". */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const auth = await verifyAdvertiser(req);
  if (auth instanceof Response) return auth;

  const record = getStoredCampaign(params.slug);
  if (!record || record.ownerId !== auth.userId) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }

  try {
    return Response.json(await loadCampaignStats(record), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[advertise] campaign stats failed", params.slug, err);
    return Response.json({ error: "We couldn't load your latest numbers. Retrying shortly." }, { status: 502 });
  }
}
