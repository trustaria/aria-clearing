import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../components/Chat";
import { campaigns, type Campaign } from "../lib/campaigns";
import { isValidClaim } from "../lib/claims-draft";
import { validatePick } from "../lib/pick";
import { stubPick } from "../lib/stub";

const ALLOWED_CATEGORIES = ["travel", "software", "outdoor", "education", "food and drink", "home", "retail", "other"];
const ONCHAIN_SLUGS = ["lisbon-family-trips", "agency-project-planner", "alpine-hiking-gear", "language-coach"];

/** A console campaign that is live only on some machines. */
const cremaWorks: Campaign = {
  slug: "crema-works-test",
  advertiser: "Crema Works",
  url: "https://example.com/crema-works",
  category: "food and drink",
  claims: ["Compact espresso machines for home kitchens.", "Shipping is free across the EU and takes 3 days."],
  keywords: ["machine", "espresso", "machines", "kitchens"],
};

const CHIP_SLUGS = [
  "lisbon-family-trips",
  "city-e-bikes",
  "running-shoes",
  "note-taking-app",
  "kids-building-toys",
  null,
];

const PHRASINGS: [string, string][] = [
  ["Family trip to Lisbon next spring", "lisbon-family-trips"],
  ["Can you recommend a boutique hotel for a city break in Vienna?", "city-break-hotels"],
  ["Where to stay for a weekend away in Prague?", "city-break-hotels"],
  ["Looking for a hotel near the old town in Krakow", "city-break-hotels"],
  ["I need a note-taking app that works offline", "note-taking-app"],
  ["How can I keep meeting notes in sync between laptop and phone?", "note-taking-app"],
  ["Is there a notes app my team can edit together?", "note-taking-app"],
  ["Should I buy an electric bike or a scooter?", "city-e-bikes"],
  ["I want to cycle to work but there's a big hill on the way", "city-e-bikes"],
  ["Which ebike handles rain well?", "city-e-bikes"],
  ["I want to learn to code in the evenings, where do I start?", "online-coding-course"],
  ["Is a coding bootcamp worth it at 35?", "online-coding-course"],
  ["Where can I learn Python online?", "online-coding-course"],
  ["My mattress is 10 years old, what should I replace it with?", "foam-mattresses"],
  ["Is memory foam good for side sleepers?", "foam-mattresses"],
  ["We need a new bed for the guest room", "foam-mattresses"],
  ["I want to start running, which shoes do I need?", "running-shoes"],
  ["Do I need special trainers for trail running?", "running-shoes"],
  ["Training for a marathon in April, what should I wear on my feet?", "running-shoes"],
  ["Is a meal kit worth it for a busy couple?", "meal-kit-delivery"],
  ["I need easy weeknight dinner ideas for two", "meal-kit-delivery"],
  ["Which recipe box has vegetarian options?", "meal-kit-delivery"],
  ["Which wireless headphones are good for long flights?", "wireless-headphones"],
  ["Looking for noise-cancelling earbuds for the office", "wireless-headphones"],
  ["Are bluetooth headphones OK for working out?", "wireless-headphones"],
  ["What are good STEM toys for a 6-year-old?", "kids-building-toys"],
  ["Looking for toys for a 5-year-old who likes building", "kids-building-toys"],
  ["Are building blocks a good birthday gift for my nephew?", "kids-building-toys"],
  ["Which houseplants survive in a dark flat?", "indoor-plant-delivery"],
  ["Can I get an indoor plant delivered to my office in Berlin?", "indoor-plant-delivery"],
  ["What's a pet-safe plant for a bedroom?", "indoor-plant-delivery"],
];

const NON_COMMERCIAL = [
  "Why is the sky blue?",
  "How do plants photosynthesize?",
  "How does Bluetooth pairing work?",
  "Who won the 1998 World Cup?",
  "Explain recursion with an example",
  "Why do I wake up tired?",
  "What's the capital of Australia?",
];

function pickedSlug(question: string, list: Campaign[] = campaigns): string | null {
  return validatePick(stubPick(question, list), list)?.slug ?? null;
}

describe("seeded campaigns", () => {
  it("have unique slugs, example.com URLs, allowed categories and 4 to 6 keywords", () => {
    expect(new Set(campaigns.map((c) => c.slug)).size).toBe(campaigns.length);
    for (const c of campaigns) {
      expect(c.url).toMatch(/^https:\/\/example\.com\/[a-z0-9-]+$/);
      expect(ALLOWED_CATEGORIES).toContain(c.category);
      expect(c.keywords?.length).toBeGreaterThanOrEqual(4);
      expect(c.keywords?.length).toBeLessThanOrEqual(6);
    }
  });

  it("have exactly 4 claims of 10 to 120 characters each", () => {
    for (const c of campaigns) {
      expect(c.claims).toHaveLength(4);
      for (const claim of c.claims) expect(isValidClaim(claim), claim).toBe(true);
    }
  });

  it("keep the onchain campaigns first and in order", () => {
    expect(campaigns.slice(0, ONCHAIN_SLUGS.length).map((c) => c.slug)).toEqual(ONCHAIN_SLUGS);
  });
});

describe("stubPick", () => {
  it("maps every suggestion chip to its campaign and the last one to none", () => {
    expect(EXAMPLES).toHaveLength(CHIP_SLUGS.length);
    EXAMPLES.forEach((question, i) => expect(pickedSlug(question), question).toBe(CHIP_SLUGS[i]));
  });

  it("maps the chips the same way when a console campaign is live", () => {
    const withConsole = [...campaigns, cremaWorks];
    EXAMPLES.forEach((question, i) => expect(pickedSlug(question, withConsole), question).toBe(CHIP_SLUGS[i]));
  });

  it.each(PHRASINGS)("picks for %s", (question, slug) => {
    expect(pickedSlug(question)).toBe(slug);
  });

  it.each(NON_COMMERCIAL)("picks nothing for %s", (question) => {
    expect(pickedSlug(question)).toBeNull();
  });

  it("prefers the campaign with more matching keywords", () => {
    expect(pickedSlug("Trail running shoes for a hike?")).toBe("running-shoes");
  });

  it("matches whole words only", () => {
    expect(pickedSlug("Who is the hotelier in that film?")).toBeNull();
  });

  it("builds the rationale only from the cited claims", () => {
    const lisbon = campaigns[0];
    const pick = validatePick(stubPick("Family trip to Lisbon next spring", campaigns), campaigns)!;
    expect(pick.claimRefs.length).toBeGreaterThan(0);
    expect(pick.rationale).toBe(pick.claimRefs.map((n) => lisbon.claims[n - 1]).join(" "));
  });
});
