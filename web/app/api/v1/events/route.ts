import { handleEvents } from "@/lib/serve/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aria's events API: acknowledges a publisher's non-billing signals. */
export async function POST(req: Request) {
  return handleEvents(req);
}
