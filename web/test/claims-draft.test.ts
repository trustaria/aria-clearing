import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/advertise/draft/route";
import {
  CATEGORIES,
  draftClaims,
  draftFromSite,
  normalizeClaim,
  normalizeClaims,
  stubDraft,
  stubSiteDraft,
  validateDraft,
  validateSiteDraft,
  type Ask,
} from "../lib/claims-draft";
import { readSite, type Site, type SiteResult } from "../lib/site-reader";

vi.mock("@/lib/advertiser-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/advertiser-auth")>()),
  verifyAdvertiser: async () => ({ userId: "did:privy:test" }),
}));

vi.mock("../lib/site-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/site-reader")>()),
  readSite: vi.fn(),
}));

const SAMPLE = {
  brand: "Crema Works",
  url: "https://crema.works",
  description:
    "Crema Works makes compact espresso machines for small kitchens. Every machine has a 15-bar pump and a steam wand. " +
    "We ship free across the EU in 3 days. Each machine comes with a two-year warranty.",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeClaim", () => {
  it("strips a leading list number", () => {
    expect(normalizeClaim("1. Foo bar baz qux")).toBe("Foo bar baz qux");
    expect(normalizeClaim("2) Foo bar baz qux")).toBe("Foo bar baz qux");
  });

  it("trims, collapses whitespace and removes newlines", () => {
    expect(normalizeClaim("  Foo \n\t bar   baz  ")).toBe("Foo bar baz");
  });

  it("applies NFC", () => {
    expect(normalizeClaim("Café machines")).toBe("Café machines");
  });
});

describe("normalizeClaims", () => {
  it("accepts 1 to 5 valid claims", () => {
    expect(normalizeClaims(["1. Foo bar baz qux"])).toEqual(["Foo bar baz qux"]);
  });

  it("rejects too long, too short, empty list, more than five, non-strings", () => {
    expect(normalizeClaims(["x".repeat(121)])).toBeNull();
    expect(normalizeClaims(["too short"])).toBeNull();
    expect(normalizeClaims([])).toBeNull();
    expect(normalizeClaims(Array(6).fill("A valid claim here"))).toBeNull();
    expect(normalizeClaims([42])).toBeNull();
    expect(normalizeClaims("nope")).toBeNull();
  });

  it("accepts the 10 and 120 character bounds", () => {
    expect(normalizeClaims(["x".repeat(10), "y".repeat(120)])).toHaveLength(2);
  });

  it("treats a newline inside a claim as whitespace", () => {
    expect(normalizeClaims(["Foo bar\nbaz qux"])).toEqual(["Foo bar baz qux"]);
  });
});

describe("validateDraft", () => {
  const ok = {
    claims: ["1. Compact espresso machines.", "15-bar pump with a steam wand.", "Two-year warranty."],
    category: "Food and drink",
    keywords: ["Espresso machine", "espresso machine", "home coffee"],
  };

  it("normalises a valid draft", () => {
    expect(validateDraft(ok)).toEqual({
      claims: ["Compact espresso machines.", "15-bar pump with a steam wand.", "Two-year warranty."],
      category: "food and drink",
      keywords: ["espresso machine", "home coffee"],
    });
  });

  it("returns null for bad shapes, categories or claim counts", () => {
    expect(validateDraft(null)).toBeNull();
    expect(validateDraft({ ...ok, category: "weapons" })).toBeNull();
    expect(validateDraft({ ...ok, claims: ok.claims.slice(0, 2) })).toBeNull();
    expect(validateDraft({ ...ok, claims: "text" })).toBeNull();
  });

  it("caps keywords at six", () => {
    const keywords = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
    expect(validateDraft({ ...ok, keywords })?.keywords).toHaveLength(6);
  });
});

describe("stubDraft", () => {
  it("builds a draft from the description", () => {
    const draft = stubDraft(SAMPLE);
    if ("manual" in draft) throw new Error("expected a draft");
    expect(draft.claims.length).toBeGreaterThanOrEqual(3);
    expect(draft.claims.length).toBeLessThanOrEqual(4);
    expect(normalizeClaims(draft.claims)).toEqual(draft.claims);
    expect(draft.claims[0]).toContain("compact espresso machines");
    expect(draft.category).toBe("food and drink");
    expect(CATEGORIES).toContain(draft.category);
    expect(draft.keywords.length).toBeGreaterThan(0);
    expect(draft.keywords.length).toBeLessThanOrEqual(6);
    expect(draft.keywords).toContain("espresso");
  });

  it("is deterministic", () => {
    expect(stubDraft(SAMPLE)).toEqual(stubDraft(SAMPLE));
  });

  it("falls back to manual when the description has too few usable facts", () => {
    expect(stubDraft({ ...SAMPLE, description: "Tiny." })).toEqual({ manual: true });
  });
});

