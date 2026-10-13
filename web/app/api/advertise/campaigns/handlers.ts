import { randomBytes } from "node:crypto";
import { campaignIdOf } from "@aria-clearing/receipt";
import type { Address, Hex } from "viem";
import type { Advertiser } from "../../../../lib/advertiser-auth";
import { checkCampaignCreated, type ConfirmReceipt } from "../../../../lib/campaign-confirm";
import type { CampaignFunding, StoredCampaign } from "../../../../lib/campaign-store";
import { CATEGORIES, KEYWORDS_LIMIT, normalizeClaims, type Category } from "../../../../lib/claims-draft";
import { createCampaignCalldata, LaunchError, type LaunchArgs, type LaunchResult } from "../../../../lib/treasury";

/** USDC units (6 decimals) per US cent. */
const UNITS_PER_CENT = 10_000n;
const SLUG_ATTEMPTS = 5;
const LAUNCH_ATTEMPTS = 3;

export const LAUNCH_FAILED = "We couldn't launch right now. Nothing was charged. Try again in a minute.";
export const LAUNCH_IN_PROGRESS = "Your last campaign is still launching. Try again in a moment.";
export const NO_WALLET = "Your campaign wallet isn't ready yet. Refresh the page and try again.";
export const CONFIRM_FAILED = "We couldn't confirm your launch yet. Your campaign isn't live. Try again in a minute.";
export const CONFIRM_MISMATCH = "That transaction doesn't match this campaign, so your campaign isn't live.";
export const CONFIRM_CONFLICT = "This campaign was already launched with another transaction.";
const NOT_FOUND = "Not found.";
const CAMPAIGN_NOT_FOUND = "Campaign not found.";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Who funds console campaigns. */
export type FundingMode = CampaignFunding;

/** ADVERTISER_FUNDING: "wallet" for the advertiser's embedded wallet; anything else means the treasury. */
export function fundingModeFromEnv(): FundingMode {
  return (process.env.ADVERTISER_FUNDING ?? "").trim().toLowerCase() === "wallet" ? "wallet" : "treasury";
}

/** Per-campaign budget cap and launches per advertiser; an absent field means no limit. */
export type LaunchLimits = { maxBudgetCents?: number; perUser?: number };

export function budgetCapMessage(maxCents: number): string {
  return `Test campaigns can spend up to ${formatUsd(maxCents)} each. Lower your budget to launch.`;
}

export function launchLimitMessage(perUser: number): string {
  return `This account has used its ${perUser} test launch${perUser === 1 ? "" : "es"}. Thanks for trying Aria!`;
}

/** ARIA_LAUNCH_MAX_USD (dollars) and ARIA_LAUNCH_PER_USER (count); unset or invalid values mean no limit. */
export function launchLimitsFromEnv(): LaunchLimits {
  const limits: LaunchLimits = {};
  const maxUsd = Number(process.env.ARIA_LAUNCH_MAX_USD || NaN);
  if (Number.isFinite(maxUsd) && maxUsd > 0) limits.maxBudgetCents = Math.round(maxUsd * 100);
  const perUser = Number(process.env.ARIA_LAUNCH_PER_USER || NaN);
  if (Number.isInteger(perUser) && perUser > 0) limits.perUser = perUser;
  return limits;
}

