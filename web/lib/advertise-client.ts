// Client for /api/advertise/*. Money fields are whole US cents.
// NEXT_PUBLIC_ADVERTISE_MOCK=1 swaps in an in-memory fake with the same contract.

export type DraftInput = { brand: string; url: string; description: string };
export type DraftResult = { claims: string[]; category: string; keywords: string[] } | { manual: true };

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
export type CampaignsResponse = { campaigns: CampaignSummary[]; maxBudget: number };

export type LaunchInput = DraftInput & {
  claims: string[];
  category: string;
  keywords: string[];
  budgetCents: number;
  cpcCents: number;
  cpmCents: number;
};
export type LaunchResult = { slug: string; txHash: string } | { error: string };

export type AdvertiseClient = {
  draft(input: DraftInput): Promise<DraftResult>;
  listCampaigns(): Promise<CampaignsResponse>;
  launch(input: LaunchInput): Promise<LaunchResult>;
};

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

/**
 * In-memory fake. Brand "Manual" drafts nothing ({manual:true}); brand "Fail" makes launch return an error.
 * Launched campaigns are added to the list.
 */
export function createMockClient({ delayMs = 800, campaigns = [], maxBudget = 1840 }: MockOptions = {}): AdvertiseClient {
  const list = [...campaigns];
  return {
    async draft({ brand }) {
      await wait(delayMs);
      if (brand.trim().toLowerCase() === "manual") return { manual: true };
      return { claims: MOCK_CLAIMS, category: "food and drink", keywords: ["home espresso", "espresso machine", "coffee at home"] };
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
