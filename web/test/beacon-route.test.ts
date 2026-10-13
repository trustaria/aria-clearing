import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ariaClearingAbi, campaignIdOf, eventIdOf, Kind } from "@aria-clearing/receipt";
import { decodeFunctionData } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postEvidence } from "../app/api/aria/evidence/route";
import { OPTIONS, POST as beacon } from "../app/api/v1/beacon/route";
import { rememberServed } from "../lib/served";
import { signImpressionToken } from "../lib/serve/token";
import { eventStore } from "../lib/store";

const mocks = vi.hoisted(() => ({
  sendFromRelayer: vi.fn(),
  publisher: vi.fn(),
}));

vi.mock("@aria-clearing/ops", () => ({
  sendFromRelayer: mocks.sendFromRelayer,
  privyErrorCode: () => undefined,
}));

vi.mock("@/lib/chain", () => ({
  clearingAddress: () => "0x00000000000000000000000000000000000000aa",
  receiptStatus: async () => "success",
}));

vi.mock("@/lib/publisher", () => ({
  publisherStore: { get: mocks.publisher, set: vi.fn() },
}));

const SECRET = "beacon-test-secret";
const PUBLISHER = "0x1111111111111111111111111111111111111111";
const SERVED = "req_0123456789abcdefABCDEF";
const UNSERVED = "req_zzzzzzzzzzzzzzzzzzzzzz";
const TX = `0x${"ab".repeat(32)}`;
const SERVED_AT = Date.parse("2026-10-13T10:00:00.000Z");
const NOW = SERVED_AT + 30_000;
const IMPRESSION = eventIdOf(SERVED, Kind.Impression);

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "impression",
    request_id: SERVED,
    impression_token: signImpressionToken(SERVED, SECRET),
    occurred_at: new Date(NOW - 1000).toISOString(),
    visible_ratio: 0.85,
    dwell_ms: 1200,
    ...overrides,
  };
}

