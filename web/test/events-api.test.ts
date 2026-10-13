import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf } from "@aria-clearing/receipt";
import { createAria } from "@trustaria/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as events } from "../app/api/v1/events/route";
import { rememberServed } from "../lib/served";
import { signImpressionToken } from "../lib/serve/token";
import { eventStore } from "../lib/store";

const mocks = vi.hoisted(() => ({ sendFromRelayer: vi.fn() }));

vi.mock("@aria-clearing/ops", () => ({
  sendFromRelayer: mocks.sendFromRelayer,
  privyErrorCode: () => undefined,
}));

const KEY = "ak_test_9Fq2LmZ0tR7wYb3XcVn8Ke1PsAd4Gh6J";
const SERVED = "req_0123456789abcdefABCDEF";
const EVENTS_URL = "http://127.0.0.1:3000/api/v1/events";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-events-api-"));
  vi.stubEnv("ARIA_DATA_DIR", dir);
  vi.stubEnv("ARIA_EVENTS_FILE", "");
  vi.stubEnv("ARIA_API_KEY", KEY);
  vi.stubEnv("ARIA_PUBLISHER_ID", "");
  vi.stubEnv("PUBLISHER_ADDRESS", "0x1111111111111111111111111111111111111111");
  vi.stubEnv("NODE_ENV", "test");
  mocks.sendFromRelayer.mockReset();
  rememberServed({
    requestId: SERVED,
    slug: "lisbon-family-trips",
    campaignId: campaignIdOf("lisbon-family-trips"),
    rationale: "Children under 6 stay free in partner hotels.",
    claimRefs: [2],
    servedAt: Date.now(),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function post(body: unknown, key: string | null = KEY): Promise<Response> {
  return events(
    new Request(EVENTS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const click = { publisher_id: "pub_nova", type: "click", request_id: SERVED, occurred_at: new Date().toISOString() };

describe("POST /api/v1/events", () => {
  it("acknowledges a click signal with 200 and records nothing", async () => {
    const res = await post(click);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });
    expect(eventStore().listEvents()).toEqual([]);
    expect(mocks.sendFromRelayer).not.toHaveBeenCalled();
  });

  it("acknowledges an impression signal without billing it", async () => {
    const res = await post({
      publisher_id: "pub_nova",
      type: "impression",
      request_id: SERVED,
      impression_token: signImpressionToken(SERVED, "aria-dev-token-secret-not-for-production"),
      client_hints: { visible_ratio: 0.9, dwell_ms: 1500 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });
    expect(eventStore().listEvents()).toEqual([]);
  });

  it("answers 401 without a valid key", async () => {
    for (const key of [null, "ak_test_wrong"]) {
      const res = await post(click, key);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("invalid_key");
    }
  });

  it("answers 403 when publisher_id does not match the key", async () => {
    const res = await post({ ...click, publisher_id: "pub_other" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["an unknown type", { ...click, type: "conversion" }],
    ["no request_id", { ...click, request_id: undefined }],
    ["a malformed request_id", { ...click, request_id: "nope" }],
  ])("answers 400 to %s", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("resolves the SDK's events() as accepted", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => events(new Request(String(input), init)));
    const aria = createAria({ apiKey: KEY, publisherId: "pub_nova", baseUrl: "http://127.0.0.1:3000/api" });
    expect(await aria.events({ type: "click", requestId: SERVED })).toEqual({ status: 200, accepted: true });
  });
});
