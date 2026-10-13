// Client for /api/advertise/*. Money fields are whole US cents.
// NEXT_PUBLIC_ADVERTISE_MOCK=1 swaps in an in-memory fake with the same contract.

import { demoKeyHeaders } from "./demo-key-client";

export type DraftInput = { brand: string; url: string; description: string };
export type DraftResult = { claims: string[]; category: string; keywords: string[] } | { manual: true };

export type SiteDraftInput = { url: string; brand?: string };
export type SiteManualReason = "unreachable" | "empty" | "draft_failed";
export type SiteDraft = { brand: string; description: string; claims: string[]; category: string; keywords: string[] };
export type SiteDraftResult = SiteDraft | { manual: true; reason: SiteManualReason };

export type CampaignStatus = "live" | "ending" | "ended";
export type CampaignSummary = {
  slug: string;
  advertiser: string;
  status: CampaignStatus;
  spent: number;
  budget: number;
  impressions: number;
  clicks: number;
};
/** wallet: the advertiser's embedded wallet funds launches. treasury: Aria's treasury does. */
export type FundingMode = "wallet" | "treasury";
/** The signed-in advertiser's embedded wallet (looked up by the server) and the contracts it pays. */
export type WalletInfo = { address: string | null; clearing: string; usdc: string };
export type CampaignsResponse = {
  campaigns: CampaignSummary[];
  maxBudget: number;
  funding?: FundingMode;
  /** Present in wallet mode. */
  wallet?: WalletInfo;
};

export type LaunchInput = DraftInput & {
  claims: string[];
  category: string;
  keywords: string[];
  budgetCents: number;
  cpcCents: number;
  cpmCents: number;
  /** The signed-in user's email, display only. */
  email?: string;
};
export type LaunchResult = { slug: string; txHash: string } | { error: string };
export type DisputeResult = { txHash: string } | { error: string };
/** A pending wallet-funded campaign. `budget` is USDC units as a decimal string; `createCampaignData` is built by the server. */
export type Prepared = {
  slug: string;
  campaignId: string;
  clearing: string;
  usdc: string;
  budget: string;
  createCampaignData: `0x${string}`;
  wallet: string;
};
export type PrepareResult = Prepared | { error: string };
export type ConfirmResult = { slug: string; txHash: string } | { error: string };
/** `usdc` in USDC units and `mon` in wei, as decimal strings; zero when the wallet already held enough. */
export type TestFundsResult = { usdc: string; mon: string; usdcTx: string | null; monTx: string | null } | { error: string };
/** `refunded` is in cents. */
export type EndResult = { refunded: number; txHash: string } | { error: string };

export type AdvertiseClient = {
  draft(input: DraftInput): Promise<DraftResult>;
  /** Reads the website and drafts brand, description, claims, category and topics from it. */
  draftFromSite(input: SiteDraftInput): Promise<SiteDraftResult>;
  listCampaigns(): Promise<CampaignsResponse>;
  launch(input: LaunchInput): Promise<LaunchResult>;
  /** With `txHash`, reports a dispute the advertiser's wallet sent; without, the server sends it. */
  dispute(slug: string, eventId: string, txHash?: string): Promise<DisputeResult>;
  endCampaign(slug: string): Promise<EndResult>;
  /** Marks a wallet-funded campaign as ending and returns its campaign id for the wallet's withdraw. */
  beginWalletEnd(slug: string): Promise<{ campaignId: string } | { error: string }>;
  /** Reports the wallet's withdraw transaction. */
  finishWalletEnd(slug: string, txHash: string): Promise<EndResult>;
  /** Puts an ending wallet-funded campaign back to live after the wallet did not withdraw. */
  cancelWalletEnd(slug: string): Promise<void>;
  /** Saves a pending wallet-funded campaign and returns the escrow call for the advertiser's wallet. */
  prepare(input: LaunchInput): Promise<PrepareResult>;
  /** Asks the server to check the createCampaign transaction and make the campaign live. */
  confirm(slug: string, txHash: string): Promise<ConfirmResult>;
  /** Asks Aria to send test USDC and MON to the advertiser's wallet. */
  addTestFunds(budgetCents: number): Promise<TestFundsResult>;
};

export const DISPUTE_FAILED = "We couldn't dispute this one right now. Try again in a few seconds.";
export const END_FAILED = "We couldn't end your campaign right now. Nothing changed. Try again in a minute.";
export const TEST_FUNDS_FAILED = "We couldn't add test funds right now. Try again in a minute.";

