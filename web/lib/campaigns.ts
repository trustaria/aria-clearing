import campaignsJson from "../../contracts/script/campaigns.json";
import { listStoredCampaigns } from "./campaign-store";

export type Campaign = {
  slug: string;
  advertiser: string;
  url: string;
  category: string;
  claims: string[];
  /** Buyer phrases that target the campaign. */
  keywords?: string[];
};

/** The seeded campaigns from contracts/script/campaigns.json. */
export const campaigns: Campaign[] = campaignsJson;

/** Seeded campaigns, then stored ones; a stored record never shadows a seeded slug. */
function merge(stored: Campaign[]): Campaign[] {
  const seeded = new Set(campaigns.map((c) => c.slug));
  return [...campaigns, ...stored.filter((c) => !seeded.has(c.slug))];
}

/** Every campaign that can be picked: seeded plus live console campaigns. */
export function allCampaigns(): Campaign[] {
  return merge(listStoredCampaigns().filter((c) => c.status === "live"));
}

/** Seeded plus every stored campaign, ended ones included, so old clicks and names still resolve. */
export function knownCampaigns(): Campaign[] {
  return merge(listStoredCampaigns());
}

/** Finds a campaign by slug in `list`, by default in every known campaign. */
export function campaignBySlug(slug: string, list?: Campaign[]): Campaign | undefined {
  return (list ?? knownCampaigns()).find((campaign) => campaign.slug === slug);
}
