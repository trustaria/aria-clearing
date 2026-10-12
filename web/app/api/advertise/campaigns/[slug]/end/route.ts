import { campaignActions } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends the campaign and returns its remaining budget to the treasury. */
export function POST(req: Request, { params }: { params: { slug: string } }) {
  return campaignActions.end(req, params.slug);
}
