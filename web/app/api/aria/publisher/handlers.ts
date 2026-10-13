import { getAddress, isAddress } from "viem";
import type { DashboardJson } from "../../../../lib/dashboard-data";
import { requireDemoKey } from "../../../../lib/demo-key";
import type { PublisherStore } from "../../../../lib/publisher";

type Deps = {
  store: PublisherStore;
  load: (address: string) => Promise<DashboardJson>;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** POST sets the publisher events are credited to (demo key required when set); GET returns its balances and recent events. */
export function createPublisherHandlers({ store, load }: Deps) {
  return {
    async POST(request: Request): Promise<Response> {
      const denied = requireDemoKey(request);
      if (denied) return denied;
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Body must be JSON" }, 400);
      }
      const address = (body as { address?: unknown } | null)?.address;
      if (typeof address !== "string" || !isAddress(address)) return json({ error: "Invalid address" }, 400);
      const checksummed = getAddress(address);
      store.set(checksummed);
      return json({ address: checksummed });
    },

    async GET(request: Request): Promise<Response> {
      const param = new URL(request.url).searchParams.get("address");
      if (param !== null && !isAddress(param)) return json({ error: "Invalid address" }, 400);
      const address = param !== null ? getAddress(param) : store.get();
      if (!address) return json({ error: "No publisher set" }, 404);
      try {
        return json(await load(address));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Chain read failed" }, 502);
      }
    },
  };
}
