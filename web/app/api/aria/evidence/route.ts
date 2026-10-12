import { evidenceFor } from "@/lib/evidence";
import { eventStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Evidence for the settlement workflow: always 200, unknown ids omitted. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return Response.json(evidenceFor(body, eventStore()), { headers: { "Cache-Control": "no-store" } });
}
