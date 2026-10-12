import { ariaClearingAbi, campaignIdOf, formatClaims } from "@aria-clearing/receipt";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeErrorResult,
  erc20Abi,
  maxUint256,
  toBytes,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCampaignHandlers,
  LAUNCH_FAILED,
  LAUNCH_IN_PROGRESS,
  lowFundsMessage,
  slugify,
  toUsdcUnits,
  validateLaunch,
  type Deps,
} from "../app/api/advertise/campaigns/handlers";
import { requireAdvertiser } from "../lib/advertiser-auth";
import type { StoredCampaign } from "../lib/campaign-store";
import { APPROVE_GAS, LAUNCH_GAS, LaunchError, launchCampaign, type TreasuryDeps } from "../lib/treasury";

const TREASURY = "0x1C2222B3D0D8C3909453dFFb39ff43f06DDF1B11";
const CLEARING = "0xfb6bA8e6c48c806AFC40aFee5F85deE42Ce8F2fb";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const TX = `0x${"ab".repeat(32)}` as Hex;
const APPROVE_TX = `0x${"cd".repeat(32)}` as Hex;

const BODY = {
  brand: "Crema Works",
  url: "https://crema.works/home-espresso",
  description:
    "Compact espresso machines for home kitchens. Every machine has a 15-bar pump and a steam wand, ships free in the EU.",
  claims: [
    "1. Compact espresso machines   for kitchens.",
    "15-bar pump with a steam wand.",
    "Free shipping in the EU in 3 days.",
    "Two-year warranty on every machine.",
  ],
  category: "Food and drink",
  keywords: ["Home espresso", "espresso machine", "home espresso"],
  budgetCents: 500,
  cpcCents: 25,
  cpmCents: 1000,
  email: "brand@crema.works",
};

const NORMALISED_CLAIMS = [
  "Compact espresso machines for kitchens.",
  "15-bar pump with a steam wand.",
  "Free shipping in the EU in 3 days.",
  "Two-year warranty on every machine.",
];

// Valid tokens are "token-<userId>".
const auth = (req: Request) =>
  requireAdvertiser(req, async (token) => {
    if (!token.startsWith("token-")) throw new Error("invalid");
    return { userId: token.slice("token-".length) };
  });

function post(body: unknown, user = "alice", token = `token-${user}`) {
  return new Request("http://x/api/advertise/campaigns", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(user = "alice") {
  return new Request("http://x/api/advertise/campaigns", { headers: { authorization: `Bearer token-${user}` } });
}

function setup(overrides: Partial<Deps> = {}) {
  const saved: StoredCampaign[] = [];
  const deps: Deps = {
    auth,
    balance: vi.fn(async () => 20_000_000n),
    launch: vi.fn(async ({ slug }) => ({ campaignId: campaignIdOf(slug), txHash: TX, blockNumber: 70_500_000n })),
    save: vi.fn((record: StoredCampaign) => {
      saved.push(record);
      return record;
    }),
    listByOwner: (ownerId) => saved.filter((r) => r.ownerId === ownerId).reverse(),
    slugTaken: (slug) => saved.some((r) => r.slug === slug),
    campaignState: vi.fn(async () => null),
    suffix: () => "k3x9",
    now: () => 1_760_000_000_000,
    ...overrides,
  };
  return { deps, saved, handlers: createCampaignHandlers(deps) };
}

/** A fake chain + Privy sender around the real launchCampaign. */
function fakeTreasury({ balance = 20_000_000n, allowance = maxUint256 } = {}) {
  const sent: { walletId: string; to: string; data: Hex; gasLimit: bigint | number }[] = [];
  const client = {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "balanceOf" ? balance : allowance,
    ),
    simulateContract: vi.fn(async () => ({ request: {} })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 70_500_123n })),
  };
  const treasury: TreasuryDeps = {
    address: TREASURY,
    walletId: "treasury-wallet",
    clearing: CLEARING,
    usdc: USDC,
    client: client as never,
    send: vi.fn(async (walletId, tx) => {
      sent.push({ walletId, ...tx });
      return tx.to === USDC ? APPROVE_TX : TX;
    }),
  };
  return { treasury, client, sent };
}