/** The §3.7 low-funds copy for a treasury balance in USDC units. */
export function lowFundsMessage(available: bigint): string {
  return `Test funds are low: up to ${formatUsd(centsOf(available))} is available right now. Lower your budget or try again later.`;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** USDC units to whole cents, rounded down. */
function centsOf(units: bigint): number {
  return Number(units / UNITS_PER_CENT);
}

export type LaunchInput = {
  brand: string;
  url: string;
  description: string;
  claims: string[];
  category: Category;
  keywords: string[];
  budgetCents: number;
  cpcCents: number;
  cpmCents: number;
  email: string;
};

export type ValidationResult = { value: LaunchInput } | { error: string; field: string };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeKeywords(keywords: unknown): string[] | null {
  if (keywords === undefined) return [];
  if (!Array.isArray(keywords) || !keywords.every((k) => typeof k === "string")) return null;
  const clean = (keywords as string[])
    .map((k) => k.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((k) => k.length > 0);
  if (clean.some((k) => k.length > 60)) return null;
  const unique = [...new Set(clean)];
  return unique.length <= KEYWORDS_LIMIT ? unique : null;
}

function centsIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Checks and normalises a launch request. Budget is checked against the treasury separately. */
export function validateLaunch(body: unknown): ValidationResult {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.normalize("NFC").trim() : "");

  const brand = text(raw.brand).replace(/\s+/g, " ");
  if (brand.length < 2 || brand.length > 40) return { field: "brand", error: "Brand name must be 2 to 40 characters." };

  const url = text(raw.url);
  if (!isHttpsUrl(url)) return { field: "url", error: "Website must be a valid https:// address." };

  const description = text(raw.description);
  if (description.length < 40 || description.length > 1500) {
    return { field: "description", error: "Description must be 40 to 1,500 characters." };
  }

  const claims = normalizeClaims(raw.claims);
  if (!claims) return { field: "claims", error: "Add 1 to 5 claims, each 10 to 120 characters." };

  const category = text(raw.category).toLowerCase();
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return { field: "category", error: "Choose a category from the list." };
  }

  const keywords = normalizeKeywords(raw.keywords);
  if (!keywords) return { field: "keywords", error: `Add up to ${KEYWORDS_LIMIT} topics of at most 60 characters.` };

  const budgetCents = centsIn(raw.budgetCents, 100, Number.MAX_SAFE_INTEGER);
  if (budgetCents === null) return { field: "budgetCents", error: "Budget must be at least $1.00." };

  const cpcCents = centsIn(raw.cpcCents, 1, 500);
  if (cpcCents === null) return { field: "cpcCents", error: "Cost per click must be between $0.01 and $5.00." };

  const cpmCents = centsIn(raw.cpmCents, 100, 5000);
  if (cpmCents === null) {
    return { field: "cpmCents", error: "Cost per 1,000 impressions must be between $1.00 and $50.00." };
  }

  const email = text(raw.email).slice(0, 254);

  return {
    value: {
      brand,
      url,
      description,
      claims,
      category: category as Category,
      keywords,
      budgetCents,
      cpcCents,
      cpmCents,
      email,
    },
  };
}

/** Prices and budget in USDC units: CPC cents × 10,000, CPM cents × 10, budget cents × 10,000. */
export function toUsdcUnits(input: Pick<LaunchInput, "budgetCents" | "cpcCents" | "cpmCents">) {
  return {
    priceClick: BigInt(input.cpcCents) * UNITS_PER_CENT,
    priceImpression: BigInt(input.cpmCents) * 10n,
    budget: BigInt(input.budgetCents) * UNITS_PER_CENT,
  };
}

/** Lowercase ASCII words joined by dashes, at most 32 characters. */
export function slugify(brand: string): string {
  const base = brand
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return base || "campaign";
}

/** Four random base36 characters. */
export function randomSuffix(): string {
  const n = randomBytes(4).readUInt32BE(0) % 36 ** 4;
  return n.toString(36).padStart(4, "0");
}

export type CampaignSummary = {
  slug: string;
  advertiser: string;
  status: StoredCampaign["status"];
  spent: number;
  budget: number;
  impressions: number;
  clicks: number;
};

export type CampaignState = { available: bigint; reserved: bigint };

