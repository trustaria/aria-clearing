import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf } from "@aria-clearing/receipt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as disputePOST } from "../app/api/advertise/campaigns/[slug]/dispute/route";
import { POST as endPOST } from "../app/api/advertise/campaigns/[slug]/end/route";
import { GET } from "../app/api/advertise/campaigns/[slug]/route";
import { getStoredCampaign, saveCampaign, type StoredCampaign } from "../lib/campaign-store";

const mocks = vi.hoisted(() => ({
  verifyAdvertiser: vi.fn(),
  loadCampaignStats: vi.fn(),
  disputeEvent: vi.fn(),
  withdrawCampaign: vi.fn(),
}));

vi.mock("@/lib/advertiser-auth", () => ({ verifyAdvertiser: mocks.verifyAdvertiser }));
vi.mock("@/lib/advertiser-data", () => ({ loadCampaignStats: mocks.loadCampaignStats }));
vi.mock("@/lib/treasury", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/treasury")>()),
  disputeEvent: mocks.disputeEvent,
  withdrawCampaign: mocks.withdrawCampaign,
}));

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

describe("POST /api/advertise/campaigns/[slug]/dispute and /end", () => {
  let dir: string;
  const TX = `0x${"ab".repeat(32)}`;
  const EVENT = `0x${"0e".repeat(32)}`;

  function post(path: "dispute" | "end", body?: unknown) {
    return new Request(`http://localhost/api/advertise/campaigns/${SLUG}/${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer t" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-advertise-"));
    process.env.ARIA_CAMPAIGNS_FILE = join(dir, "campaigns.json");
    saveCampaign(crema());
    mocks.verifyAdvertiser.mockReset().mockResolvedValue({ userId: "did:privy:ana" });
    mocks.disputeEvent.mockReset().mockResolvedValue({ txHash: TX });
    mocks.withdrawCampaign.mockReset().mockResolvedValue({ amount: 3_770_000n, txHash: TX });
  });

  afterEach(() => {
    delete process.env.ARIA_CAMPAIGNS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it("disputes through the treasury with the record's campaign id", async () => {
    const res = await disputePOST(post("dispute", { eventId: EVENT }), { params: { slug: SLUG } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ txHash: TX });
    expect(mocks.disputeEvent).toHaveBeenCalledWith(campaignIdOf(SLUG), EVENT);
  });

  it("ends the campaign in the app's store", async () => {
    const res = await endPOST(post("end"), { params: { slug: SLUG } });
    expect(await res.json()).toEqual({ refunded: 377, txHash: TX });
    expect(getStoredCampaign(SLUG)).toMatchObject({ status: "ended", refunded: 3_770_000, endTxHash: TX });
  });

  it("answers 404 to another user", async () => {
    mocks.verifyAdvertiser.mockResolvedValue({ userId: "did:privy:bo" });
    expect((await endPOST(post("end"), { params: { slug: SLUG } })).status).toBe(404);
    expect((await disputePOST(post("dispute", { eventId: EVENT }), { params: { slug: SLUG } })).status).toBe(404);
    expect(mocks.withdrawCampaign).not.toHaveBeenCalled();
    expect(mocks.disputeEvent).not.toHaveBeenCalled();
  });
});
