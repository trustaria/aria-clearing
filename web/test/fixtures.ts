import type { Campaign } from "../lib/campaigns";

export const lisbon: Campaign = {
  slug: "lisbon-family-trips",
  advertiser: "Tagus Family Travel",
  url: "https://example.com/tagus-family-travel",
  category: "travel",
  claims: [
    "Family packages for Lisbon and the Algarve, 3 to 10 nights.",
    "Children under 6 stay free in partner hotels.",
    "Free cancellation up to 48 hours before arrival.",
    "Every package includes airport transfers.",
  ],
};

export const planner: Campaign = {
  slug: "agency-project-planner",
  advertiser: "Brightline Projects",
  url: "https://example.com/brightline-projects",
  category: "software",
  claims: [
    "Project planning built for agencies of 5 to 50 people.",
    "Client portals with approvals and comments.",
    "Time tracking linked to budgets per project.",
    "Free for 14 days, no credit card required.",
  ],
};

export const campaigns = [lisbon, planner];

/** The fixtures with buyer keywords, for the keyword selector. */
export const keywordCampaigns: Campaign[] = [
  { ...lisbon, keywords: ["lisbon", "family trip", "algarve"] },
  { ...planner, keywords: ["project planning", "agency"] },
];