describe("draftClaims", () => {
  it("uses the stub without a KIMI key", async () => {
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(await draftClaims(SAMPLE)).toEqual(stubDraft(SAMPLE));
  });

  it("returns manual when KIMI is unavailable (no key in production)", async () => {
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await draftClaims(SAMPLE)).toEqual({ manual: true });
  });

  it("returns manual when the KIMI call fails, never the stub", async () => {
    vi.stubEnv("KIMI_API_KEY", "test-key");
    vi.stubEnv("KIMI_MODEL", "");
    expect(await draftClaims(SAMPLE)).toEqual({ manual: true });
  });
});

describe("POST /api/advertise/draft", () => {
  const post = (body: unknown) =>
    POST(new Request("http://x/api/advertise/draft", { method: "POST", body: JSON.stringify(body) }));

  it("returns field errors for invalid input", async () => {
    const res = await post({ brand: "A", url: "http://crema.works", description: "short" });
    expect(res.status).toBe(400);
    const { errors } = await res.json();
    expect(Object.keys(errors).sort()).toEqual(["brand", "description", "url"]);
  });

  it("rejects a non-JSON body", async () => {
    const res = await POST(new Request("http://x/api/advertise/draft", { method: "POST", body: "nope" }));
    expect(res.status).toBe(400);
  });

  it("returns a draft for valid input", async () => {
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    const res = await post(SAMPLE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claims.length).toBeGreaterThanOrEqual(3);
  });
});

const SITE: Site = {
  url: "https://www.crema.works/",
  title: "Compact espresso at home – Crema Works",
  description: "Crema Works makes compact espresso machines for small kitchens.",
  ogTitle: "Crema Works",
  ogDescription: "",
  siteName: "",
  text:
    "Espresso for small kitchens. Every machine has a 15-bar pump and a steam wand. " +
    "Only €349 this week. We ship free across the EU in 3 days. The best espresso machine in Europe. " +
    "Each machine comes with a two-year warranty.",
};

const SITE_DRAFT = {
  brand: "Crema Works",
  description:
    "Crema Works sells compact espresso machines for home kitchens. They are made for people who want café espresso in a small space.",
  claims: [
    "Compact espresso machines for small kitchens.",
    "Every machine has a 15-bar pump and a steam wand.",
    "Free shipping across the EU in 3 days.",
    "Two-year warranty on every machine.",
  ],
  category: "food and drink",
  keywords: ["home espresso machine", "compact espresso"],
};

const read = (result: SiteResult) => vi.fn(async () => result);
const ask = (reply: unknown) => vi.fn<Ask>(async () => JSON.stringify(reply));

describe("validateSiteDraft", () => {
  it("keeps a valid draft and normalises it", () => {
    expect(validateSiteDraft({ ...SITE_DRAFT, description: `  ${SITE_DRAFT.description}\n` }, SITE)).toEqual(SITE_DRAFT);
  });

  it("drops claims with prices or superlatives and fails below three", () => {
    const claims = [...SITE_DRAFT.claims.slice(0, 2), "Only €349 this week.", "The best espresso machine in Europe."];
    expect(validateSiteDraft({ ...SITE_DRAFT, claims }, SITE)).toBeNull();
    const kept = validateSiteDraft({ ...SITE_DRAFT, claims: [...SITE_DRAFT.claims, "Machines from $299."] }, SITE);
    expect(kept?.claims).toEqual(SITE_DRAFT.claims);
  });

  it("uses the advertiser's brand name over the model's", () => {
    expect(validateSiteDraft({ ...SITE_DRAFT, brand: "Crema" }, SITE, "Crema Works Ltd")?.brand).toBe("Crema Works Ltd");
  });

  it("falls back to the page's brand when the model's is unusable", () => {
    expect(validateSiteDraft({ ...SITE_DRAFT, brand: "" }, SITE)?.brand).toBe("Crema Works");
    expect(validateSiteDraft({ ...SITE_DRAFT, brand: "x".repeat(41) }, SITE)?.brand).toBe("Crema Works");
  });

  it("rejects a description outside 40 to 1,500 characters", () => {
    expect(validateSiteDraft({ ...SITE_DRAFT, description: "Espresso." }, SITE)).toBeNull();
    expect(validateSiteDraft({ ...SITE_DRAFT, description: "x".repeat(1501) }, SITE)).toBeNull();
    expect(validateSiteDraft({ ...SITE_DRAFT, description: 42 }, SITE)).toBeNull();
  });

  it("rejects a bad category or claim list", () => {
    expect(validateSiteDraft({ ...SITE_DRAFT, category: "weapons" }, SITE)).toBeNull();
    expect(validateSiteDraft({ ...SITE_DRAFT, claims: SITE_DRAFT.claims.slice(0, 2) }, SITE)).toBeNull();
    expect(validateSiteDraft(null, SITE)).toBeNull();
  });
});

