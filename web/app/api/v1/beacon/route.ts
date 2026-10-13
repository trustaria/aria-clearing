import { beaconResponse, handleBeacon } from "@/lib/serve/beacon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The browser's viewability beacon, authenticated by the ad's signed impression token. */
export async function POST(req: Request) {
  return handleBeacon(req);
}

export function OPTIONS() {
  return beaconResponse(204);
}