function send(payload: unknown, contentType = "text/plain;charset=UTF-8"): Promise<Response> {
  return beacon(
    new Request("http://localhost/api/v1/beacon", {
      method: "POST",
      headers: { "content-type": contentType, origin: "https://nova.example.com" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

function expectCors(res: Response) {
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
}

async function expectEmpty(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(await res.text()).toBe("");
  expectCors(res);
}

describe("POST /api/v1/beacon", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-beacon-"));
    vi.stubEnv("ARIA_EVENTS_FILE", join(dir, "events.json"));
    vi.stubEnv("ARIA_TOKEN_SECRET", SECRET);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mocks.sendFromRelayer.mockReset().mockResolvedValue(TX);
    mocks.publisher.mockReset().mockReturnValue(PUBLISHER);
    rememberServed({
      requestId: SERVED,
      slug: "lisbon-family-trips",
      campaignId: campaignIdOf("lisbon-family-trips"),
      rationale: "Children under 6 stay free in partner hotels.",
      claimRefs: [2],
      servedAt: SERVED_AT,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts the SDK's text/plain beacon with 204 and logs the impression onchain", async () => {
    await expectEmpty(await send(body()), 204);

    const stored = eventStore().getEvent(IMPRESSION);
    expect(stored).toMatchObject({ kind: "impression", requestId: SERVED, publisher: PUBLISHER, forged: false });
    expect(stored?.evidence).toMatchObject({ viewMs: 1200, visibleRatio: 0.85, clickRedirected: false });
    await vi.waitFor(() => expect(eventStore().getEvent(IMPRESSION)?.status).toBe("logged"));

    const { functionName, args } = decodeFunctionData({ abi: ariaClearingAbi, data: mocks.sendFromRelayer.mock.calls[0][0].data });
    expect(functionName).toBe("logEvent");
    expect(args?.[0]).toBe(SERVED);
    expect(args?.[3]).toBe(Kind.Impression);
  });

  it("parses the body as JSON whatever the content type", async () => {
    await expectEmpty(await send(body(), "application/json"), 204);
    expect(eventStore().getEvent(IMPRESSION)).toBeDefined();
  });

  it("hands the logged evidence to the settlement workflow's evidence endpoint", async () => {
    await send(body());
    const res = await postEvidence(
      new Request("http://localhost/api/aria/evidence", { method: "POST", body: JSON.stringify({ ids: [IMPRESSION] }) }),
    );
    expect(await res.json()).toEqual({
      evidence: [
        {
          id: IMPRESSION,
          kind: "impression",
          viewMs: 1200,
          visibleRatio: 0.85,
          clickRedirected: false,
          firstSeenAt: new Date(NOW - 1000 - 1200).toISOString(),
        },
      ],
    });
  });

  it("answers a duplicate with 204 and sends one transaction", async () => {
    const [a, b] = await Promise.all([send(body()), send(body())]);
    const c = await send(body({ dwell_ms: 5000 }));
    for (const res of [a, b, c]) await expectEmpty(res, 204);
    expect(mocks.sendFromRelayer).toHaveBeenCalledTimes(1);
    expect(eventStore().getEvent(IMPRESSION)?.evidence.viewMs).toBe(1200);
  });

  describe("firstSeenAt", () => {
    const firstSeen = async (overrides: Record<string, unknown>) => {
      await send(body(overrides));
      return eventStore().getEvent(IMPRESSION)?.evidence.firstSeenAt;
    };

    it("is occurred_at minus dwell_ms", async () => {
      expect(await firstSeen({ occurred_at: new Date(NOW - 5000).toISOString(), dwell_ms: 2000 })).toBe(
        new Date(NOW - 7000).toISOString(),
      );
    });

    it("is clamped to the served time", async () => {
      expect(await firstSeen({ occurred_at: new Date(SERVED_AT - 60_000).toISOString() })).toBe(
        new Date(SERVED_AT).toISOString(),
      );
    });

    it("is clamped to now", async () => {
      expect(await firstSeen({ occurred_at: new Date(NOW + 60_000).toISOString(), dwell_ms: 1000 })).toBe(
        new Date(NOW).toISOString(),
      );
    });

    it("falls back to now minus dwell_ms without a valid occurred_at", async () => {
      expect(await firstSeen({ occurred_at: "yesterday", dwell_ms: 1500 })).toBe(new Date(NOW - 1500).toISOString());
    });

    it("falls back to now minus dwell_ms when occurred_at is absent", async () => {
      expect(await firstSeen({ occurred_at: undefined, dwell_ms: 2500 })).toBe(new Date(NOW - 2500).toISOString());
    });
  });

  it.each([
    ["not JSON", "{"],
    ["a JSON array", "[]"],
    ["an empty body", ""],
    ["another event type", body({ type: "click" })],
    ["no request_id", body({ request_id: undefined })],
    ["no impression_token", body({ impression_token: undefined })],
    ["visible_ratio above 1", body({ visible_ratio: 1.2 })],
    ["visible_ratio below 0", body({ visible_ratio: -0.1 })],
    ["visible_ratio as a string", body({ visible_ratio: "0.9" })],
    ["no visible_ratio", body({ visible_ratio: undefined })],
    ["a fractional dwell_ms", body({ dwell_ms: 1200.5 })],
    ["a negative dwell_ms", body({ dwell_ms: -1 })],
    ["no dwell_ms", body({ dwell_ms: undefined })],
  ])("answers 400 to %s", async (_name, payload) => {
    await expectEmpty(await send(payload), 400);
    expect(eventStore().getEvent(IMPRESSION)).toBeUndefined();
    expect(mocks.sendFromRelayer).not.toHaveBeenCalled();
  });

  it.each([
    ["a token signed with another secret", body({ impression_token: signImpressionToken(SERVED, "other-secret") })],
    ["a malformed token", body({ impression_token: "not-a-token" })],
    ["a token for another request id", body({ impression_token: signImpressionToken(UNSERVED, SECRET) })],
    [
      "a valid token for a request that was never served",
      body({ request_id: UNSERVED, impression_token: signImpressionToken(UNSERVED, SECRET) }),
    ],
  ])("answers 401 to %s", async (_name, payload) => {
    await expectEmpty(await send(payload), 401);
    expect(eventStore().listEvents()).toEqual([]);
    expect(mocks.sendFromRelayer).not.toHaveBeenCalled();
  });

  it("answers 503 without logging when no publisher address is known", async () => {
    mocks.publisher.mockReturnValue(undefined);
    await expectEmpty(await send(body()), 503);
    expect(mocks.sendFromRelayer).not.toHaveBeenCalled();
  });

  it("answers 503 in production without ARIA_TOKEN_SECRET", async () => {
    vi.stubEnv("ARIA_TOKEN_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    await expectEmpty(await send(body()), 503);
  });

  it("answers the CORS preflight with 204", async () => {
    const res = OPTIONS();
    await expectEmpty(res, 204);
  });
});
