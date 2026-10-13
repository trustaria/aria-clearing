import { ariaEventsHandler } from "@/lib/aria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The card's non-billing events (clicks on the card), forwarded to Aria's events API. */
export async function POST(req: Request) {
  return ariaEventsHandler()(req);
}