export type Deps = {
  auth: (req: Request) => Promise<Advertiser | Response>;
  /** Treasury USDC balance, 6 decimals. */
  balance: () => Promise<bigint>;
  launch: (args: LaunchArgs) => Promise<LaunchResult>;
  save: (record: StoredCampaign) => StoredCampaign;
  listByOwner: (ownerId: string) => StoredCampaign[];
  /** True when the slug is a seeded or stored campaign. */
  slugTaken: (slug: string) => boolean;
  /** Onchain `available` and `reserved` of a campaign, or null when unreadable. */
  campaignState: (campaignId: Hex) => Promise<CampaignState | null>;
  limits?: () => LaunchLimits;
  /** True when the request may skip the launch limits. */
  bypass?: (req: Request) => boolean;
  suffix?: () => string;
  now?: () => number;
  /** When set, GET reports it; in wallet mode POST refuses treasury launches. */
  funding?: () => FundingMode;
  /** The caller's embedded wallet, looked up server-side. */
  walletOf?: (userId: string) => Promise<Address | null>;
  addresses?: () => { clearing: Address; usdc: Address };
};

/** Wallet-funded launch: prepare saves a pending record, confirm checks the createCampaign receipt. */
export type WalletDeps = {
  auth: (req: Request) => Promise<Advertiser | Response>;
  funding: () => FundingMode;
  /** The caller's embedded wallet, looked up server-side. */
  walletOf: (userId: string) => Promise<Address | null>;
  getRecord: (slug: string) => StoredCampaign | undefined;
  save: (record: StoredCampaign) => StoredCampaign;
  update: (slug: string, patch: Partial<StoredCampaign>) => StoredCampaign;
  listByOwner: (ownerId: string) => StoredCampaign[];
  /** True when the slug is a seeded or stored campaign. */
  slugTaken: (slug: string) => boolean;
  /** True when the campaign id already has an advertiser onchain. */
  campaignExists: (campaignId: Hex) => Promise<boolean>;
  /** Waits for a mined transaction. */
  receipt: (hash: Hex) => Promise<ConfirmReceipt & { blockNumber: bigint }>;
  check?: typeof checkCampaignCreated;
  addresses: () => { clearing: Address; usdc: Address };
  limits?: () => LaunchLimits;
  bypass?: (req: Request) => boolean;
  suffix?: () => string;
  now?: () => number;
};

type Outcome = { status: number; body: Record<string, unknown> };

function json({ status, body }: Outcome): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

type InFlight = { key: string; outcome: Promise<Outcome> };

// Launches in flight per user, on globalThis so every route bundle shares them.
const globalLaunches = globalThis as typeof globalThis & { __ariaLaunchesInFlight?: Map<string, InFlight> };
const inFlight = (globalLaunches.__ariaLaunchesInFlight ??= new Map<string, InFlight>());

type LimitDeps = Pick<Deps, "limits" | "bypass" | "listByOwner">;

function limitsOf(deps: LimitDeps, req: Request): LaunchLimits {
  return deps.bypass?.(req) ? {} : (deps.limits?.() ?? {});
}

/** The budget cap or launch count refusal for this request, or null. Pending records do not count as launches. */
function limitRefusal(deps: LimitDeps, req: Request, userId: string, input: LaunchInput): Outcome | null {
  const limits = limitsOf(deps, req);
  if (limits.maxBudgetCents !== undefined && input.budgetCents > limits.maxBudgetCents) {
    const error = budgetCapMessage(limits.maxBudgetCents);
    return { status: 400, body: { error, field: "budgetCents", code: "limit" } };
  }
  const launched = deps.listByOwner(userId).filter((r) => r.status !== "pending").length;
  if (limits.perUser !== undefined && launched >= limits.perUser) {
    return { status: 403, body: { error: launchLimitMessage(limits.perUser), code: "limit" } };
  }
  return null;
}

/** `<slugified brand>-<suffix>` not yet taken, or null after SLUG_ATTEMPTS tries. */
async function freshSlugFor(
  brand: string,
  suffix: () => string,
  taken: (slug: string) => boolean | Promise<boolean>,
): Promise<string | null> {
  const base = slugify(brand);
  for (let i = 0; i < SLUG_ATTEMPTS; i++) {
    const slug = `${base}-${suffix()}`;
    if (!(await taken(slug))) return slug;
  }
  return null;
}

