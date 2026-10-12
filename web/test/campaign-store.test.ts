import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf } from "@aria-clearing/receipt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCampaignStore,
  getStoredCampaign,
  listCampaignsByOwner,
  listStoredCampaigns,
  saveCampaign,
  updateCampaign,
  type StoredCampaign,
} from "../lib/campaign-store";
import { allCampaigns, campaignBySlug, campaigns, describeCampaigns } from "../lib/campaigns";
import { advertiserNames } from "../lib/dashboard-data";
import { validatePick } from "../lib/pick";
import { stubPick } from "../lib/stub";

function crema(overrides: Partial<StoredCampaign> = {}): StoredCampaign {
  const slug = overrides.slug ?? "crema-works-a1b2";
  return {
    slug,
    advertiser: "Crema Works",
    url: "https://crema.works",
    category: "food and drink",
    claims: ["Espresso machines with a 15-bar pump.", "Free descaling kit with every machine."],
    priceImpression: 10_000,
    priceClick: 2_500_000,
    budget: 5_000_000,
    keywords: ["Espresso machine", "coffee grinder"],
    campaignId: campaignIdOf(slug),
    ownerId: "did:privy:ana",
    ownerEmail: "ana@crema.works",
    txHash: "0xabc",
    createdBlock: 1234,
    createdAt: 1,
    status: "live",
    ...overrides,
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-campaigns-"));
  process.env.ARIA_CAMPAIGNS_FILE = join(dir, ".data", "campaigns.json");
});

afterEach(() => {
  delete process.env.ARIA_CAMPAIGNS_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe("campaign store", () => {
  it("writes through and reloads from the file", () => {
    const file = join(dir, "other.json");
    const store = createCampaignStore(file);
    store.saveCampaign(crema());
    store.updateCampaign("crema-works-a1b2", { status: "ended", refunded: 4_000_000 });

    const reloaded = createCampaignStore(file);
    expect(reloaded.getStoredCampaign("crema-works-a1b2")).toMatchObject({ status: "ended", refunded: 4_000_000 });
    expect(JSON.parse(readFileSync(file, "utf8")).campaigns["crema-works-a1b2"].advertiser).toBe("Crema Works");
  });

  it("replaces a record saved twice under one slug", () => {
    saveCampaign(crema());
    saveCampaign(crema({ advertiser: "Crema Works Ltd" }));
    expect(listStoredCampaigns()).toHaveLength(1);
    expect(getStoredCampaign("crema-works-a1b2")?.advertiser).toBe("Crema Works Ltd");
  });

  it("keeps the slug on update and rejects unknown slugs", () => {
    saveCampaign(crema());
    expect(updateCampaign("crema-works-a1b2", { slug: "other" } as Partial<StoredCampaign>).slug).toBe(
      "crema-works-a1b2",
    );
    expect(() => updateCampaign("missing", { status: "ended" })).toThrow(/Unknown campaign/);
  });

  it("lists an owner's campaigns, newest first", () => {
    saveCampaign(crema({ slug: "crema-old", createdAt: 1 }));
    saveCampaign(crema({ slug: "crema-new", createdAt: 2 }));
    saveCampaign(crema({ slug: "someone-else", ownerId: "did:privy:bob", createdAt: 3 }));
    expect(listCampaignsByOwner("did:privy:ana").map((c) => c.slug)).toEqual(["crema-new", "crema-old"]);
  });
});

describe("merged campaign list", () => {
  it("puts seeded campaigns first, then live stored ones", () => {
    saveCampaign(crema());
    const slugs = allCampaigns().map((c) => c.slug);
    expect(slugs).toEqual([...campaigns.map((c) => c.slug), "crema-works-a1b2"]);
  });

  it("keeps the seeded campaign when a stored record reuses its slug", () => {
    saveCampaign(crema({ slug: campaigns[0].slug }));
    const list = allCampaigns();
    expect(list).toHaveLength(campaigns.length);
    expect(list[0].advertiser).toBe(campaigns[0].advertiser);
    expect(campaignBySlug(campaigns[0].slug)?.advertiser).toBe(campaigns[0].advertiser);
  });

  it("never picks ending or ended campaigns but still resolves them", () => {
    saveCampaign(crema({ slug: "crema-ending", status: "ending" }));
    saveCampaign(crema({ slug: "crema-ended", status: "ended" }));
    const slugs = allCampaigns().map((c) => c.slug);
    expect(slugs).not.toContain("crema-ending");
    expect(slugs).not.toContain("crema-ended");
    expect(campaignBySlug("crema-ended")?.url).toBe("https://crema.works");
    expect(campaignBySlug("crema-ending")?.url).toBe("https://crema.works");
    expect(validatePick(stubPick("What espresso machine should I buy?", allCampaigns()), allCampaigns())).toBeNull();
  });

  it("resolves only from the given list when one is passed", () => {
    saveCampaign(crema());
    expect(campaignBySlug("crema-works-a1b2", campaigns)).toBeUndefined();
  });
});

describe("stored campaigns downstream", () => {
  it("stub picks a stored campaign by its keyword", () => {
    saveCampaign(crema());
    const list = allCampaigns();
    const pick = validatePick(stubPick("What espresso machine should I buy?", list), list);
    expect(pick?.slug).toBe("crema-works-a1b2");
    expect(pick?.claimRefs.length).toBeGreaterThan(0);
  });

  it("pick prompt shows category and keywords", () => {
    const text = describeCampaigns([crema()]);
    expect(text).toContain("category: food and drink");
    expect(text).toContain("keywords: Espresso machine, coffee grinder");
  });

  it("pick prompt omits the keywords line when there are none", () => {
    const text = describeCampaigns([{ ...campaigns[0], keywords: undefined }]);
    expect(text).toContain(`category: ${campaigns[0].category}`);
    expect(text).not.toContain("keywords:");
  });

  it("publisher dashboard names stored brands, ended included", () => {
    saveCampaign(crema({ status: "ended" }));
    const names = advertiserNames();
    expect(names[campaignIdOf("crema-works-a1b2").toLowerCase()]).toBe("Crema Works");
    expect(names[campaignIdOf(campaigns[0].slug).toLowerCase()]).toBe(campaigns[0].advertiser);
  });
});
