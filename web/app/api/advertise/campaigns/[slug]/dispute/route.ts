import { campaignActions } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Disputes one of the campaign's events inside its window. */
export function POST(req: Request, { params }: { params: { slug: string } }) {
  return campaignActions.dispute(req, params.slug);
}
