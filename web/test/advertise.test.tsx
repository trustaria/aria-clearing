import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  approvedClaims,
  budgetCopy,
  budgetError,
  claimError,
  claimsError,
  cpcError,
  cpmError,
  dollars,
  normalizeClaim,
  parseDollars,
  previewSentence,
  validateProduct,
} from "../components/advertise/rules";
import Wizard, { LaunchPanel } from "../components/advertise/Wizard";
import { createHttpClient, createMockClient } from "../lib/advertise-client";

const product = {
  brand: "Crema Works",
  url: "https://crema.works/home-espresso",
  description: "Compact espresso machines for home kitchens, with a 15-bar pump.",
};

const claims = ["Compact espresso machines for kitchens.", "15-bar pump with a steam wand."];

describe("Step 1: product", () => {
  it("accepts a complete product", () => {
    expect(validateProduct(product)).toEqual({});
  });

  it("requires an https URL", () => {
    expect(validateProduct({ ...product, url: "http://crema.works" }).url).toBeDefined();
    expect(validateProduct({ ...product, url: "crema.works" }).url).toBeDefined();
    expect(validateProduct({ ...product, url: "https://crema.works" }).url).toBeUndefined();
  });

  it("limits brand to 2–40 and description to 40–1,500 characters", () => {
    expect(validateProduct({ ...product, brand: "C" }).brand).toBeDefined();
    expect(validateProduct({ ...product, brand: "C".repeat(41) }).brand).toBeDefined();
    expect(validateProduct({ ...product, brand: "Cw" }).brand).toBeUndefined();
    expect(validateProduct({ ...product, description: "x".repeat(39) }).description).toBeDefined();
    expect(validateProduct({ ...product, description: "x".repeat(1501) }).description).toBeDefined();
    expect(validateProduct({ ...product, description: "x".repeat(1500) }).description).toBeUndefined();
  });

  it("disables Draft my claims until every field is valid", () => {
    const html = (p: typeof product) =>
      renderToStaticMarkup(<Wizard client={createMockClient()} initialState={{ product: p }} onLaunched={() => {}} />);
    expect(html({ ...product, url: "http://crema.works" })).toMatch(/<button type="submit" disabled=""[^>]*>Draft my claims/);
    expect(html(product)).toMatch(/<button type="submit" class="[^"]*">Draft my claims/);
  });
});

describe("Step 2: claims", () => {
  it("normalizes numbering, whitespace and line breaks", () => {
    expect(normalizeClaim("1. Foo bar baz qux")).toBe("Foo bar baz qux");
    expect(normalizeClaim("  2)  Two-year\nwarranty   on every machine ")).toBe("Two-year warranty on every machine");
  });

  it("accepts 10–120 characters per claim", () => {
    expect(claimError("x".repeat(9))).not.toBeNull();
    expect(claimError("x".repeat(10))).toBeNull();
    expect(claimError("x".repeat(120))).toBeNull();
    expect(claimError("x".repeat(121))).not.toBeNull();
  });

  it("needs 1–5 valid claims and ignores empty rows", () => {
    expect(claimsError(["", "", ""])).not.toBeNull();
    expect(claimsError([claims[0], "", ""])).toBeNull();
    expect(claimsError(Array(6).fill(claims[0]))).not.toBeNull();
    expect(claimsError([claims[0], "x".repeat(121)])).not.toBeNull();
    expect(approvedClaims(["1. Foo bar baz qux", "", " Second claim here "])).toEqual(["Foo bar baz qux", "Second claim here"]);
  });

  it("joins claims 1–2 for the card preview", () => {
    expect(previewSentence([...claims, "Free shipping in the EU in 3 days."])).toBe(
      "Compact espresso machines for kitchens. 15-bar pump with a steam wand.",
    );
    expect(previewSentence(["No full stop here", ""])).toBe("No full stop here.");
  });
});

