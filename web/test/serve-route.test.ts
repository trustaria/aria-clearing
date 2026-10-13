import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf } from "@aria-clearing/receipt";
import { fromWire } from "@trustaria/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as serve } from "../app/api/v1/serve/route";
import { isRequestId } from "../lib/request-id";
import { getServed } from "../lib/served";
import { DEV_API_KEY } from "../lib/serve/auth";
import { handleServe } from "../lib/serve/handler";
import type { Picker } from "../lib/serve/select";
import { signImpressionToken, verifyImpressionToken } from "../lib/serve/token";
import { keywordCampaigns, lisbon } from "./fixtures";

const KEY = "ak_test_9Fq2LmZ0tR7wYb3XcVn8Ke1PsAd4Gh6J";
const SECRET = "token-secret-for-tests";
const LISBON = "Family trip to Lisbon next spring";
const RAM = "What's the difference between RAM and storage?";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-serve-"));
  vi.stubEnv("ARIA_DATA_DIR", dir);
  vi.stubEnv("ARIA_EVENTS_FILE", "");
  vi.stubEnv("ARIA_CAMPAIGNS_FILE", "");
  vi.stubEnv("ARIA_API_KEY", KEY);
  vi.stubEnv("ARIA_TOKEN_SECRET", SECRET);
  vi.stubEnv("ARIA_PUBLISHER_ID", "");
  vi.stubEnv("ARIA_PUBLIC_URL", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

type Init = { body?: unknown; key?: string | null; headers?: Record<string, string>; url?: string };

function request({ body, key = KEY, headers = {}, url = "http://localhost:3500/api/v1/serve" }: Init = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body ?? { publisher_id: "pub_nova", prompt: LISBON }),
  });
}