describe("auth", () => {
  it.each([["GET"], ["POST"]])("%s answers 401 without a token", async (method) => {
    const { handlers, deps } = setup();
    const req = new Request("http://x/api/advertise/campaigns", { method, body: method === "POST" ? "{}" : undefined });
    const res = method === "GET" ? await handlers.GET(req) : await handlers.POST(req);
    expect(res.status).toBe(401);
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it("POST answers 401 for an invalid token", async () => {
    const { handlers, deps } = setup();
    const res = await handlers.POST(post(BODY, "alice", "forged"));
    expect(res.status).toBe(401);
    expect(deps.launch).not.toHaveBeenCalled();
  });
});

describe("validateLaunch", () => {
  it("normalises claims, category, keywords and brand", () => {
    const result = validateLaunch({ ...BODY, brand: "  Crema   Works " });
    expect("value" in result && result.value).toMatchObject({
      brand: "Crema Works",
      claims: NORMALISED_CLAIMS,
      category: "food and drink",
      keywords: ["home espresso", "espresso machine"],
    });
  });

  it.each([
    ["brand", { brand: "C" }],
    ["brand", { brand: "x".repeat(41) }],
    ["url", { url: "http://crema.works" }],
    ["url", { url: "not a url" }],
    ["description", { description: "Too short." }],
    ["description", { description: "x".repeat(1501) }],
    ["claims", { claims: [] }],
    ["claims", { claims: ["Short."] }],
    ["claims", { claims: ["x".repeat(121)] }],
    ["claims", { claims: Array(6).fill("A perfectly fine claim.") }],
    ["category", { category: "groceries" }],
    ["keywords", { keywords: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["budgetCents", { budgetCents: 99 }],
    ["budgetCents", { budgetCents: 5.5 }],
    ["budgetCents", { budgetCents: "500" }],
    ["cpcCents", { cpcCents: 0 }],
    ["cpcCents", { cpcCents: 501 }],
    ["cpmCents", { cpmCents: 99 }],
    ["cpmCents", { cpmCents: 5001 }],
  ])("rejects a bad %s", (field, patch) => {
    expect(validateLaunch({ ...BODY, ...patch })).toMatchObject({ field });
  });

  it("accepts the limits", () => {
    for (const patch of [
      { cpcCents: 1, cpmCents: 100, budgetCents: 100 },
      { cpcCents: 500, cpmCents: 5000 },
    ]) {
      expect("value" in validateLaunch({ ...BODY, ...patch })).toBe(true);
    }
  });
});

describe("units and slugs", () => {
  it("converts cents to USDC units", () => {
    expect(toUsdcUnits({ budgetCents: 500, cpcCents: 25, cpmCents: 1000 })).toEqual({
      budget: 5_000_000n,
      priceClick: 250_000n,
      priceImpression: 10_000n,
    });
    expect(toUsdcUnits({ budgetCents: 100, cpcCents: 1, cpmCents: 100 })).toEqual({
      budget: 1_000_000n,
      priceClick: 10_000n,
      priceImpression: 1_000n,
    });
  });

  it("slugifies brands", () => {
    expect(slugify("Crema Works")).toBe("crema-works");
    expect(slugify("  Café   Ünïcode & Co. ")).toBe("cafe-unicode-co");
    expect(slugify("!!!")).toBe("campaign");
  });

  it("formats the low-funds copy", () => {
    expect(lowFundsMessage(18_400_000n)).toBe(
      "Test funds are low: up to $18.40 is available right now. Lower your budget or try again later.",
    );
    expect(lowFundsMessage(0n)).toBe(
      "Test funds are low: up to $0.00 is available right now. Lower your budget or try again later.",
    );
  });
});

describe("POST /api/advertise/campaigns", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("launches and saves a live record", async () => {
    const { handlers, saved, deps } = setup();
    const res = await handlers.POST(post(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "crema-works-k3x9", txHash: TX });
    expect(deps.launch).toHaveBeenCalledWith({
      slug: "crema-works-k3x9",
      claims: NORMALISED_CLAIMS,
      budget: 5_000_000n,
      priceClick: 250_000n,
      priceImpression: 10_000n,
    });
    expect(saved).toEqual([
      {
        slug: "crema-works-k3x9",
        advertiser: "Crema Works",
        url: BODY.url,
        category: "food and drink",
        claims: NORMALISED_CLAIMS,
        keywords: ["home espresso", "espresso machine"],
        priceImpression: 10_000,
        priceClick: 250_000,
        budget: 5_000_000,
        campaignId: campaignIdOf("crema-works-k3x9"),
        ownerId: "alice",
        ownerEmail: "brand@crema.works",
        txHash: TX,
        createdBlock: 70_500_000,
        createdAt: 1_760_000_000_000,
        status: "live",
      },
    ]);
  });

  it("answers 400 with the first field error", async () => {
    const { handlers, deps } = setup();
    const res = await handlers.POST(post({ ...BODY, url: "http://crema.works" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ field: "url", error: "Website must be a valid https:// address." });
    const bad = await handlers.POST(post("not json"));
    expect(bad.status).toBe(400);
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it("answers 402 with the low-funds copy when the budget exceeds the treasury", async () => {
    const { handlers, deps } = setup({ balance: async () => 0n });
    const res = await handlers.POST(post({ ...BODY, budgetCents: 100 }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "Test funds are low: up to $0.00 is available right now. Lower your budget or try again later.",
    });
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it("answers 402 when the treasury drops below the budget before the send", async () => {
    const { handlers, saved } = setup({
      launch: async () => {
        throw new LaunchError("low-funds", "short", 3_210_000n);
      },
    });
    const res = await handlers.POST(post(BODY));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe(
      "Test funds are low: up to $3.21 is available right now. Lower your budget or try again later.",
    );
    expect(saved).toEqual([]);
  });

  it("picks a slug no seeded or stored campaign uses", async () => {
    const suffixes = ["aaaa", "bbbb"];
    const { handlers } = setup({
      suffix: () => suffixes.shift() ?? "zzzz",
      slugTaken: (slug) => slug === "crema-works-aaaa",
    });
    const res = await handlers.POST(post(BODY));
    expect((await res.json()).slug).toBe("crema-works-bbbb");
  });

  it("retries with a new slug when the id already exists onchain", async () => {
    const suffixes = ["aaaa", "bbbb"];
    const launch = vi.fn(async ({ slug }: { slug: string }) => {
      if (slug === "crema-works-aaaa") throw new LaunchError("campaign-exists", "taken");
      return { campaignId: campaignIdOf(slug), txHash: TX, blockNumber: 1n };
    });
    const { handlers } = setup({ suffix: () => suffixes.shift() ?? "zzzz", launch });
    const res = await handlers.POST(post(BODY));
    expect(await res.json()).toEqual({ slug: "crema-works-bbbb", txHash: TX });
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("answers 502 with the launch-failed copy and saves nothing when the send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handlers, saved } = setup({
      launch: async () => {
        throw new LaunchError("failed", "policy");
      },
    });
    const res = await handlers.POST(post(BODY));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: LAUNCH_FAILED });
    expect(saved).toEqual([]);
  });

  it("still answers with the launched campaign when the record write fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handlers } = setup({
      save: () => {
        throw new Error("disk full");
      },
    });
    const res = await handlers.POST(post(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "crema-works-k3x9", txHash: TX });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("crema-works-k3x9"));
  });

  it("launches once for a double submit and gives both the same answer", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const launch = vi.fn(async ({ slug }: { slug: string }) => {
      await gate;
      return { campaignId: campaignIdOf(slug), txHash: TX, blockNumber: 1n };
    });
    const { handlers, saved } = setup({ launch });
    const first = handlers.POST(post(BODY));
    const second = handlers.POST(post(BODY));
    const other = handlers.POST(post({ ...BODY, brand: "Other Brand" }));
    const otherRes = await other;
    expect(otherRes.status).toBe(409);
    expect(await otherRes.json()).toEqual({ error: LAUNCH_IN_PROGRESS });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(await a.json()).toEqual({ slug: "crema-works-k3x9", txHash: TX });
    expect(await b.json()).toEqual({ slug: "crema-works-k3x9", txHash: TX });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });

  it("lets another user launch while one launch is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const suffixes = ["aaaa", "bbbb"];
    const launch = vi.fn(async ({ slug }: { slug: string }) => {
      if (slug.endsWith("aaaa")) await gate;
      return { campaignId: campaignIdOf(slug), txHash: TX, blockNumber: 1n };
    });
    const { handlers } = setup({ launch, suffix: () => suffixes.shift() ?? "zzzz" });
    const alice = handlers.POST(post(BODY, "alice"));
    const bob = await handlers.POST(post(BODY, "bob"));
    expect(bob.status).toBe(200);
    release();
    expect((await alice).status).toBe(200);
  });

  it("encodes createCampaign with claims equal to formatClaims of the normalised claims, byte for byte", async () => {
    const { treasury, sent, client } = fakeTreasury();
    const { handlers, saved } = setup({ launch: (args) => launchCampaign(args, treasury) });
    const res = await handlers.POST(post(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "crema-works-k3x9", txHash: TX });

    expect(sent).toHaveLength(1);
    const [tx] = sent;
    expect(tx).toMatchObject({ walletId: "treasury-wallet", to: CLEARING, gasLimit: LAUNCH_GAS });
    const decoded = decodeFunctionData({ abi: ariaClearingAbi, data: tx.data });
    expect(decoded.functionName).toBe("createCampaign");
    const [campaignId, claims, priceImpression, priceClick, budget] = decoded.args as [
      Hex,
      string,
      bigint,
      bigint,
      bigint,
    ];
    expect(campaignId).toBe(campaignIdOf("crema-works-k3x9"));
    expect(toBytes(claims)).toEqual(toBytes(formatClaims(NORMALISED_CLAIMS)));
    expect(claims).toBe(
      "1. Compact espresso machines for kitchens.\n2. 15-bar pump with a steam wand.\n" +
        "3. Free shipping in the EU in 3 days.\n4. Two-year warranty on every machine.",
    );
    expect([priceImpression, priceClick, budget]).toEqual([10_000n, 250_000n, 5_000_000n]);

    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ account: TREASURY, address: CLEARING, functionName: "createCampaign" }),
    );
    expect(client.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: TX }));
    expect(saved[0]).toMatchObject({ txHash: TX, createdBlock: 70_500_123, status: "live" });
  });
});

