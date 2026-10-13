import type { Address, Hex } from "viem";
import type { Advertiser } from "../../../../lib/advertiser-auth";
import { monTarget, topUp, type Amounts, type GrantStore } from "../../../../lib/test-funds";
import {
  budgetCapMessage,
  lowFundsMessage,
  NO_WALLET,
  toUsdcUnits,
  type FundingMode,
  type LaunchLimits,
} from "../campaigns/handlers";

export const TEST_FUNDS_FAILED = "We couldn't add test funds right now. Try again in a minute.";
export const TEST_FUNDS_LIMIT = "This account has used its test funds. Thanks for trying Aria!";
export const TEST_FUNDS_BUSY = "Your test funds are on the way.";
const BUDGET_ERROR = "Budget must be at least $1.00.";
const NOT_FOUND = "Not found.";

/** ARIA_TEST_FUNDS_PER_USER: test funds grants per signed-in advertiser; 1 when unset or invalid. */
export function testFundsPerUserFromEnv(): number {
  const n = Number(process.env.ARIA_TEST_FUNDS_PER_USER || NaN);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export type TestFundsDeps = {
  auth: (req: Request) => Promise<Advertiser | Response>;
  funding: () => FundingMode;
  /** The caller's embedded wallet, looked up server-side. */
  walletOf: (userId: string) => Promise<Address | null>;
  /** True when the request may skip the caps. */
  bypass: (req: Request) => boolean;
  limits: () => LaunchLimits;
  perUser: () => number;
  grants: GrantStore;
  balances: (wallet: Address) => Promise<Amounts>;
  /** Max fee per gas in wei. */
  feePerGas: () => Promise<bigint>;
  /** USDC held by the account that sends test funds. */
  sourceUsdc: () => Promise<bigint>;
  send: (to: Address, amounts: Amounts) => Promise<{ usdcTx: Hex | null; monTx: Hex | null }>;
  now?: () => number;
};

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Grants in flight per user, on globalThis so every route bundle shares them.
const globalInFlight = globalThis as typeof globalThis & { __ariaTestFundsInFlight?: Set<string> };
const inFlight = (globalInFlight.__ariaTestFundsInFlight ??= new Set<string>());

/**
 * `{budgetCents}` → tops the caller's embedded wallet up to the budget in test USDC and the launch-and-manage
 * MON estimate. Capped by the launch budget cap and grants per user; the demo key skips both.
 */
export function createTestFundsHandler(deps: TestFundsDeps) {
  const now = deps.now ?? Date.now;

  return async function POST(req: Request): Promise<Response> {
    const advertiser = await deps.auth(req);
    if (advertiser instanceof Response) return advertiser;
    if (deps.funding() !== "wallet") return json(404, { error: NOT_FOUND });

    const body = (await req.json().catch(() => null)) as { budgetCents?: unknown } | null;
    const budgetCents = body?.budgetCents;
    if (typeof budgetCents !== "number" || !Number.isInteger(budgetCents) || budgetCents < 100) {
      return json(400, { error: BUDGET_ERROR, field: "budgetCents" });
    }

    const capped = !deps.bypass(req);
    const maxCents = capped ? deps.limits().maxBudgetCents : undefined;
    if (maxCents !== undefined && budgetCents > maxCents) {
      return json(400, { error: budgetCapMessage(maxCents), field: "budgetCents", code: "limit" });
    }
    if (capped && deps.grants.count(advertiser.userId) >= deps.perUser()) {
      return json(403, { error: TEST_FUNDS_LIMIT, code: "limit" });
    }

    let wallet: Address | null;
    try {
      wallet = await deps.walletOf(advertiser.userId);
    } catch (err) {
      console.error(`test funds: wallet lookup failed: ${message(err)}`);
      return json(502, { error: TEST_FUNDS_FAILED });
    }
    if (!wallet) return json(409, { error: NO_WALLET });

    if (inFlight.has(advertiser.userId)) return json(409, { error: TEST_FUNDS_BUSY });
    inFlight.add(advertiser.userId);
    try {
      const [held, feePerGas] = await Promise.all([deps.balances(wallet), deps.feePerGas()]);
      const { budget } = toUsdcUnits({ budgetCents, cpcCents: 0, cpmCents: 0 });
      const amounts = topUp(held, { usdc: budget, mon: monTarget(feePerGas) });
      if (amounts.usdc === 0n && amounts.mon === 0n) {
        return json(200, { usdc: "0", mon: "0", usdcTx: null, monTx: null });
      }

      const available = await deps.sourceUsdc();
      if (available < amounts.usdc) return json(402, { error: lowFundsMessage(available) });

      const sent = await deps.send(wallet, amounts);
      const grant = { usdc: amounts.usdc.toString(), mon: amounts.mon.toString(), ...sent };
      deps.grants.record(advertiser.userId, { at: now(), wallet, ...grant });
      return json(200, grant);
    } catch (err) {
      console.error(`test funds to ${wallet} failed: ${message(err)}`);
      return json(502, { error: TEST_FUNDS_FAILED });
    } finally {
      inFlight.delete(advertiser.userId);
    }
  };
}
