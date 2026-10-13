import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdCreative, AdPayload, ServeResult } from "@trustaria/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as serve } from "../app/api/v1/serve/route";
import { adToPick, ariaBaseUrl, ariaClient, ariaTimeoutMs } from "../lib/aria";
import { allCampaigns } from "../lib/campaigns";
import { buildCard, chainConfig } from "../lib/receipt";
import { getServed } from "../lib/served";
import { campaigns, lisbon } from "./fixtures";

const KEY = "ak_test_9Fq2LmZ0tR7wYb3XcVn8Ke1PsAd4Gh6J";

function served(ad: Omit<Partial<AdPayload>, "creative"> & { creative?: Partial<AdCreative> }): ServeResult {
  return {
    requestId: "req_0123456789abcdefABCDEF",
    ad: {
      requestId: "req_0123456789abcdefABCDEF",
      impressionToken: "imp_x",
      ttlMs: 600000,
      disclosure: { label: "Sponsored", whyUrl: "https://aria.example.com/receipt/x" },
      offerId: lisbon.slug,
      claimRefs: [4],
      ...ad,
      creative: {
        advertiser: lisbon.advertiser,
        title: lisbon.advertiser,
        body: "Every package includes airport transfers.",
        cta: "Learn more",
        clickUrl: "https://aria.example.com/api/aria/click/x",
        ...ad.creative,
      },
    },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-client-"));
  vi.stubEnv("ARIA_DATA_DIR", dir);
  vi.stubEnv("ARIA_EVENTS_FILE", "");
  vi.stubEnv("ARIA_CAMPAIGNS_FILE", "");
  vi.stubEnv("ARIA_API_KEY", KEY);
  vi.stubEnv("ARIA_PUBLISHER_ID", "");
  vi.stubEnv("ARIA_BASE_URL", "");
  vi.stubEnv("ARIA_PUBLIC_URL", "");
  vi.stubEnv("ARIA_SERVE_TIMEOUT_MS", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("PORT", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("Aria client settings", () => {
  it("calls the same server by default", () => {
    expect(ariaBaseUrl()).toBe("http://127.0.0.1:3000/api");
    vi.stubEnv("PORT", "3500");
    expect(ariaBaseUrl()).toBe("http://127.0.0.1:3500/api");
  });

  it("uses ARIA_BASE_URL when set", () => {
    vi.stubEnv("ARIA_BASE_URL", "https://aria.example.com/api");
    expect(ariaBaseUrl()).toBe("https://aria.example.com/api");
  });

  it("defaults the serve budget to 6000 ms and reads ARIA_SERVE_TIMEOUT_MS", () => {
    expect(ariaTimeoutMs()).toBe(6000);
    vi.stubEnv("ARIA_SERVE_TIMEOUT_MS", "2500");
    expect(ariaTimeoutMs()).toBe(2500);
    vi.stubEnv("ARIA_SERVE_TIMEOUT_MS", "soon");
    expect(ariaTimeoutMs()).toBe(6000);
  });
});

describe("adToPick", () => {
  it("maps offerId, body and claimRefs to a validated pick", () => {
    expect(adToPick(served({}), campaigns)).toEqual({
      slug: lisbon.slug,
      rationale: "Every package includes airport transfers.",
      claimRefs: [4],
    });
  });

  it("is null for a no-fill", () => {
    expect(adToPick({ ad: null, reason: "not_monetizable" }, campaigns)).toBeNull();
  });

  it.each([
    ["an unknown offer", served({ offerId: "nope" })],
    ["no offer id", served({ offerId: undefined })],
    ["no claim refs", served({ claimRefs: undefined })],
    ["out-of-range claim refs", served({ claimRefs: [9] })],
    ["an empty body", served({ creative: { body: "" } })],
    ["an over-long body", served({ creative: { body: "x".repeat(400) } })],
  ])("is null for %s", (_name, result) => {
    expect(adToPick(result, campaigns)).toBeNull();
  });
});

describe("serve through @trustaria/core", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url !== "http://127.0.0.1:3000/api/v1/serve") throw new Error(`unexpected fetch ${url}`);
      return serve(new Request(url, init));
    });
  });

  it("serves an ad whose Nova card hashes the sentence the serve API recorded", async () => {
    const result = await ariaClient().serve({ prompt: "Family trip to Lisbon next spring" });
    expect(result.ad).not.toBeNull();
    const pick = adToPick(result, allCampaigns());
    expect(pick?.slug).toBe("lisbon-family-trips");

    const campaign = allCampaigns().find((c) => c.slug === pick!.slug)!;
    const card = buildCard({ ...chainConfig(), requestId: result.requestId!, campaign, pick: pick! });
    const record = getServed(result.requestId!);
    expect(record).toMatchObject({ slug: card.slug, rationale: card.rationale, claimRefs: card.claimRefs });
  });

  it("resolves a config no-fill on a wrong key, never throwing", async () => {
    const client = ariaClient();
    vi.stubEnv("ARIA_API_KEY", "ak_test_other0000000000000000000000000000");
    const result = await client.serve({ prompt: "Family trip to Lisbon next spring" });
    expect(result).toMatchObject({ ad: null });
    expect((await ariaClient().serve({ prompt: "Family trip to Lisbon next spring" })).ad).not.toBeNull();
  });

  it("resolves a timeout no-fill when serve is slower than the budget", async () => {
    vi.stubEnv("ARIA_SERVE_TIMEOUT_MS", "50");
    vi.stubGlobal("fetch", (_input: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    expect(await ariaClient().serve({ prompt: "Family trip to Lisbon next spring" })).toMatchObject({
      ad: null,
      reason: "timeout",
    });
  });
});