describe("launchCampaign", () => {
  const ARGS = {
    slug: "crema-works-k3x9",
    claims: NORMALISED_CLAIMS,
    priceImpression: 10_000n,
    priceClick: 250_000n,
    budget: 5_000_000n,
  };

  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("approves the clearing contract first when the allowance is short", async () => {
    const { treasury, sent } = fakeTreasury({ allowance: 1_000_000n });
    await launchCampaign(ARGS, treasury);
    expect(sent.map((t) => [t.to, t.gasLimit])).toEqual([
      [USDC, APPROVE_GAS],
      [CLEARING, LAUNCH_GAS],
    ]);
    const approve = decodeFunctionData({ abi: erc20Abi, data: sent[0].data });
    expect(approve).toEqual({ functionName: "approve", args: [CLEARING, maxUint256] });
  });

  it("rejects low funds without sending", async () => {
    const { treasury, sent } = fakeTreasury({ balance: 4_999_999n });
    await expect(launchCampaign(ARGS, treasury)).rejects.toMatchObject({ code: "low-funds", available: 4_999_999n });
    expect(sent).toEqual([]);
  });

  it("maps a CampaignExists simulation revert", async () => {
    const { treasury, client, sent } = fakeTreasury();
    const reverted = new ContractFunctionRevertedError({
      abi: ariaClearingAbi,
      functionName: "createCampaign",
      data: encodeErrorResult({ abi: ariaClearingAbi, errorName: "CampaignExists" }),
    });
    client.simulateContract.mockRejectedValueOnce(
      new ContractFunctionExecutionError(reverted, {
        abi: ariaClearingAbi,
        functionName: "createCampaign",
        args: [campaignIdOf(ARGS.slug), formatClaims(ARGS.claims), ARGS.priceImpression, ARGS.priceClick, ARGS.budget],
        contractAddress: CLEARING,
      }),
    );
    await expect(launchCampaign(ARGS, treasury)).rejects.toMatchObject({ code: "campaign-exists" });
    expect(sent).toEqual([]);
  });

  it("fails cleanly when the sender is denied or the tx reverts", async () => {
    const denied = fakeTreasury();
    denied.treasury.send = async () => {
      throw new Error("policy_violation");
    };
    await expect(launchCampaign(ARGS, denied.treasury)).rejects.toMatchObject({ code: "failed" });

    const reverted = fakeTreasury();
    reverted.client.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted", blockNumber: 1n });
    await expect(launchCampaign(ARGS, reverted.treasury)).rejects.toMatchObject({ code: "failed" });
  });

  it("runs launches one at a time", async () => {
    const order: string[] = [];
    const { treasury, client } = fakeTreasury();
    client.waitForTransactionReceipt.mockImplementation(async () => {
      order.push("receipt");
      return { status: "success", blockNumber: 1n };
    });
    client.simulateContract.mockImplementation(async () => {
      order.push("simulate");
      return { request: {} };
    });
    await Promise.all([launchCampaign(ARGS, treasury), launchCampaign({ ...ARGS, slug: "other-0000" }, treasury)]);
    expect(order).toEqual(["simulate", "receipt", "simulate", "receipt"]);
  });
});

describe("GET /api/advertise/campaigns", () => {
  it("lists only the caller's campaigns in cents with the treasury maximum", async () => {
    const { handlers } = setup({
      balance: async () => 18_404_321n,
      campaignState: async () => ({ available: 3_770_000n, reserved: 250_000n }),
    });
    await handlers.POST(post(BODY, "alice"));
    const bobRes = await handlers.POST(post({ ...BODY, brand: "Bob Bikes" }, "bob"));
    expect(bobRes.status).toBe(200);

    const res = await handlers.GET(get("alice"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      campaigns: [
        {
          slug: "crema-works-k3x9",
          advertiser: "Crema Works",
          status: "live",
          spent: 98,
          budget: 500,
          impressions: 0,
          clicks: 0,
        },
      ],
      maxBudget: 1840,
    });
  });

  it("reports zero spent when the chain is unreadable", async () => {
    const { handlers } = setup({
      campaignState: async () => {
        throw new Error("rpc down");
      },
    });
    await handlers.POST(post(BODY));
    const body = await (await handlers.GET(get())).json();
    expect(body.campaigns[0]).toMatchObject({ spent: 0, budget: 500 });
  });
});
