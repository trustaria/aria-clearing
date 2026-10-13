import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestFundsHandler,
  TEST_FUNDS_FAILED,
  TEST_FUNDS_LIMIT,
  testFundsPerUserFromEnv,
  type TestFundsDeps,
} from "../app/api/advertise/test-funds/handlers";
import { budgetCapMessage, lowFundsMessage, NO_WALLET } from "../app/api/advertise/campaigns/handlers";
import { createGrantStore, monTarget, TEST_FUNDS_GAS, topUp } from "../lib/test-funds";
import { FALLBACK_GAS, feeFor, withMargin } from "../lib/wallet-gas";

const WALLET = getAddress("0x9f1c2a8b7e6d5c4b3a2918070605040302010abc");
const FEE = 100_000_000_000n;

describe("wallet gas", () => {
  it("adds a 20 % margin, rounded up", () => {
    expect(withMargin(100_000n)).toBe(120_000n);
    expect(withMargin(43_228n)).toBe(51_874n);
  });

  it("prices a set of gas limits", () => {
    expect(feeFor([100_000n, 50_000n], FEE)).toBe(150_000n * FEE);
    expect(feeFor([], FEE)).toBe(0n);
  });
});

describe("test funds amounts", () => {
  it("covers launching, two disputes and End", () => {
    const { approve, createCampaign, dispute, withdraw } = FALLBACK_GAS;
    expect(TEST_FUNDS_GAS).toBe(approve + createCampaign + 2n * dispute + withdraw);
    expect(monTarget(FEE)).toBe(TEST_FUNDS_GAS * FEE);
  });

  it("sends only what the wallet lacks", () => {
    expect(topUp({ usdc: 0n, mon: 0n }, { usdc: 5_000_000n, mon: 10n })).toEqual({ usdc: 5_000_000n, mon: 10n });
    expect(topUp({ usdc: 2_000_000n, mon: 4n }, { usdc: 5_000_000n, mon: 10n })).toEqual({ usdc: 3_000_000n, mon: 6n });
    expect(topUp({ usdc: 9_000_000n, mon: 40n }, { usdc: 5_000_000n, mon: 10n })).toEqual({ usdc: 0n, mon: 0n });
  });

  it("reads ARIA_TEST_FUNDS_PER_USER, 1 by default", () => {
    vi.stubEnv("ARIA_TEST_FUNDS_PER_USER", "");
    expect(testFundsPerUserFromEnv()).toBe(1);
    vi.stubEnv("ARIA_TEST_FUNDS_PER_USER", "3");
    expect(testFundsPerUserFromEnv()).toBe(3);
    vi.stubEnv("ARIA_TEST_FUNDS_PER_USER", "zero");
    expect(testFundsPerUserFromEnv()).toBe(1);
    vi.unstubAllEnvs();
  });
});

describe("grant store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-grants-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("counts grants per user and reloads them from the file", () => {
    const file = join(dir, "test-funds.json");
    const store = createGrantStore(file);
    store.record("did:privy:ana", { at: 1, wallet: WALLET, usdc: "5000000", mon: "10" });
    expect(store.count("did:privy:ana")).toBe(1);
    expect(store.count("did:privy:bob")).toBe(0);
    expect(createGrantStore(file).count("did:privy:ana")).toBe(1);
  });
});

