import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/advertise/draft/route";
import {
  CATEGORIES,
  draftClaims,
  normalizeClaim,
  normalizeClaims,
  stubDraft,
  validateDraft,
} from "../lib/claims-draft";

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
