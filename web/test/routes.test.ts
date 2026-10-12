import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ariaClearingAbi, campaignIdOf, eventIdOf, Kind } from "@aria-clearing/receipt";
import { decodeFunctionData } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as click } from "../app/api/aria/click/[requestId]/route";
import { POST as postEvent } from "../app/api/aria/events/route";
import { POST as postEvidence } from "../app/api/aria/evidence/route";
import { rememberServed } from "../lib/served";
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

const PUBLISHER = "0x1111111111111111111111111111111111111111";
const SERVED = "req_0123456789abcdefABCDEF";
const UNSERVED = "req_zzzzzzzzzzzzzzzzzzzzzz";
const TX = `0x${"ab".repeat(32)}`;

function post(body: unknown): Promise<Response> {
  return postEvent(
    new Request("http://localhost/api/aria/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const viewed = { requestId: SERVED, kind: "impression", viewMs: 1200, visibleRatio: 0.9 };

describe("aria routes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-routes-"));
    process.env.ARIA_EVENTS_FILE = join(dir, "events.json");
    mocks.sendFromRelayer.mockReset().mockResolvedValue(TX);
    mocks.publisher.mockReset().mockReturnValue(PUBLISHER);
    rememberServed({
      requestId: SERVED,
      slug: "lisbon-family-trips",
      campaignId: campaignIdOf("lisbon-family-trips"),
      rationale: "Children under 6 stay free in partner hotels.",
      claimRefs: [2],
      servedAt: 1,
    });
  });

  afterEach(() => {
    delete process.env.ARIA_EVENTS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  describe("POST /api/aria/events", () => {
    it("logs an impression for a served card", async () => {
      const res = await post(viewed);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ eventId: eventIdOf(SERVED, Kind.Impression), txHash: TX });

      expect(mocks.sendFromRelayer).toHaveBeenCalledTimes(1);
      const tx = mocks.sendFromRelayer.mock.calls[0][0];
      expect(tx.gasLimit).toBe(300_000);
      expect(decodeFunctionData({ abi: ariaClearingAbi, data: tx.data })).toEqual({
        functionName: "logEvent",
        args: [
          SERVED,
          campaignIdOf("lisbon-family-trips"),
          PUBLISHER,
          Kind.Impression,
          "Children under 6 stay free in partner hotels.",
          [2],
        ],
      });

      const stored = eventStore().getEvent(eventIdOf(SERVED, Kind.Impression));
      expect(stored).toMatchObject({ status: "logged", txHash: TX, forged: false });
      expect(stored?.evidence).toMatchObject({ viewMs: 1200, visibleRatio: 0.9, clickRedirected: false });
    });

    it("returns 404 for a requestId that was never served", async () => {
      expect((await post({ ...viewed, requestId: UNSERVED })).status).toBe(404);
      expect((await post({ ...viewed, requestId: "not-a-request-id" })).status).toBe(404);
      expect(mocks.sendFromRelayer).not.toHaveBeenCalled();
    });

    it("returns 409 when no publisher address is known", async () => {
      mocks.publisher.mockReturnValue(undefined);
      const res = await post(viewed);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/publisher/i);
      expect(mocks.sendFromRelayer).not.toHaveBeenCalled();
    });

    it("rejects malformed bodies", async () => {
      expect((await post({ ...viewed, kind: "click" })).status).toBe(400);
      expect((await post({ ...viewed, viewMs: -1 })).status).toBe(400);
      expect((await post({ ...viewed, visibleRatio: 1.5 })).status).toBe(400);
      expect((await post({ kind: "impression" })).status).toBe(400);
    });

    it("sends one tx for duplicate and concurrent posts", async () => {
      const [a, b] = await Promise.all([post(viewed), post(viewed)]);
      const c = await post({ ...viewed, viewMs: 5000 });
      expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
      expect((await c.json()).duplicate).toBe(true);
      expect(mocks.sendFromRelayer).toHaveBeenCalledTimes(1);
      expect(eventStore().getEvent(eventIdOf(SERVED, Kind.Impression))?.evidence.viewMs).toBe(1200);
    });

    it("reports a relayer failure without throwing and allows a retry", async () => {
      mocks.sendFromRelayer.mockRejectedValueOnce(new Error("broadcast failed"));
      const failed = await post(viewed);
      expect(failed.status).toBe(502);
      expect(await failed.json()).toMatchObject({ status: "failed", error: "broadcast failed" });

      const retry = await post(viewed);
      expect(retry.status).toBe(200);
      expect(mocks.sendFromRelayer).toHaveBeenCalledTimes(2);
    });
  });

  describe("GET /api/aria/click/:requestId", () => {
    const get = (requestId: string) =>
      click(new Request(`http://localhost/api/aria/click/${requestId}`), { params: { requestId } });

    it("marks the click redirected, logs it and redirects to the campaign", async () => {
      const res = await get(SERVED);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("https://example.com/tagus-family-travel");

      const stored = eventStore().getEvent(eventIdOf(SERVED, Kind.Click));
      expect(stored?.kind).toBe("click");
      expect(stored?.evidence.clickRedirected).toBe(true);
      await vi.waitFor(() => expect(eventStore().getEvent(eventIdOf(SERVED, Kind.Click))?.status).toBe("logged"));
      const { args } = decodeFunctionData({ abi: ariaClearingAbi, data: mocks.sendFromRelayer.mock.calls[0][0].data });
      expect(args?.[3]).toBe(Kind.Click);
    });

    it("redirects even when logging fails or no publisher is known", async () => {
      mocks.sendFromRelayer.mockRejectedValue(new Error("policy_violation"));
      expect((await get(SERVED)).status).toBe(302);
      mocks.publisher.mockReturnValue(undefined);
      expect((await get(SERVED)).status).toBe(302);
    });

    it("returns 404 for an unknown requestId", async () => {
      expect((await get(UNSERVED)).status).toBe(404);
    });
  });

  describe("POST /api/aria/evidence", () => {
    it("always answers 200 with evidence for logged ids", async () => {
      await post(viewed);
      const res = await postEvidence(
        new Request("http://localhost/api/aria/evidence", {
          method: "POST",
          body: JSON.stringify({ ids: [eventIdOf(SERVED, Kind.Impression), eventIdOf(UNSERVED, Kind.Impression)] }),
        }),
      );
      expect(res.status).toBe(200);
      const { evidence } = await res.json();
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({ kind: "impression", viewMs: 1200, visibleRatio: 0.9 });

      const bad = await postEvidence(new Request("http://localhost/api/aria/evidence", { method: "POST", body: "{" }));
      expect(bad.status).toBe(200);
      expect(await bad.json()).toEqual({ evidence: [] });
    });
  });
});