// Valid tokens are "token-<userId>".
async function auth(req: Request) {
  const token = /^Bearer token-(.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  return token ? { userId: token } : Response.json({ error: "Sign in to continue." }, { status: 401 });
}

function request(body: unknown, user: string | null = "ana", demo = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers.authorization = `Bearer token-${user}`;
  if (demo) headers["x-demo"] = "1";
  return new Request("http://x/api/advertise/test-funds", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/advertise/test-funds", () => {
  function setup(overrides: Partial<TestFundsDeps> = {}) {
    const grants = new Map<string, number>();
    const deps: TestFundsDeps = {
      auth,
      funding: () => "wallet",
      walletOf: vi.fn(async () => WALLET),
      bypass: (req) => req.headers.get("x-demo") === "1",
      limits: () => ({}),
      perUser: () => 1,
      grants: {
        count: (userId) => grants.get(userId) ?? 0,
        record: vi.fn((userId: string) => void grants.set(userId, (grants.get(userId) ?? 0) + 1)),
      },
      balances: vi.fn(async () => ({ usdc: 0n, mon: 0n })),
      feePerGas: vi.fn(async () => FEE),
      sourceUsdc: vi.fn(async () => 100_000_000n),
      send: vi.fn(async (_to: Address, amounts: { usdc: bigint; mon: bigint }) => ({
        usdcTx: amounts.usdc > 0n ? (`0x${"aa".repeat(32)}` as const) : null,
        monTx: amounts.mon > 0n ? (`0x${"bb".repeat(32)}` as const) : null,
      })),
      now: () => 1_760_000_000_000,
      ...overrides,
    };
    return { deps, grants, handler: createTestFundsHandler(deps) };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("answers 401 without a token and 404 in treasury mode", async () => {
    expect((await setup().handler(request({ budgetCents: 500 }, null))).status).toBe(401);
    const { handler, deps } = setup({ funding: () => "treasury" });
    expect((await handler(request({ budgetCents: 500 }))).status).toBe(404);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("sends the budget in USDC and the MON estimate to the caller's wallet", async () => {
    const { handler, deps, grants } = setup();
    const res = await handler(request({ budgetCents: 500, wallet: "0x0000000000000000000000000000000000000bad" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      usdc: "5000000",
      mon: monTarget(FEE).toString(),
      usdcTx: `0x${"aa".repeat(32)}`,
      monTx: `0x${"bb".repeat(32)}`,
    });
    expect(deps.send).toHaveBeenCalledWith(WALLET, { usdc: 5_000_000n, mon: monTarget(FEE) });
    expect(grants.get("ana")).toBe(1);
  });

  it("tops up only the shortfall and records nothing when the wallet already holds enough", async () => {
    const { handler, deps } = setup({ balances: vi.fn(async () => ({ usdc: 2_000_000n, mon: monTarget(FEE) })) });
    await handler(request({ budgetCents: 500 }));
    expect(deps.send).toHaveBeenCalledWith(WALLET, { usdc: 3_000_000n, mon: 0n });

    const full = setup({ balances: vi.fn(async () => ({ usdc: 5_000_000n, mon: monTarget(FEE) })) });
    const res = await full.handler(request({ budgetCents: 500 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usdc: "0", mon: "0", usdcTx: null, monTx: null });
    expect(full.deps.send).not.toHaveBeenCalled();
    expect(full.grants.get("ana")).toBeUndefined();
  });

  it("refuses a bad budget and a budget over the launch cap", async () => {
    const { handler, deps } = setup({ limits: () => ({ maxBudgetCents: 500 }) });
    expect((await handler(request({ budgetCents: 50 }))).status).toBe(400);
    const res = await handler(request({ budgetCents: 501 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(budgetCapMessage(500));
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("allows ARIA_TEST_FUNDS_PER_USER grants per user", async () => {
    const { handler, deps } = setup();
    expect((await handler(request({ budgetCents: 500 }))).status).toBe(200);
    const res = await handler(request({ budgetCents: 500 }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(TEST_FUNDS_LIMIT);
    expect((await handler(request({ budgetCents: 500 }, "bob"))).status).toBe(200);
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it("lets the demo key past both caps", async () => {
    const { handler } = setup({ limits: () => ({ maxBudgetCents: 500 }) });
    expect((await handler(request({ budgetCents: 500 }))).status).toBe(200);
    expect((await handler(request({ budgetCents: 900 }, "ana", true))).status).toBe(200);
  });

  it("asks to wait without an embedded wallet", async () => {
    const { handler, deps } = setup({ walletOf: vi.fn(async () => null) });
    const res = await handler(request({ budgetCents: 500 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(NO_WALLET);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("says so when the test funds source runs low", async () => {
    const { handler, deps } = setup({ sourceUsdc: vi.fn(async () => 1_000_000n) });
    const res = await handler(request({ budgetCents: 500 }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe(lowFundsMessage(1_000_000n));
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("answers 502 when a transfer fails", async () => {
    const { handler, grants } = setup({
      send: vi.fn(async () => {
        throw new Error("reverted");
      }),
    });
    const res = await handler(request({ budgetCents: 500 }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(TEST_FUNDS_FAILED);
    expect(grants.get("ana")).toBeUndefined();
  });
});
