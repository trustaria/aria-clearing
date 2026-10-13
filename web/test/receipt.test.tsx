import { campaignIdOf, claimsHash, formatClaims, rationaleHash } from "@aria-clearing/receipt";
import type { AdPayload } from "@trustaria/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SponsoredCard, { adForView, BEACON_SINK } from "../components/SponsoredCard";
import { buildCard, buildReceipt, receiptHref, receiptJson } from "../lib/receipt";
import { lisbon } from "./fixtures";

const requestId = "req_0123456789abcdefABCDEF";
const contract = "0x00000000000000000000000000000000000000aa";

function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("buildReceipt", () => {
  it("hashes the numbered claims and the normalized rationale", () => {
    const receipt = buildReceipt({
      chainId: 10143,
      contract,
      requestId,
      campaign: lisbon,
      rationale: "  Children under 6 stay free in partner hotels.  ",
    });
    expect(receipt).toEqual({
      chainId: 10143,
      contract,
      requestId,
      campaignId: campaignIdOf(lisbon.slug),
      claimsHash: claimsHash(formatClaims(lisbon.claims)),
      rationaleHash: rationaleHash("Children under 6 stay free in partner hotels."),
    });
  });

  it("escapes < in the embedded JSON", () => {
    expect(receiptJson({ requestId: "</script>" } as never)).not.toContain("<");
  });

  it("links the receipt page with the rationale and claims hashes", () => {
    const card = buildCard({ chainId: 10143, contract, requestId, campaign: lisbon, pick: { slug: lisbon.slug, rationale: "x", claimRefs: [1] } });
    expect(receiptHref(card)).toBe(`/receipt/${requestId}?h=${card.receipt.rationaleHash}&c=${card.receipt.claimsHash}`);
  });
});

describe("SponsoredCard", () => {
  const card = buildCard({
    chainId: 10143,
    contract,
    requestId,
    campaign: lisbon,
    pick: {
      slug: lisbon.slug,
      rationale: "Kids under 6 stay free & it's \"easy\" — Café <tested>.",
      claimRefs: [2],
    },
  });
  const origin = "https://aria.example.com";
  const ad: AdPayload = {
    requestId,
    offerId: lisbon.slug,
    creative: {
      advertiser: lisbon.advertiser,
      title: lisbon.advertiser,
      body: card.rationale,
      cta: "Learn more",
      clickUrl: `${origin}/api/aria/click/${requestId}`,
      logoUrl: null,
    },
    disclosure: { label: "Sponsored", whyUrl: `${origin}${receiptHref(card)}` },
    impressionToken: `${requestId}.mac`,
    beaconUrl: `${origin}/api/v1/beacon`,
    ttlMs: 600_000,
    servedAt: new Date().toISOString(),
    claimRefs: [2],
  };
  const html = renderToStaticMarkup(<SponsoredCard ad={ad} receipt={card.receipt} />);
  const tag = (pattern: RegExp) => html.match(pattern)?.[0] ?? "";

  it("embeds a receipt whose rationaleHash matches the rendered sentence", () => {
    const json = html.match(/<script type="application\/json" data-aria-receipt(?:="[^"]*")?>(.*?)<\/script>/)?.[1];
    expect(json).toBeDefined();
    const receipt = JSON.parse(json!);
    const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) => unescapeHtml(m[1]));
    expect(paragraphs).toContain(card.rationale);

    expect(receipt).toEqual({
      chainId: 10143,
      contract,
      requestId,
      campaignId: campaignIdOf(lisbon.slug),
      claimsHash: claimsHash(formatClaims(lisbon.claims)),
      rationaleHash: rationaleHash(card.rationale),
    });
  });

  it("renders the Sponsored disclosure and makes the card the tracked click through Aria's redirect", () => {
    expect(html).toContain("Sponsored");
    expect(html).toContain('data-aria-appearance="blockquote"');
    const cta = tag(/<a[^>]*data-aria-cta[^>]*>/);
    expect(cta).toContain(`href="${ad.creative.clickUrl}"`);
    expect(cta).toContain('target="_blank"');
    expect(cta).toContain("sponsored");
    expect(html).toContain("data-aria-click-area");
  });

  it("opens Why this ad? on the receipt page, with the hashes, in a new tab", () => {
    const why = tag(/<a[^>]*data-aria-why[^>]*>/);
    expect(why).toContain(`href="${origin}/receipt/${requestId}?h=${card.receipt.rationaleHash}&amp;c=${card.receipt.claimsHash}"`);
    expect(why).toContain('target="_blank"');
    expect(html).toContain("Why this ad?");
  });

  it("wraps the card in Nova's theme", () => {
    expect(html).toMatch(/^<div[^>]*class="nova-ad\b/);
  });

  it("sends a held card's beacon to the sink and leaves the rest of the ad untouched", () => {
    expect(adForView(ad, false)).toBe(ad);
    const held = adForView(ad, true);
    expect(held).toEqual({ ...ad, beaconUrl: BEACON_SINK });
    expect(ad.beaconUrl).toBe(`${origin}/api/v1/beacon`);
  });
});
