import { formatClaims } from "@aria-clearing/receipt";
import campaignsJson from "../../contracts/script/campaigns.json";

export type Campaign = {
  slug: string;
  advertiser: string;
  url: string;
  category: string;
  claims: string[];
};

export const campaigns: Campaign[] = campaignsJson;

export function campaignBySlug(slug: string, list: Campaign[] = campaigns): Campaign | undefined {
  return list.find((campaign) => campaign.slug === slug);
}

/** Campaigns as the prompt shows them: slug, advertiser, then the numbered claims. */
export function describeCampaigns(list: Campaign[]): string {
  return list
    .map((c) => `slug: ${c.slug}\nadvertiser: ${c.advertiser}\nclaims:\n${formatClaims(c.claims)}`)
    .join("\n\n");
}
