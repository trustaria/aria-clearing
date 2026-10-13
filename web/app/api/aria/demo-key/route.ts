import { requireDemoKey } from "@/lib/demo-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 200 when the request may use the demo controls, else 403. */
export function GET(req: Request) {
  return requireDemoKey(req) ?? Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
