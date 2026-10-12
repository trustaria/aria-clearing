import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import type { Advertiser } from "../../../../lib/advertiser-auth";
import type { StoredCampaign } from "../../../../lib/campaign-store";
import { CATEGORIES, KEYWORDS_LIMIT, normalizeClaims, type Category } from "../../../../lib/claims-draft";
import { LaunchError, type LaunchArgs, type LaunchResult } from "../../../../lib/treasury";

/** USDC units (6 decimals) per US cent. */
const UNITS_PER_CENT = 10_000n;
const SLUG_ATTEMPTS = 5;
const LAUNCH_ATTEMPTS = 3;

export const LAUNCH_FAILED = "We couldn't launch right now. Nothing was charged. Try again in a minute.";
export const LAUNCH_IN_PROGRESS = "Your last campaign is still launching. Try again in a moment.";

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

/** GET lists the caller's campaigns and the largest budget the treasury can fund; POST launches one. */
export function createCampaignHandlers(deps: Deps) {
  const suffix = deps.suffix ?? randomSuffix;
  const now = deps.now ?? Date.now;

  function freshSlug(brand: string): string | null {
    const base = slugify(brand);
    for (let i = 0; i < SLUG_ATTEMPTS; i++) {
      const slug = `${base}-${suffix()}`;
      if (!deps.slugTaken(slug)) return slug;
    }
    return null;
  }

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
      const slug = freshSlug(input.brand);
      if (!slug) break;
      try {
        const result = await deps.launch({ slug, claims: input.claims, ...units });
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
        return { status: 200, body: { slug, txHash: result.txHash } };
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
    }
    return { status: 409, body: { error: LAUNCH_FAILED } };
  }

  return {
    async GET(req: Request): Promise<Response> {
      const advertiser = await deps.auth(req);
      if (advertiser instanceof Response) return advertiser;

      const records = deps.listByOwner(advertiser.userId);
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
      return json({ status: 200, body: { campaigns, maxBudget: centsOf(balance) } });
    },

    async POST(req: Request): Promise<Response> {
      const advertiser = await deps.auth(req);
      if (advertiser instanceof Response) return advertiser;

      const body = await req.json().catch(() => null);
      const checked = validateLaunch(body);
      if ("error" in checked) return json({ status: 400, body: { error: checked.error, field: checked.field } });
      const input = checked.value;

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
