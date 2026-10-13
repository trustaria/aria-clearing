import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  LAUNCH_FAILED,
  SITE_DRAFT_FAILED,
  SITE_DRAFTED,
  SITE_UNREADABLE,
  applySiteDraft,
  approvedClaims,
  budgetCopy,
  budgetError,
  claimError,
  claimsError,
  cpcError,
  cpmError,
  dollars,
  launchErrorCopy,
  normalizeClaim,
  parseDollars,
  previewSentence,
  siteFailedCopy,
  validateProduct,
} from "../components/advertise/rules";
import FundingPanel, { type FundingPanelProps } from "../components/advertise/FundingPanel";
import {
  APPROVE_FAILED,
  CONFIRM_PENDING,
  ESCROW_FAILED,
  IDLE_LAUNCH,
  fundingChecks,
  reduceLaunch,
  runWalletLaunch,
  type LaunchEvent,
  type LaunchOps,
} from "../components/advertise/funding";
import Wizard, { LaunchPanel } from "../components/advertise/Wizard";
import { createHttpClient, createMockClient, type Prepared } from "../lib/advertise-client";

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

describe("launch errors", () => {
  it("shows the server's message, else the generic failure", () => {
    const limit = "This account has used its 2 test launches. Thanks for trying Aria!";
    expect(launchErrorCopy(limit)).toBe(limit);
    expect(launchErrorCopy("")).toBe(LAUNCH_FAILED);
  });

  it("passes a launch-limit refusal through the client", async () => {
    const error = "Test campaigns can spend up to $5.00 each. Lower your budget to launch.";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error, field: "budgetCents", code: "limit" }), { status: 400 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    const result = await client.launch({ ...product, claims, category: "food and drink", keywords: [], budgetCents: 900, cpcCents: 25, cpmCents: 1000 });
    expect("error" in result && launchErrorCopy(result.error)).toBe(error);
  });

  it("sends this tab's demo key with advertiser requests", async () => {
    const values = new Map([["aria.demoKey", "k3y"]]);
    vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: vi.fn(), removeItem: vi.fn() } });
    try {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ campaigns: [], maxBudget: 0 }), { status: 200 }));
      await createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch).listCampaigns();
      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)["x-aria-demo-key"]).toBe("k3y");
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("drafts from a website with the URL only", async () => {
    const draft = { brand: "Crema Works", description: product.description, claims, category: "food and drink", keywords: [] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(draft), { status: 200 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    await expect(client.draftFromSite({ url: "https://crema.works" })).resolves.toEqual(draft);
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/advertise/draft");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://crema.works" });
  });

  it("keeps the manual reason from a website draft and fails closed on bad replies", async () => {
    const reply = (body: unknown, status = 200) =>
      createHttpClient(async () => "tok", (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);
    const url = { url: "https://crema.works" };
    await expect(reply({ manual: true, reason: "empty" }).draftFromSite(url)).resolves.toEqual({ manual: true, reason: "empty" });
    await expect(reply({ claims }).draftFromSite(url)).resolves.toEqual({ manual: true, reason: "draft_failed" });
    await expect(reply({ error: "Sign in to continue." }, 401).draftFromSite(url)).resolves.toEqual({
      manual: true,
      reason: "draft_failed",
    });
  });

  it("mock drafts from a website, or can't read a manual. host", async () => {
    const client = createMockClient({ delayMs: 0 });
    const result = await client.draftFromSite({ url: "https://crema.works" });
    expect(result).toMatchObject({ brand: "Crema Works", category: "food and drink" });
    await expect(client.draftFromSite({ url: "https://manual.example" })).resolves.toEqual({
      manual: true,
      reason: "unreachable",
    });
  });
});

