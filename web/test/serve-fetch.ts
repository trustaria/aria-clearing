import { vi } from "vitest";
import { POST as serve } from "../app/api/v1/serve/route";

export const SERVE_URL = "http://127.0.0.1:3000/api/v1/serve";

type Handler = (req: Request) => Promise<Response>;

const realFetch = globalThis.fetch;

/**
 * Stubs global fetch so the SDK's serve call reaches the route handler in process (or `handler`);
 * every other URL goes to the real fetch. Returns the serve requests' JSON bodies.
 */
export function routeServeFetch(handler: Handler = serve): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== SERVE_URL) return realFetch(input, init);
    const req = new Request(url, init);
    bodies.push(await req.clone().json());
    return handler(req);
  });
  return bodies;
}
