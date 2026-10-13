import { afterEach, describe, expect, it, vi } from "vitest";
import { validatePick } from "../lib/pick";
import { describeCampaigns, PICK_SYSTEM, pickPrompt, selectAd, type Picker } from "../lib/serve/select";
import { stubPick } from "../lib/stub";
import { campaigns, keywordCampaigns, lisbon } from "./fixtures";

const SENTENCE = "Every package includes airport transfers.";
const GOOD = { intent: "commercial", slug: lisbon.slug, claimRefs: [4], sentence: SENTENCE };

const answering = (raw: unknown): Picker => vi.fn(async () => raw);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selectAd with a model picker", () => {
  it("serves the validated pick", async () => {
    const out = await selectAd({ prompt: "Lisbon with kids, what should I book?", campaigns }, answering(GOOD));
    expect(out).toEqual({
      decision: "served",
      pick: { slug: lisbon.slug, rationale: SENTENCE, claimRefs: [4] },
      intent: "commercial",
      source: "model",
    });
  });

  it("passes prompt, context and campaigns to the picker", async () => {
    const picker = answering(GOOD);
    await selectAd({ prompt: "What should I book?", context: "Lisbon with kids", campaigns }, picker);
    expect(picker).toHaveBeenCalledWith({ prompt: "What should I book?", context: "Lisbon with kids", campaigns });
  });

  it("strips claim markers from the sentence", async () => {
    const out = await selectAd({ prompt: "q", campaigns }, answering({ ...GOOD, sentence: "Airport transfers are included (4)." }));
    expect(out).toMatchObject({ decision: "served", pick: { rationale: "Airport transfers are included." } });
  });

  it("is a not_monetizable no-fill when the slug is null", async () => {
    const raw = { intent: "informational", slug: null, claimRefs: [], sentence: "" };
    expect(await selectAd({ prompt: "What is RAM?", campaigns }, answering(raw))).toEqual({
      decision: "no_fill",
      reason: "not_monetizable",
      intent: "informational",
      source: "model",
    });
  });

  it("is a not_monetizable no-fill when the intent is not commercial, even with a slug", async () => {
    const out = await selectAd({ prompt: "q", campaigns }, answering({ ...GOOD, intent: "sensitive" }));
    expect(out).toMatchObject({ decision: "no_fill", reason: "not_monetizable", intent: "sensitive" });
  });

  it.each([
    ["an unknown slug", { ...GOOD, slug: "nope" }],
    ["out-of-range claim refs", { ...GOOD, claimRefs: [9] }],
    ["an over-long sentence", { ...GOOD, sentence: "x".repeat(400) }],
    ["a missing sentence", { intent: "commercial", slug: lisbon.slug, claimRefs: [4] }],
    ["a non-object", "lisbon"],
  ])("is a no_candidates no-fill for %s", async (_name, raw) => {
    const out = await selectAd({ prompt: "q", campaigns }, answering(raw));
    expect(out).toMatchObject({ decision: "no_fill", reason: "no_candidates", source: "model" });
  });

  it("falls back to the keyword selector when the picker fails, and logs why", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const picker: Picker = async () => {
      throw new Error("400 thinking level not supported");
    };
    const prompt = "Family trip to Lisbon next spring";
    const out = await selectAd({ prompt, campaigns: keywordCampaigns }, picker);
    expect(out).toEqual({
      decision: "served",
      pick: validatePick(stubPick(prompt, keywordCampaigns), keywordCampaigns),
      intent: "commercial",
      source: "keyword",
    });
    expect(warn.mock.calls.flat().join(" ")).toContain("400 thinking level not supported");
  });

  it("skips the picker when no campaign is live", async () => {
    const picker = answering(GOOD);
    expect(await selectAd({ prompt: "Lisbon trip", campaigns: [] }, picker)).toEqual({
      decision: "no_fill",
      reason: "no_candidates",
      intent: null,
      source: "none",
    });
    expect(picker).not.toHaveBeenCalled();
  });
});

describe("selectAd with the keyword selector", () => {
  it("serves the keyword pick", async () => {
    const out = await selectAd({ prompt: "Family trip to Lisbon next spring", campaigns: keywordCampaigns }, null);
    expect(out).toMatchObject({ decision: "served", pick: { slug: lisbon.slug }, source: "keyword" });
  });

  it("is a not_monetizable no-fill when no keyword matches", async () => {
    expect(await selectAd({ prompt: "What's the difference between RAM and storage?", campaigns: keywordCampaigns }, null)).toEqual({
      decision: "no_fill",
      reason: "not_monetizable",
      intent: null,
      source: "keyword",
    });
  });
});

describe("pick prompt", () => {
  it("asks for intent, slug, claimRefs and sentence as JSON", () => {
    expect(PICK_SYSTEM).toContain('"slug": string | null');
    expect(PICK_SYSTEM).toContain('"sentence": string');
    expect(PICK_SYSTEM).toContain('"claimRefs": number[]');
  });

  it("lists the campaigns, the previous message and the question", () => {
    const text = pickPrompt({ prompt: "What should I book?", context: "Lisbon with kids", campaigns });
    expect(text).toContain(describeCampaigns(campaigns));
    expect(text).toContain("Previous message: Lisbon with kids");
    expect(text.trimEnd().endsWith("Question: What should I book?")).toBe(true);
  });

  it("leaves out the previous message when there is none", () => {
    expect(pickPrompt({ prompt: "q", campaigns })).not.toContain("Previous message");
  });
});