describe("Step 1: read my website", () => {
  const drafted = {
    brand: "  Haus of Veil ",
    description: "Haus of Veil sells care products for leather bags, jewellery and fine tableware.",
    claims: ["1. Premium leather wipes are made for leather bags.", "Products are crafted in-house.", "  The brand sources rare ingredients.  "],
    category: "home",
    keywords: ["Leather bag cleaner", "leather bag cleaner", "jewellery cloth"],
  };
  const site = { brand: "", url: " https://hausofveil.com/ ", description: "" };

  it("prefills Step 1 and carries claims, category and topics into Steps 2 and 3", () => {
    expect(applySiteDraft(site, drafted)).toEqual({
      product: { brand: "Haus of Veil", url: "https://hausofveil.com/", description: drafted.description },
      claims: ["Premium leather wipes are made for leather bags.", "Products are crafted in-house.", "The brand sources rare ingredients."],
      category: "home",
      keywords: ["leather bag cleaner", "jewellery cloth"],
    });
  });

  it("keeps the prefill within the wizard's limits", () => {
    const prefill = applySiteDraft(site, {
      ...drafted,
      brand: "B".repeat(60),
      claims: Array.from({ length: 7 }, (_, i) => `Claim number ${i + 1} is here.`),
      category: "weapons",
      keywords: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(prefill.product.brand).toHaveLength(40);
    expect(prefill.claims).toHaveLength(5);
    expect(prefill.category).toBe("other");
    expect(prefill.keywords).toHaveLength(6);
    expect(validateProduct(applySiteDraft(site, drafted).product)).toEqual({});
  });

  it("explains a failed read", () => {
    expect(siteFailedCopy("unreachable")).toBe(SITE_UNREADABLE);
    expect(siteFailedCopy("empty")).toBe(SITE_UNREADABLE);
    expect(siteFailedCopy("draft_failed")).toBe(SITE_DRAFT_FAILED);
  });

  const html = (initialState?: Parameters<typeof Wizard>[0]["initialState"]) =>
    renderToStaticMarkup(<Wizard client={createMockClient()} initialState={initialState} onLaunched={() => {}} />);

  it("leads with the website and a primary Read my website button", () => {
    const page = html();
    expect(page).toContain("Your website");
    expect(page).toMatch(/<button type="submit" disabled=""[^>]*>Read my website/);
    expect(page).toContain("or describe it yourself");
    expect(page).not.toContain("Brand name");
    expect(page.indexOf("Your website")).toBeLessThan(page.indexOf("or describe it yourself"));
    expect(html({ product: { ...site, url: "https://hausofveil.com/" } })).toMatch(
      /<button type="submit" class="[^"]*bg-stone-900[^"]*">Read my website/,
    );
  });

  it("shows the drafted fields with the KIMI note and continues to the drafted claims", () => {
    const prefill = applySiteDraft(site, drafted);
    const page = html({ ...prefill, fromSite: prefill.product.url });
    expect(page).toContain(SITE_DRAFTED);
    expect(page).toContain('value="Haus of Veil"');
    expect(page).toContain(drafted.description);
    expect(page).toMatch(/<button type="submit" class="[^"]*">Continue/);
    expect(page).not.toContain("or describe it yourself");
  });

  it("drops the KIMI note once the website changes", () => {
    const prefill = applySiteDraft(site, drafted);
    const page = html({ ...prefill, product: { ...prefill.product, url: "https://other.example/" }, fromSite: prefill.product.url });
    expect(page).not.toContain(SITE_DRAFTED);
    expect(page).toContain('value="Haus of Veil"');
  });
});

describe("wallet funding", () => {
  const WALLET = "0x9F1C2A8b7E6d5C4b3A2918070605040302010aBC";
  const MON_NEEDED = 60_000_000_000_000_000n;
  const PREPARED: Prepared = {
    slug: "crema-works-k3x9",
    campaignId: `0x${"01".repeat(32)}`,
    clearing: "0x431e97E2EB23ac06C9f807cC8DCe54499C1bDC7B",
    usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
    budget: "5000000",
    createCampaignData: "0xabcdef",
    wallet: WALLET,
  };
  const ESCROW_TX = `0x${"ef".repeat(32)}`;

  const props = (overrides: Partial<FundingPanelProps> = {}): FundingPanelProps => ({
    budgetCents: 500,
    address: WALLET,
    balances: { usdc: 5_000_000n, mon: MON_NEEDED },
    monNeeded: MON_NEEDED,
    checking: false,
    testFunds: { phase: "idle" },
    launch: IDLE_LAUNCH,
    onAddTestFunds: () => {},
    onCheckAgain: () => {},
    onBack: () => {},
    onLaunch: () => {},
    ...overrides,
  });
  const render = (overrides: Partial<FundingPanelProps> = {}) => renderToStaticMarkup(<FundingPanel {...props(overrides)} />);
  const launchDisabled = (html: string) => /<button[^>]*disabled=""[^>]*>Launch<\/button>/.test(html);

  function ops(overrides: Partial<LaunchOps> = {}): LaunchOps {
    return {
      prepare: vi.fn(async () => PREPARED),
      allowance: vi.fn(async () => 0n),
      approve: vi.fn(async () => `0x${"aa".repeat(32)}`),
      createCampaign: vi.fn(async () => ESCROW_TX),
      confirm: vi.fn(async (slug: string, txHash: string) => ({ slug, txHash })),
      ...overrides,
    };
  }

  function recorder() {
    const events: LaunchEvent[] = [];
    return { events, dispatch: (e: LaunchEvent) => events.push(e), state: () => events.reduce(reduceLaunch, IDLE_LAUNCH) };
  }

  it("shows the wallet address, balances, test-mode and onramp copy", () => {
    const html = render();
    expect(html).toContain("Fund your campaign wallet");
    expect(html).toContain(WALLET);
    expect(html).toContain("This is a test network: Aria adds test funds for you.");
    expect(html).toContain("In production, an onramp provider funds this wallet from a card payment, so you won&#x27;t see this step.");
    expect(html).toContain("Add test funds");
    expect(html).toContain("Check again");
    expect(html).toContain("$5.00");
  });

  it("keeps Launch disabled until both balances suffice", () => {
    expect(launchDisabled(render())).toBe(false);
    expect(launchDisabled(render({ balances: { usdc: 4_999_999n, mon: MON_NEEDED } }))).toBe(true);
    expect(launchDisabled(render({ balances: { usdc: 5_000_000n, mon: MON_NEEDED - 1n } }))).toBe(true);
    expect(launchDisabled(render({ balances: null }))).toBe(true);
    expect(launchDisabled(render({ monNeeded: null }))).toBe(true);
    expect(render({ balances: { usdc: 0n, mon: 0n } }).match(/Top up/g)).toHaveLength(2);
  });

  it("checks the balances against the budget and the fee", () => {
    expect(fundingChecks({ usdc: 5_000_000n, mon: 10n }, 5_000_000n, 10n)).toEqual({ usdcOk: true, monOk: true, ready: true });
    expect(fundingChecks({ usdc: 5_000_000n, mon: 9n }, 5_000_000n, 10n)).toEqual({ usdcOk: true, monOk: false, ready: false });
    expect(fundingChecks(null, 5_000_000n, 10n)).toEqual({ usdcOk: false, monOk: false, ready: false });
  });

  it("approves, moves the budget into escrow and confirms", async () => {
    const o = ops();
    const r = recorder();
    expect(await runWalletLaunch(o, r.dispatch, 500)).toBe("crema-works-k3x9");
    expect(r.events.map((e) => e.type)).toEqual(["start", "approving", "escrow", "confirming", "live"]);
    expect(o.approve).toHaveBeenCalledWith(PREPARED);
    expect(o.confirm).toHaveBeenCalledWith("crema-works-k3x9", ESCROW_TX);
    const html = render({ launch: r.state() });
    expect(html).toContain("Approved $5.00 USDC");
    expect(html).toContain("Available to AI answers");
    expect(html).toContain(`https://testnet.monadvision.com/tx/${ESCROW_TX}`);
  });

  it("skips the approve when the allowance already covers the budget", async () => {
    const o = ops({ allowance: vi.fn(async () => 5_000_000n) });
    const r = recorder();
    await runWalletLaunch(o, r.dispatch, 500);
    expect(o.approve).not.toHaveBeenCalled();
    expect(r.events.map((e) => e.type)).toEqual(["start", "escrow", "confirming", "live"]);
    expect(render({ launch: r.state() })).not.toContain("USDC…");
  });

  it("shows progress copy while each step runs", () => {
    expect(render({ launch: reduceLaunch(reduceLaunch(IDLE_LAUNCH, { type: "start" }), { type: "approving" }) })).toContain(
      "Approving $5.00 USDC…",
    );
    expect(render({ launch: reduceLaunch(IDLE_LAUNCH, { type: "escrow" }) })).toContain("Moving $5.00 into escrow…");
  });

  it.each([
    ["prepare", { prepare: vi.fn(async () => ({ error: "Test campaigns can spend up to $5.00 each. Lower your budget to launch." })) }, "Test campaigns can spend up to $5.00 each. Lower your budget to launch."],
    ["approve", { approve: vi.fn(async () => { throw new Error("User rejected"); }) }, APPROVE_FAILED("$5.00")],
    ["escrow", { createCampaign: vi.fn(async () => { throw new Error("reverted"); }) }, ESCROW_FAILED("$5.00")],
    ["confirm", { confirm: vi.fn(async () => ({ error: "" })) }, CONFIRM_PENDING],
  ] as const)("shows the copy and re-enables Launch when %s fails", async (_step, overrides, copy) => {
    const r = recorder();
    expect(await runWalletLaunch(ops(overrides as Partial<LaunchOps>), r.dispatch, 500)).toBeNull();
    const state = r.state();
    expect(state.phase).toBe("error");
    expect(state.error).toBe(copy);
    const html = render({ launch: state });
    expect(html).toContain(copy.replace(/'/g, "&#x27;"));
    expect(launchDisabled(html)).toBe(false);
  });

  it("disables Launch and Back while a launch runs", () => {
    const html = render({ launch: reduceLaunch(IDLE_LAUNCH, { type: "escrow" }) });
    expect(launchDisabled(html)).toBe(true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Back<\/button>/);
  });

  it("retries only the confirmation after the escrow transaction went through", async () => {
    const r = recorder();
    await runWalletLaunch(ops({ confirm: vi.fn(async () => ({ error: "" })) }), r.dispatch, 500);
    const failed = r.state();
    expect(failed.unconfirmed).toEqual({ slug: "crema-works-k3x9", txHash: ESCROW_TX });

    const retry = ops();
    const again = recorder();
    expect(await runWalletLaunch(retry, again.dispatch, 500, failed.unconfirmed)).toBe("crema-works-k3x9");
    expect(retry.prepare).not.toHaveBeenCalled();
    expect(retry.createCampaign).not.toHaveBeenCalled();
    expect(retry.confirm).toHaveBeenCalledWith("crema-works-k3x9", ESCROW_TX);
  });

  it("shows the test funds state", () => {
    expect(render({ testFunds: { phase: "sending" } })).toMatch(/<button[^>]*disabled=""[^>]*>Adding test funds…/);
    expect(render({ testFunds: { phase: "error", message: "This account has used its test funds." } })).toContain(
      "This account has used its test funds.",
    );
  });

  it("keeps the treasury launch box unless the funding is the advertiser's wallet", () => {
    const panel = (funding?: "wallet" | "treasury") =>
      renderToStaticMarkup(
        <LaunchPanel budgetCents={500} submitting={false} progress={null} error={null} funding={funding} onBack={() => {}} onLaunch={() => {}} />,
      );
    expect(panel()).toContain("Aria funds your $5.00 budget with test dollars");
    expect(panel("treasury")).toContain("Aria funds your $5.00 budget with test dollars");
    expect(panel("wallet")).not.toContain("Aria funds your $5.00 budget with test dollars");
    expect(panel("wallet")).toContain("Fund and launch");
  });
});

describe("wallet client calls", () => {
  it("prepares, confirms and asks for test funds with the bearer token", async () => {
    const replies = [
      { slug: "crema-works-k3x9", campaignId: "0x01", clearing: "0x02", usdc: "0x03", budget: "5000000", createCampaignData: "0xab", wallet: "0x04" },
      { slug: "crema-works-k3x9", txHash: "0xef" },
      { usdc: "5000000", mon: "1", usdcTx: "0xaa", monTx: "0xbb" },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    const prepared = await client.prepare({ ...product, claims, category: "food and drink", keywords: [], budgetCents: 500, cpcCents: 25, cpmCents: 1000 });
    expect(prepared).toMatchObject({ slug: "crema-works-k3x9", budget: "5000000" });
    expect(await client.confirm("crema-works-k3x9", "0xef")).toEqual({ slug: "crema-works-k3x9", txHash: "0xef" });
    expect(await client.addTestFunds(500)).toMatchObject({ usdc: "5000000" });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([path]) => path)).toEqual([
      "/api/advertise/campaigns/prepare",
      "/api/advertise/campaigns/confirm",
      "/api/advertise/test-funds",
    ]);
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ slug: "crema-works-k3x9", txHash: "0xef" });
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ budgetCents: 500 });
    expect((calls[2][1].headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("returns the server's copy when a wallet call fails", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Nope." }), { status: 409 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    expect(await client.confirm("s", "0x1")).toEqual({ error: "Nope." });
    expect(await client.addTestFunds(500)).toEqual({ error: "Nope." });
    const offline = createHttpClient(async () => "tok", (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    expect(await offline.prepare({ ...product, claims, category: "food and drink", keywords: [], budgetCents: 500, cpcCents: 25, cpmCents: 1000 })).toEqual({ error: "" });
  });
});