describe("stubSiteDraft", () => {
  it("builds brand, description and claims from the title, meta description and text", () => {
    const draft = stubSiteDraft(SITE);
    if ("manual" in draft) throw new Error("expected a draft");
    expect(draft.brand).toBe("Crema Works");
    expect(draft.description).toBe(SITE.description);
    expect(draft.claims.length).toBeGreaterThanOrEqual(3);
    expect(draft.claims.join(" ")).not.toMatch(/€|best/);
    expect(draft.category).toBe("food and drink");
  });

  it("is manual when the page has too few facts", () => {
    expect(stubSiteDraft({ ...SITE, description: "Hi.", text: "Hello." })).toEqual({ manual: true, reason: "draft_failed" });
  });
});

describe("draftFromSite", () => {
  it("drafts with KIMI from the page text", async () => {
    vi.stubEnv("KIMI_API_KEY", "test-key");
    const reply = ask(SITE_DRAFT);
    const result = await draftFromSite("https://crema.works", {}, { read: read({ site: SITE }), ask: reply });
    expect(result).toEqual(SITE_DRAFT);
    const [system, user] = reply.mock.calls[0];
    expect(system).toMatch(/only facts stated in the page text/i);
    expect(user).toContain(SITE.text);
    expect(user).toContain(SITE.description);
  });

  it("is manual with a reason when the site cannot be read", async () => {
    vi.stubEnv("KIMI_API_KEY", "test-key");
    const reply = ask(SITE_DRAFT);
    for (const [error, reason] of [
      ["unreachable", "unreachable"],
      ["blocked", "unreachable"],
      ["too_many_redirects", "unreachable"],
      ["empty", "empty"],
      ["not_html", "empty"],
    ] as const) {
      expect(await draftFromSite("https://crema.works", {}, { read: read({ error }), ask: reply })).toEqual({
        manual: true,
        reason,
      });
    }
    expect(reply).not.toHaveBeenCalled();
  });

  it("is manual when KIMI fails or returns an unusable draft", async () => {
    vi.stubEnv("KIMI_API_KEY", "test-key");
    const failing: Ask = async () => {
      throw new Error("down");
    };
    const deps = { read: read({ site: SITE }) };
    const manual = { manual: true, reason: "draft_failed" };
    expect(await draftFromSite("https://crema.works", {}, { ...deps, ask: failing })).toEqual(manual);
    expect(await draftFromSite("https://crema.works", {}, { ...deps, ask: ask({ claims: [] }) })).toEqual(manual);
    expect(await draftFromSite("https://crema.works", {}, { ...deps, ask: async () => "not json" })).toEqual(manual);
  });

  it("uses the stub without a KIMI key", async () => {
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(await draftFromSite("https://crema.works", {}, { read: read({ site: SITE }) })).toEqual(stubSiteDraft(SITE));
  });
});

describe("POST /api/advertise/draft with a website only", () => {
  const post = (body: unknown) =>
    POST(new Request("http://x/api/advertise/draft", { method: "POST", body: JSON.stringify(body) }));

  it("reads the site and returns brand, description and claims", async () => {
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(readSite).mockResolvedValueOnce({ site: SITE });
    const res = await post({ url: "https://crema.works" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brand).toBe("Crema Works");
    expect(body.description).toBe(SITE.description);
    expect(body.claims.length).toBeGreaterThanOrEqual(3);
    expect(readSite).toHaveBeenCalledWith("https://crema.works");
  });

  it("passes a brand name hint through", async () => {
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(readSite).mockResolvedValueOnce({ site: SITE });
    const body = await (await post({ url: "https://crema.works", brand: "Crema Works Ltd" })).json();
    expect(body.brand).toBe("Crema Works Ltd");
  });

  it("returns manual with a reason when the site is unreachable", async () => {
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(readSite).mockResolvedValueOnce({ error: "blocked" });
    const res = await post({ url: "https://crema.works" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ manual: true, reason: "unreachable" });
  });

  it("rejects a website that is not https", async () => {
    const res = await post({ url: "http://crema.works" });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).errors)).toEqual(["url"]);
  });
});