describe("Step 3: budget and bids", () => {
  it("reads the $5 card at default prices", () => {
    expect(budgetCopy(500, 25, 1000)).toBe("Pays for up to 20 clicks or 500 impressions.");
    expect(budgetCopy(200, 25, 1000)).toBe("Pays for up to 8 clicks or 200 impressions.");
    expect(budgetCopy(1000, 300, 5000)).toBe("Pays for up to 3 clicks or 200 impressions.");
    expect(budgetCopy(100, 100, 100_000)).toBe("Pays for up to 1 click or 1 impression.");
  });

  it("caps the budget at the test maximum with the low-funds copy", () => {
    expect(budgetError(500, 1840)).toBeNull();
    expect(budgetError(99, 1840)).not.toBeNull();
    expect(budgetError(null, 1840)).not.toBeNull();
    expect(budgetError(2000, 1840)).toBe(
      "Test funds are low: up to $18.40 is available right now. Lower your budget or try again later.",
    );
  });

  it("limits CPC to $0.01–$5.00 and CPM to $1–$50", () => {
    expect(cpcError(0)).not.toBeNull();
    expect(cpcError(1)).toBeNull();
    expect(cpcError(500)).toBeNull();
    expect(cpcError(501)).not.toBeNull();
    expect(cpmError(99)).not.toBeNull();
    expect(cpmError(100)).toBeNull();
    expect(cpmError(5000)).toBeNull();
    expect(cpmError(5001)).not.toBeNull();
  });

  it("parses typed dollars to cents", () => {
    expect(parseDollars("$5")).toBe(500);
    expect(parseDollars("0.25")).toBe(25);
    expect(parseDollars("12.3")).toBe(1230);
    expect(parseDollars("1,000.00")).toBe(100_000);
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
    expect(dollars(1840)).toBe("$18.40");
  });
});

describe("Step 4: launch", () => {
  const panel = (submitting: boolean) =>
    renderToStaticMarkup(
      <LaunchPanel budgetCents={500} submitting={submitting} progress={null} error={null} onBack={() => {}} onLaunch={() => {}} />,
    );

  it("disables Fund and launch while submitting", () => {
    expect(panel(true)).toMatch(/<button[^>]*disabled=""[^>]*>Fund and launch/);
    expect(panel(false)).not.toMatch(/<button[^>]*disabled=""[^>]*>Fund and launch/);
  });

  it("states test funding above the launch button", () => {
    const html = panel(false);
    expect(html).toContain("No card is charged.");
    expect(html.indexOf("No card is charged.")).toBeLessThan(html.indexOf("Fund and launch"));
    expect(html).toContain("Aria funds your $5.00 budget with test dollars");
  });

  it("shows progress lines in order", () => {
    const html = renderToStaticMarkup(
      <LaunchPanel
        budgetCents={500}
        submitting
        progress={{ saved: true, held: true, live: false }}
        error={null}
        onBack={() => {}}
        onLaunch={() => {}}
      />,
    );
    expect(html).toContain("Approved claims saved");
    expect(html).toContain("$5.00 held for your campaign");
    expect(html).toContain("Making it available to AI answers…");
  });
});

describe("advertise client", () => {
  it("sends the Privy token as a bearer header", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ campaigns: [], maxBudget: 1840 }), { status: 200 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    await expect(client.listCampaigns()).resolves.toEqual({ campaigns: [], maxBudget: 1840 });
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/advertise/campaigns");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("sends the signed-in email with the launch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ slug: "crema-works-a1b2", txHash: "0x1" }), { status: 200 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    await client.launch({
      ...product,
      claims,
      category: "food and drink",
      keywords: [],
      budgetCents: 500,
      cpcCents: 25,
      cpmCents: 1000,
      email: "ana@crema.works",
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ email: "ana@crema.works" });
  });

  it("falls back to manual claims when drafting fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 502 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    await expect(client.draft(product)).resolves.toEqual({ manual: true });
  });

  it("mock adds launched campaigns to the list", async () => {
    const client = createMockClient({ delayMs: 0 });
    const result = await client.launch({
      ...product,
      claims,
      category: "food and drink",
      keywords: [],
      budgetCents: 500,
      cpcCents: 25,
      cpmCents: 1000,
    });
    expect("slug" in result && result.slug).toMatch(/^crema-works-/);
    const { campaigns } = await client.listCampaigns();
    expect(campaigns[0]).toMatchObject({ advertiser: "Crema Works", budget: 500, status: "live" });
  });
});
