export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Debug target for held cards' beacons: accepts the impression and records nothing. */
export async function POST() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
