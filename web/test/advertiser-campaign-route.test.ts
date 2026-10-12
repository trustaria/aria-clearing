import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf } from "@aria-clearing/receipt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/advertise/campaigns/[slug]/route";
import { saveCampaign, type StoredCampaign } from "../lib/campaign-store";

const mocks = vi.hoisted(() => ({
  verifyAdvertiser: vi.fn(),
  loadCampaignStats: vi.fn(),
}));

vi.mock("@/lib/advertiser-auth", () => ({ verifyAdvertiser: mocks.verifyAdvertiser }));
vi.mock("@/lib/advertiser-data", () => ({ loadCampaignStats: mocks.loadCampaignStats }));

const SLUG = "crema-works-a1b2";

function crema(): StoredCampaign {
  return {
    slug: SLUG,
    advertiser: "Crema Works",
    url: "https://crema.works",
    category: "food and drink",
    claims: ["Compact espresso machines for kitchens."],
    priceImpression: 10_000,
    priceClick: 250_000,
    budget: 5_000_000,
    keywords: [],
    campaignId: campaignIdOf(SLUG),
    ownerId: "did:privy:ana",
    ownerEmail: "ana@crema.works",
    txHash: "0xabc",
    createdBlock: 1234,
    createdAt: 1,
    status: "live",
  };
}

function get(slug: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/advertise/campaigns/${slug}`, { headers: { Authorization: "Bearer t" } }), {
    params: { slug },
  });
}

describe("GET /api/advertise/campaigns/[slug]", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-advertise-"));
    process.env.ARIA_CAMPAIGNS_FILE = join(dir, "campaigns.json");
    saveCampaign(crema());
    mocks.verifyAdvertiser.mockReset().mockResolvedValue({ userId: "did:privy:ana" });
    mocks.loadCampaignStats.mockReset().mockResolvedValue({ slug: SLUG, brand: "Crema Works" });
  });

  afterEach(() => {
    delete process.env.ARIA_CAMPAIGNS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the owner's stats", async () => {
    const res = await get(SLUG);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: SLUG, brand: "Crema Works" });
    expect(mocks.loadCampaignStats).toHaveBeenCalledWith(expect.objectContaining({ slug: SLUG, ownerId: "did:privy:ana" }));
  });

  it("answers 404 to another user, without reading stats", async () => {
    mocks.verifyAdvertiser.mockResolvedValue({ userId: "did:privy:bo" });
    const res = await get(SLUG);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Campaign not found." });
    expect(mocks.loadCampaignStats).not.toHaveBeenCalled();
  });

  it("answers 404 to an unknown slug", async () => {
    const res = await get("nope-0000");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Campaign not found." });
  });

  it("returns the verifier's response when the token is rejected", async () => {
    mocks.verifyAdvertiser.mockResolvedValue(Response.json({ error: "Sign in again." }, { status: 401 }));
    const res = await get(SLUG);
    expect(res.status).toBe(401);
    expect(mocks.loadCampaignStats).not.toHaveBeenCalled();
  });

  it("answers 502 when the chain cannot be read", async () => {
    mocks.loadCampaignStats.mockRejectedValue(new Error("rpc down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(SLUG);
    expect(res.status).toBe(502);
  });
});
