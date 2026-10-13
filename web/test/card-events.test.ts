import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sink } from "../app/api/aria/beacon-sink/route";
import { POST as cardEvents } from "../app/api/aria/card-events/route";
import { POST as ariaEvents } from "../app/api/v1/events/route";
import { eventStore } from "../lib/store";

const KEY = "ak_test_9Fq2LmZ0tR7wYb3XcVn8Ke1PsAd4Gh6J";
const SERVED = "req_0123456789abcdefABCDEF";
const EVENTS_URL = "http://127.0.0.1:3000/api/v1/events";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-card-events-"));
  vi.stubEnv("ARIA_DATA_DIR", dir);
  vi.stubEnv("ARIA_EVENTS_FILE", "");
  vi.stubEnv("ARIA_API_KEY", KEY);
  vi.stubEnv("ARIA_PUBLISHER_ID", "");
  vi.stubEnv("ARIA_BASE_URL", "");
  vi.stubEnv("PORT", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

/** Routes the forward to Aria's events API in process and returns what it received. */
function routeEvents(): { url: string; auth: string | null; body: Record<string, unknown> }[] {
  const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(String(input), init);
    calls.push({ url: req.url, auth: req.headers.get("authorization"), body: await req.clone().json() });
    if (req.url !== EVENTS_URL) return new Response(null, { status: 404 });
    return ariaEvents(req);
  });
  return calls;
}

function post(path: string, body: unknown, handler: (req: Request) => Promise<Response>): Promise<Response> {
  return handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/aria/card-events", () => {
  it("forwards the card's click to Aria's events API with the publisher key", async () => {
    const calls = routeEvents();
    const res = await post("/api/aria/card-events", { type: "click", requestId: SERVED, occurredAt: "2026-10-13T10:00:00.000Z" }, cardEvents);
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      {
        url: EVENTS_URL,
        auth: `Bearer ${KEY}`,
        body: { publisher_id: "pub_nova", type: "click", request_id: SERVED, occurred_at: "2026-10-13T10:00:00.000Z" },
      },
    ]);
    expect(eventStore().listEvents()).toEqual([]);
  });

  it("forwards to ARIA_BASE_URL when set", async () => {
    vi.stubEnv("ARIA_BASE_URL", "https://aria.example.com/api");
    const calls = routeEvents();
    const res = await post("/api/aria/card-events", { type: "click", requestId: SERVED }, cardEvents);
    expect(calls[0].url).toBe("https://aria.example.com/api/v1/events");
    expect(res.status).toBe(202);
  });

  it("answers 400 to a body that is not an event", async () => {
    const calls = routeEvents();
    expect((await post("/api/aria/card-events", { type: "view" }, cardEvents)).status).toBe(400);
    expect((await post("/api/aria/card-events", "{", cardEvents)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("POST /api/aria/beacon-sink", () => {
  it("answers 204 and records nothing", async () => {
    const res = await post(
      "/api/aria/beacon-sink",
      { type: "impression", request_id: SERVED, impression_token: "x.y", visible_ratio: 1, dwell_ms: 1000 },
      sink,
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(eventStore().listEvents()).toEqual([]);
  });
});