async function call(init: Init = {}) {
  const res = await serve(request(init));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("POST /api/v1/serve auth and validation", () => {
  it.each([
    ["a missing key", null],
    ["a wrong key", "ak_test_wrongwrongwrongwrongwrongwrong00"],
    ["an empty bearer", ""],
  ])("answers 401 invalid_key for %s, with no request_id", async (_name, key) => {
    const { status, body } = await call({ key });
    expect(status).toBe(401);
    expect(body).toEqual({ error: { code: "invalid_key", message: expect.any(String) } });
  });

  it("answers 401 when ARIA_API_KEY is unset in production", async () => {
    vi.stubEnv("ARIA_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await call({ key: DEV_API_KEY })).status).toBe(401);
  });

  it("accepts the dev key when ARIA_API_KEY is unset outside production", async () => {
    vi.stubEnv("ARIA_API_KEY", "");
    const { status, body } = await call({ key: DEV_API_KEY });
    expect(status).toBe(200);
    expect(body.decision).toBe("served");
  });

  it("answers 403 forbidden with a request_id when the publisher does not match", async () => {
    const { status, body } = await call({ body: { publisher_id: "pub_other", prompt: LISBON } });
    expect(status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(isRequestId(body.error.request_id)).toBe(true);
  });

  it("matches ARIA_PUBLISHER_ID when set", async () => {
    vi.stubEnv("ARIA_PUBLISHER_ID", "pub_acme");
    expect((await call({ body: { publisher_id: "pub_nova", prompt: LISBON } })).status).toBe(403);
    expect((await call({ body: { publisher_id: "pub_acme", prompt: LISBON } })).status).toBe(200);
  });

  it.each([
    ["no prompt", { publisher_id: "pub_nova" }],
    ["a blank prompt", { publisher_id: "pub_nova", prompt: "   " }],
    ["a prompt over 4000 characters", { publisher_id: "pub_nova", prompt: "a".repeat(4001) }],
    ["a non-string prompt", { publisher_id: "pub_nova", prompt: 42 }],
    ["malformed JSON", "{"],
  ])("answers 400 bad_request for %s", async (_name, body) => {
    const res = await call({ body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(isRequestId(res.body.error.request_id)).toBe(true);
  });

  it("accepts a 4000-character prompt and ignores unknown fields and a large timeout hint", async () => {
    const prompt = `${LISBON} ${"a".repeat(4000 - LISBON.length - 1)}`;
    const { status } = await call({ body: { publisher_id: "pub_nova", prompt, timeout_hint_ms: 6000, extra: true } });
    expect(status).toBe(200);
  });
});

describe("POST /api/v1/serve served", () => {
  it("returns a served ad per the wire contract", async () => {
    const before = Date.now();
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.schema_version).toBe("1");
    expect(isRequestId(body.request_id)).toBe(true);
    expect(body.decision).toBe("served");
    expect(body).not.toHaveProperty("no_fill_reason");
    expect(Date.parse(body.served_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(body.timing_ms).toEqual({ total: expect.any(Number) });
    expect(body.labels).toEqual({ commercial_intent: "recommendation_seeking", derived: { monetizable: true } });

    const id = body.request_id;
    expect(body.ad).toMatchObject({
      offer_id: "lisbon-family-trips",
      creative: {
        title: expect.any(String),
        body: expect.any(String),
        cta: "Learn more",
        advertiser: expect.any(String),
        click_url: `http://localhost:3500/api/aria/click/${id}`,
        logo_url: null,
      },
      claim_refs: expect.any(Array),
      disclosure: { label: "Sponsored", why_url: `http://localhost:3500/receipt/${id}`, why_text: expect.any(String) },
      impression_token: signImpressionToken(id, SECRET),
      beacon_url: "http://localhost:3500/api/v1/beacon",
      ttl_ms: 600000,
      served_at: body.served_at,
    });
    expect(body.ad.creative.title).toBe(body.ad.creative.advertiser);
  });

  it("mints an impression token that verifies to the request id under ARIA_TOKEN_SECRET only", async () => {
    const { body } = await call();
    expect(verifyImpressionToken(body.ad.impression_token, SECRET)).toBe(body.request_id);
    expect(verifyImpressionToken(body.ad.impression_token, KEY)).toBeNull();
  });

  it("answers 503 unavailable when ARIA_TOKEN_SECRET is unset in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ARIA_TOKEN_SECRET", "");
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.error.code).toBe("unavailable");
  });

  it("records the served ad under the same request_id, as the clearing flow reads it", async () => {
    const { body } = await call();
    const served = getServed(body.request_id);
    expect(served).toMatchObject({
      requestId: body.request_id,
      slug: "lisbon-family-trips",
      campaignId: campaignIdOf("lisbon-family-trips"),
      rationale: body.ad.creative.body,
      claimRefs: body.ad.claim_refs,
    });
  });

  it("parses with the SDK's fromWire, claim refs included", async () => {
    const { body } = await call();
    const result = fromWire(body, 5);
    expect(result.ad).not.toBeNull();
    expect(result.requestId).toBe(body.request_id);
    expect(result.ad).toMatchObject({
      offerId: "lisbon-family-trips",
      claimRefs: body.ad.claim_refs,
      impressionToken: body.ad.impression_token,
      creative: { body: body.ad.creative.body, clickUrl: body.ad.creative.click_url },
      disclosure: { whyUrl: body.ad.disclosure.why_url },
    });
    expect(result.labels?.derived.monetizable).toBe(true);
  });

  it("mints a new request_id per request", async () => {
    const a = await call();
    const b = await call();
    expect(a.body.request_id).not.toBe(b.body.request_id);
  });

  it("builds absolute URLs from ARIA_PUBLIC_URL when set", async () => {
    vi.stubEnv("ARIA_PUBLIC_URL", "https://aria.example.com/");
    const { body } = await call();
    expect(body.ad.creative.click_url).toBe(`https://aria.example.com/api/aria/click/${body.request_id}`);
    expect(body.ad.disclosure.why_url).toBe(`https://aria.example.com/receipt/${body.request_id}`);
  });

  it("builds absolute URLs from forwarded headers when ARIA_PUBLIC_URL is unset", async () => {
    const { body } = await call({ headers: { "x-forwarded-proto": "https", "x-forwarded-host": "nova.example.com" } });
    expect(body.ad.creative.click_url).toBe(`https://nova.example.com/api/aria/click/${body.request_id}`);
  });
});

describe("POST /api/v1/serve no-fill", () => {
  it("is not_monetizable with labels and no ad when nothing matches", async () => {
    const { status, body } = await call({ body: { publisher_id: "pub_nova", prompt: RAM } });
    expect(status).toBe(200);
    expect(body).toEqual({
      schema_version: "1",
      request_id: expect.any(String),
      decision: "no_fill",
      no_fill_reason: "not_monetizable",
      labels: { commercial_intent: "none", derived: { monetizable: false } },
      timing_ms: { total: expect.any(Number) },
      served_at: expect.any(String),
    });
    expect(getServed(body.request_id)).toBeUndefined();
    expect(fromWire(body, 1)).toMatchObject({ ad: null, reason: "not_monetizable" });
  });
});

describe("handleServe with a model picker", () => {
  const PICK = { intent: "commercial", slug: lisbon.slug, claimRefs: [2, 4], sentence: "Kids under 6 stay free and transfers are included." };
  const run = (picker: Picker | null, prompt = LISBON) =>
    handleServe(request({ body: { publisher_id: "pub_nova", prompt, context: "x".repeat(3000) } }), {
      picker,
      campaigns: keywordCampaigns,
    });

  it("serves the model's pick with its sentence and claim refs", async () => {
    const body = (await (await run(async () => PICK)).json()) as Record<string, any>;
    expect(body.ad).toMatchObject({
      offer_id: lisbon.slug,
      creative: { title: lisbon.advertiser, advertiser: lisbon.advertiser, body: PICK.sentence },
      claim_refs: [2, 4],
    });
  });

  it("clamps the context to 2000 characters before selection", async () => {
    const picker = vi.fn<Picker>(async () => PICK);
    await run(picker);
    expect(picker.mock.calls[0][0].context).toHaveLength(2000);
  });

  it("is no_candidates when the model's pick fails validation", async () => {
    const body = (await (await run(async () => ({ ...PICK, claimRefs: [9] }))).json()) as Record<string, any>;
    expect(body).toMatchObject({ decision: "no_fill", no_fill_reason: "no_candidates" });
    expect(body.labels).toEqual({ commercial_intent: "recommendation_seeking", derived: { monetizable: true } });
  });

  it("still serves through the keyword selector when the model fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = (await (
      await run(async () => {
        throw new Error("timeout");
      })
    ).json()) as Record<string, any>;
    expect(body).toMatchObject({ decision: "served", ad: { offer_id: lisbon.slug } });
  });

  it("is no_candidates when no campaign is live", async () => {
    const res = await handleServe(request(), { picker: null, campaigns: [] });
    expect(await res.json()).toMatchObject({ decision: "no_fill", no_fill_reason: "no_candidates" });
  });
});