export type GetToken = () => Promise<string | null>;

export const ADVERTISE_MOCK = process.env.NEXT_PUBLIC_ADVERTISE_MOCK === "1";

/** Calls the real routes with `Authorization: Bearer <Privy access token>`. */
export function createHttpClient(getToken: GetToken, fetchImpl: typeof fetch = fetch): AdvertiseClient {
  async function call<T>(path: string, init?: { method: string; body: unknown }): Promise<{ ok: boolean; body: T }> {
    const token = await getToken();
    const res = await fetchImpl(path, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: {
        ...(init ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...demoKeyHeaders(),
      },
      body: init ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, body };
  }

  return {
    async draft(input) {
      try {
        const { ok, body } = await call<DraftResult>("/api/advertise/draft", { method: "POST", body: input });
        return ok && ("manual" in body || Array.isArray(body.claims)) ? body : { manual: true };
      } catch {
        return { manual: true };
      }
    },
    async draftFromSite({ url, brand }) {
      const failed = { manual: true, reason: "draft_failed" } as const;
      try {
        const input = brand ? { url, brand } : { url };
        const { ok, body } = await call<SiteDraftResult>("/api/advertise/draft", { method: "POST", body: input });
        if (!ok) return failed;
        if ("manual" in body) return { manual: true, reason: body.reason ?? "draft_failed" };
        return typeof body.brand === "string" && typeof body.description === "string" && Array.isArray(body.claims)
          ? body
          : failed;
      } catch {
        return failed;
      }
    },
    async listCampaigns() {
      const { ok, body } = await call<CampaignsResponse & { error?: string }>("/api/advertise/campaigns");
      if (!ok) throw new Error(body.error ?? "Could not load campaigns");
      return body;
    },
    async launch(input) {
      try {
        const { ok, body } = await call<LaunchResult>("/api/advertise/campaigns", { method: "POST", body: input });
        if (!ok && !("error" in body)) return { error: "" };
        return body;
      } catch {
        return { error: "" };
      }
    },
    async dispute(slug, eventId, txHash) {
      const path = `/api/advertise/campaigns/${encodeURIComponent(slug)}/dispute`;
      try {
        const { ok, body } = await call<DisputeResult>(path, { method: "POST", body: { eventId, txHash } });
        if (ok && "txHash" in body) return body;
        return { error: ("error" in body && body.error) || DISPUTE_FAILED };
      } catch {
        return { error: DISPUTE_FAILED };
      }
    },
    async endCampaign(slug) {
      const path = `/api/advertise/campaigns/${encodeURIComponent(slug)}/end`;
      try {
        const { ok, body } = await call<EndResult>(path, { method: "POST", body: {} });
        if (ok && "refunded" in body) return body;
        return { error: ("error" in body && body.error) || END_FAILED };
      } catch {
        return { error: END_FAILED };
      }
    },
    async beginWalletEnd(slug) {
      const path = `/api/advertise/campaigns/${encodeURIComponent(slug)}/end`;
      try {
        const { ok, body } = await call<{ campaignId?: string; error?: string }>(path, { method: "POST", body: {} });
        if (ok && typeof body.campaignId === "string") return { campaignId: body.campaignId };
        return { error: body.error || END_FAILED };
      } catch {
        return { error: END_FAILED };
      }
    },
    async finishWalletEnd(slug, txHash) {
      const path = `/api/advertise/campaigns/${encodeURIComponent(slug)}/end`;
      try {
        const { ok, body } = await call<EndResult>(path, { method: "POST", body: { txHash } });
        if (ok && "refunded" in body) return body;
        return { error: ("error" in body && body.error) || END_FAILED };
      } catch {
        return { error: END_FAILED };
      }
    },
    async cancelWalletEnd(slug) {
      const path = `/api/advertise/campaigns/${encodeURIComponent(slug)}/end`;
      await call(path, { method: "POST", body: { cancel: true } }).catch(() => undefined);
    },
    async prepare(input) {
      try {
        const { ok, body } = await call<PrepareResult>("/api/advertise/campaigns/prepare", { method: "POST", body: input });
        if (ok && "createCampaignData" in body) return body;
        return { error: ("error" in body && body.error) || "" };
      } catch {
        return { error: "" };
      }
    },
    async confirm(slug, txHash) {
      try {
        const { ok, body } = await call<ConfirmResult>("/api/advertise/campaigns/confirm", {
          method: "POST",
          body: { slug, txHash },
        });
        if (ok && "txHash" in body) return body;
        return { error: ("error" in body && body.error) || "" };
      } catch {
        return { error: "" };
      }
    },
    async addTestFunds(budgetCents) {
      try {
        const { ok, body } = await call<TestFundsResult>("/api/advertise/test-funds", { method: "POST", body: { budgetCents } });
        if (ok && "usdc" in body) return body;
        return { error: ("error" in body && body.error) || TEST_FUNDS_FAILED };
      } catch {
        return { error: TEST_FUNDS_FAILED };
      }
    },
  };
}

export type MockOptions = {
  delayMs?: number;
  campaigns?: CampaignSummary[];
  maxBudget?: number;
};

const MOCK_CLAIMS = [
  "Compact espresso machines for kitchens.",
  "15-bar pump with a steam wand.",
  "Free shipping in the EU in 3 days.",
  "Two-year warranty on every machine.",
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const MOCK_SITE = {
  brand: "Crema Works",
  description:
    "Crema Works sells compact espresso machines for home kitchens. They are made for people who want café-style espresso in a small space.",
};

/**
 * In-memory fake. Brand "Manual" drafts nothing ({manual:true}); a website whose host starts with "manual." can't be
 * read; brand "Fail" makes launch return an error. Launched campaigns are added to the list.
 */
export function createMockClient({ delayMs = 800, campaigns = [], maxBudget = 1840 }: MockOptions = {}): AdvertiseClient {
  const list = [...campaigns];
  return {
    async draft({ brand }) {
      await wait(delayMs);
      if (brand.trim().toLowerCase() === "manual") return { manual: true };
      return { claims: MOCK_CLAIMS, category: "food and drink", keywords: ["home espresso", "espresso machine", "coffee at home"] };
    },
    async draftFromSite({ url, brand }) {
      await wait(delayMs * 2);
      if (/^https:\/\/manual\./i.test(url.trim())) return { manual: true, reason: "unreachable" };
      return {
        ...MOCK_SITE,
        brand: brand?.trim() || MOCK_SITE.brand,
        claims: MOCK_CLAIMS,
        category: "food and drink",
        keywords: ["home espresso", "espresso machine", "coffee at home"],
      };
    },
    async listCampaigns() {
      await wait(delayMs / 2);
      return { campaigns: [...list], maxBudget };
    },
    async launch(input) {
      await wait(delayMs * 3);
      if (input.brand.trim().toLowerCase() === "fail") return { error: "launch failed" };
      const slug = `${slugify(input.brand)}-${Math.random().toString(36).slice(2, 6)}`;
      list.unshift({ slug, advertiser: input.brand.trim(), status: "live", spent: 0, budget: input.budgetCents, impressions: 0, clicks: 0 });
      return { slug, txHash: `mock-${slug}` };
    },
    async dispute(_slug, eventId) {
      await wait(delayMs);
      return { txHash: `mock-dispute-${eventId}` };
    },
    async endCampaign(slug) {
      await wait(delayMs * 2);
      const campaign = list.find((c) => c.slug === slug);
      if (campaign) campaign.status = "ended";
      return { refunded: campaign ? campaign.budget - campaign.spent : 0, txHash: `mock-end-${slug}` };
    },
    async beginWalletEnd() {
      return { error: END_FAILED };
    },
    async finishWalletEnd() {
      return { error: END_FAILED };
    },
    async cancelWalletEnd() {},
    async prepare() {
      await wait(delayMs);
      return { error: "Wallet funding is not available in the mock." };
    },
    async confirm() {
      await wait(delayMs);
      return { error: "Wallet funding is not available in the mock." };
    },
    async addTestFunds() {
      await wait(delayMs);
      return { usdc: "0", mon: "0", usdcTx: null, monTx: null };
    },
  };
}

/** The mock when NEXT_PUBLIC_ADVERTISE_MOCK=1, otherwise the HTTP client. */
export function createAdvertiseClient(getToken: GetToken): AdvertiseClient {
  return ADVERTISE_MOCK ? mockSingleton() : createHttpClient(getToken);
}

let mock: AdvertiseClient | undefined;
function mockSingleton(): AdvertiseClient {
  mock ??= createMockClient();
  return mock;
}