/** GET lists the caller's campaigns and the largest budget the treasury can fund; POST launches one. */
export function createCampaignHandlers(deps: Deps) {
  const suffix = deps.suffix ?? randomSuffix;
  const now = deps.now ?? Date.now;
  const limitsFor = (req: Request): LaunchLimits => limitsOf(deps, req);
  const freshSlug = (brand: string) => freshSlugFor(brand, suffix, deps.slugTaken);

  async function launch(userId: string, input: LaunchInput): Promise<Outcome> {
    const units = toUsdcUnits(input);
    let balance: bigint;
    try {
      balance = await deps.balance();
    } catch (err) {
      console.error(`advertise launch: balance read failed: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 502, body: { error: LAUNCH_FAILED } };
    }
    if (balance < units.budget) return { status: 402, body: { error: lowFundsMessage(balance) } };

    for (let attempt = 0; attempt < LAUNCH_ATTEMPTS; attempt++) {
      const slug = await freshSlug(input.brand);
      if (!slug) break;
      let result: LaunchResult;
      try {
        result = await deps.launch({ slug, claims: input.claims, ...units });
      } catch (err) {
        if (err instanceof LaunchError && err.code === "campaign-exists") continue;
        if (err instanceof LaunchError && err.code === "low-funds") {
          return { status: 402, body: { error: lowFundsMessage(err.available ?? 0n) } };
        }
        if (!(err instanceof LaunchError)) {
          console.error(`advertise launch failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return { status: 502, body: { error: LAUNCH_FAILED } };
      }
      // The campaign exists onchain from here, so a failed write is logged and the launch still succeeds.
      try {
        deps.save({
          slug,
          advertiser: input.brand,
          url: input.url,
          category: input.category,
          claims: input.claims,
          keywords: input.keywords,
          priceImpression: Number(units.priceImpression),
          priceClick: Number(units.priceClick),
          budget: Number(units.budget),
          campaignId: result.campaignId,
          ownerId: userId,
          ownerEmail: input.email,
          txHash: result.txHash,
          createdBlock: Number(result.blockNumber),
          createdAt: now(),
          status: "live",
        });
      } catch (err) {
        console.error(
          `advertise save failed for ${slug} (tx ${result.txHash}, block ${result.blockNumber}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { status: 200, body: { slug, txHash: result.txHash } };
    }
    return { status: 409, body: { error: LAUNCH_FAILED } };
  }

  async function walletOrNull(userId: string): Promise<Address | null> {
    try {
      return (await deps.walletOf?.(userId)) ?? null;
    } catch (err) {
      console.error(`advertise wallet lookup failed: ${message(err)}`);
      return null;
    }
  }

  return {
    async GET(req: Request): Promise<Response> {
      const advertiser = await deps.auth(req);
      if (advertiser instanceof Response) return advertiser;

      const records = deps.listByOwner(advertiser.userId).filter((r) => r.status !== "pending");
      const [balance, states] = await Promise.all([
        deps.balance().catch(() => 0n),
        Promise.all(records.map((r) => deps.campaignState(r.campaignId).catch(() => null))),
      ]);
      const campaigns: CampaignSummary[] = records.map((r, i) => {
        const state = states[i];
        const budget = BigInt(r.budget);
        const spent = state ? budget - state.available - state.reserved - BigInt(r.refunded ?? 0) : 0n;
        return {
          slug: r.slug,
          advertiser: r.advertiser,
          status: r.status,
          spent: spent > 0n ? centsOf(spent) : 0,
          budget: centsOf(budget),
          impressions: 0,
          clicks: 0,
        };
      });
      const cap = limitsFor(req).maxBudgetCents;
      const maxBudget = cap === undefined ? centsOf(balance) : Math.min(centsOf(balance), cap);
      const body: Record<string, unknown> = { campaigns, maxBudget };
      if (deps.funding) {
        const funding = deps.funding();
        body.funding = funding;
        if (funding === "wallet") {
          const addresses = deps.addresses?.();
          const address = await walletOrNull(advertiser.userId);
          body.wallet = { address, clearing: addresses?.clearing ?? null, usdc: addresses?.usdc ?? null };
        }
      }
      return json({ status: 200, body });
    },

    async POST(req: Request): Promise<Response> {
      const advertiser = await deps.auth(req);
      if (advertiser instanceof Response) return advertiser;
      if (deps.funding?.() === "wallet") return json({ status: 409, body: { error: LAUNCH_FAILED, code: "wallet" } });

      const body = await req.json().catch(() => null);
      const checked = validateLaunch(body);
      if ("error" in checked) return json({ status: 400, body: { error: checked.error, field: checked.field } });
      const input = checked.value;

      const refusal = limitRefusal(deps, req, advertiser.userId, input);
      if (refusal) return json(refusal);

      // A repeat of the same request while it is in flight gets the same outcome; a different one waits its turn.
      const key = JSON.stringify({ ...input, email: undefined });
      const running = inFlight.get(advertiser.userId);
      if (running) {
        if (running.key === key) return json(await running.outcome);
        return json({ status: 409, body: { error: LAUNCH_IN_PROGRESS } });
      }

      const outcome = launch(advertiser.userId, input);
      inFlight.set(advertiser.userId, { key, outcome });
      try {
        return json(await outcome);
      } finally {
        inFlight.delete(advertiser.userId);
      }
    },
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when a pending record was prepared from the same launch input. */
function samePending(record: StoredCampaign, input: LaunchInput): boolean {
  const units = toUsdcUnits(input);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  return (
    record.status === "pending" &&
    record.advertiser === input.brand &&
    record.url === input.url &&
    record.category === input.category &&
    same(record.claims, input.claims) &&
    same(record.keywords, input.keywords) &&
    BigInt(record.priceImpression) === units.priceImpression &&
    BigInt(record.priceClick) === units.priceClick &&
    BigInt(record.budget) === units.budget
  );
}

/** POST prepare saves a pending campaign and returns the createCampaign call; POST confirm makes it live. */
export function createWalletLaunchHandlers(deps: WalletDeps) {
  const suffix = deps.suffix ?? randomSuffix;
  const now = deps.now ?? Date.now;
  const check = deps.check ?? checkCampaignCreated;

  async function signedIn(req: Request): Promise<Advertiser | Response> {
    const advertiser = await deps.auth(req);
    if (advertiser instanceof Response) return advertiser;
    if (deps.funding() !== "wallet") return json({ status: 404, body: { error: NOT_FOUND } });
    return advertiser;
  }

  async function lookupWallet(userId: string): Promise<Address | Outcome> {
    try {
      const wallet = await deps.walletOf(userId);
      return wallet ?? { status: 409, body: { error: NO_WALLET } };
    } catch (err) {
      console.error(`advertise wallet lookup failed: ${message(err)}`);
      return { status: 502, body: { error: LAUNCH_FAILED } };
    }
  }

  function prepared(record: StoredCampaign, wallet: Address): Outcome {
    const { clearing, usdc } = deps.addresses();
    const createCampaignData = createCampaignCalldata({
      slug: record.slug,
      claims: record.claims,
      priceImpression: BigInt(record.priceImpression),
      priceClick: BigInt(record.priceClick),
      budget: BigInt(record.budget),
    });
    const body = { slug: record.slug, campaignId: record.campaignId, clearing, usdc, budget: String(record.budget) };
    return { status: 200, body: { ...body, createCampaignData, wallet } };
  }

  return {
    /** Launch input → `{slug, campaignId, clearing, usdc, budget, createCampaignData, wallet}`; the record stays pending. */
    async prepare(req: Request): Promise<Response> {
      const advertiser = await signedIn(req);
      if (advertiser instanceof Response) return advertiser;

      const checked = validateLaunch(await req.json().catch(() => null));
      if ("error" in checked) return json({ status: 400, body: { error: checked.error, field: checked.field } });
      const input = checked.value;

      const refusal = limitRefusal(deps, req, advertiser.userId, input);
      if (refusal) return json(refusal);

      const wallet = await lookupWallet(advertiser.userId);
      if (typeof wallet !== "string") return json(wallet);

      const reusable = deps.listByOwner(advertiser.userId).find((r) => samePending(r, input));
      if (reusable) return json(prepared(reusable, wallet));

      let slug: string | null;
      try {
        const taken = async (s: string) => deps.slugTaken(s) || (await deps.campaignExists(campaignIdOf(s)));
        slug = await freshSlugFor(input.brand, suffix, taken);
      } catch (err) {
        console.error(`advertise prepare: campaign read failed: ${message(err)}`);
        return json({ status: 502, body: { error: LAUNCH_FAILED } });
      }
      if (!slug) return json({ status: 409, body: { error: LAUNCH_FAILED } });

      const units = toUsdcUnits(input);
      const record = deps.save({
        slug,
        advertiser: input.brand,
        url: input.url,
        category: input.category,
        claims: input.claims,
        keywords: input.keywords,
        priceImpression: Number(units.priceImpression),
        priceClick: Number(units.priceClick),
        budget: Number(units.budget),
        campaignId: campaignIdOf(slug),
        ownerId: advertiser.userId,
        ownerEmail: input.email,
        txHash: "0x",
        createdBlock: 0,
        createdAt: now(),
        status: "pending",
        funding: "wallet",
      });
      return json(prepared(record, wallet));
    },

    /** `{slug, txHash}` → `{slug, txHash}` once the receipt's CampaignCreated log matches the pending record. */
    async confirm(req: Request): Promise<Response> {
      const advertiser = await signedIn(req);
      if (advertiser instanceof Response) return advertiser;

      const body = (await req.json().catch(() => null)) as { slug?: unknown; txHash?: unknown } | null;
      const slug = typeof body?.slug === "string" ? body.slug : "";
      const record = deps.getRecord(slug);
      if (!record || record.ownerId !== advertiser.userId) {
        return json({ status: 404, body: { error: CAMPAIGN_NOT_FOUND } });
      }
      if (typeof body?.txHash !== "string" || !TX_HASH.test(body.txHash)) {
        return json({ status: 400, body: { error: CONFIRM_FAILED } });
      }
      const txHash = body.txHash.toLowerCase() as Hex;

      if (record.status !== "pending") {
        if (record.txHash.toLowerCase() === txHash) return json({ status: 200, body: { slug, txHash: record.txHash } });
        return json({ status: 409, body: { error: CONFIRM_CONFLICT } });
      }

      const wallet = await lookupWallet(advertiser.userId);
      if (typeof wallet !== "string") return json(wallet);

      let receipt: ConfirmReceipt & { blockNumber: bigint };
      try {
        receipt = await deps.receipt(txHash);
      } catch (err) {
        console.error(`advertise confirm: receipt for ${txHash} failed: ${message(err)}`);
        return json({ status: 502, body: { error: CONFIRM_FAILED } });
      }

      const problem = check(receipt, deps.addresses().clearing, record, wallet);
      if (problem) {
        console.warn(`advertise confirm refused for ${slug} (tx ${txHash}): ${problem}`);
        return json({ status: 422, body: { error: CONFIRM_MISMATCH } });
      }

      deps.update(slug, {
        status: "live",
        txHash,
        createdBlock: Number(receipt.blockNumber),
        advertiserAddress: wallet,
        funding: "wallet",
      });
      return json({ status: 200, body: { slug, txHash } });
    },
  };
}
