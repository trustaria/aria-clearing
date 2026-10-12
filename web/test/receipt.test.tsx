import { campaignIdOf, claimsHash, formatClaims, rationaleHash } from "@aria-clearing/receipt";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdCard from "../components/AdCard";
import { buildCard, buildReceipt, receiptJson } from "../lib/receipt";
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
});

describe("AdCard", () => {
  const card = buildCard({
    chainId: 10143,
    contract,
    requestId,
    campaign: lisbon,
    pick: {
      slug: lisbon.slug,
      rationale: "Kids under 6 stay free & it's \"easy\" — Café <tested>.",
      claimRefs: [2],
    },
  });
  const html = renderToStaticMarkup(<AdCard card={card} />);

  it("embeds a receipt whose rationaleHash matches the rendered text", () => {
    const json = html.match(/<script type="application\/json" data-aria-receipt(?:="[^"]*")?>(.*?)<\/script>/)?.[1];
    expect(json).toBeDefined();
    const receipt = JSON.parse(json!);
    const rendered = unescapeHtml(html.match(/<p[^>]*data-aria-rationale(?:="[^"]*")?[^>]*>(.*?)<\/p>/)![1]);

    expect(receipt.rationaleHash).toBe(rationaleHash(rendered));
    expect(receipt.claimsHash).toBe(claimsHash(formatClaims(lisbon.claims)));
    expect(receipt.campaignId).toBe(campaignIdOf(lisbon.slug));
    expect(receipt).toEqual({
      chainId: 10143,
      contract,
      requestId,
      campaignId: campaignIdOf(lisbon.slug),
      claimsHash: claimsHash(formatClaims(lisbon.claims)),
      rationaleHash: rationaleHash(rendered),
    });
  });

  it("leads with Sponsored and links the click route and the receipt page", () => {
    expect(html.indexOf("Sponsored")).toBeLessThan(html.indexOf("data-aria-rationale"));
    expect(html).toContain(`href="/api/aria/click/${requestId}"`);
    expect(html).toContain(
      `href="/receipt/${requestId}?h=${card.receipt.rationaleHash}&amp;c=${card.receipt.claimsHash}"`,
    );
    expect(html).toContain("Why this ad?");
  });
});
