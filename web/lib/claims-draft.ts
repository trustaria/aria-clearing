import OpenAI from "openai";
import { activeModel } from "./kimi";
import { parsePickJson, pickWithDeadline } from "./pick";

export const CATEGORIES = [
  "travel",
  "software",
  "outdoor",
  "education",
  "food and drink",
  "home",
  "finance",
  "health",
  "retail",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type DraftInput = { brand: string; url: string; description: string };
export type Draft = { claims: string[]; category: Category; keywords: string[] };
export type DraftResult = Draft | { manual: true };

export const CLAIM_MIN = 10;
export const CLAIM_MAX = 120;
export const CLAIMS_MIN = 3;
export const CLAIMS_LIMIT = 5;
export const KEYWORDS_LIMIT = 6;
export const DRAFT_DEADLINE_MS = 15000;

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

const DRAFT_SYSTEM = [
  "You turn a brand's product description into claims an AI assistant may quote in a sponsored sentence.",
  'Reply with a JSON object only: {"claims": string[], "category": string, "keywords": string[]}.',
  `claims: ${CLAIMS_MIN} to ${CLAIMS_LIMIT} short factual sentences.`,
  "Use only facts stated in the description. One fact per claim.",
  `Each claim is at most ${CLAIM_MAX} characters.`,
  "No superlatives (best, leading, #1), no comparisons, no prices or discounts that the description does not state.",
  `category: exactly one of ${CATEGORIES.join(", ")}.`,
  `keywords: up to ${KEYWORDS_LIMIT} phrases a buyer would type or say when looking for this product.`,
].join(" ");

/** Cleans one claim: NFC, collapsed whitespace (so no newlines), trimmed, leading "1." or "1)" removed. */
export function normalizeClaim(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

/** A normalised claim of 10 to 120 characters. */
export function isValidClaim(claim: string): boolean {
  return claim.length >= CLAIM_MIN && claim.length <= CLAIM_MAX && !/[\r\n]/.test(claim);
}

/** Normalises every claim; null unless there are 1..5 claims and all are valid. */
export function normalizeClaims(claims: unknown): string[] | null {
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > CLAIMS_LIMIT) return null;
  if (!claims.every((c) => typeof c === "string")) return null;
  const clean = (claims as string[]).map(normalizeClaim);
  return clean.every(isValidClaim) ? clean : null;
}

function normalizeKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  const clean = keywords
    .filter((k): k is string => typeof k === "string")
    .map((k) => k.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((k) => k.length > 0 && k.length <= 60);
  return [...new Set(clean)].slice(0, KEYWORDS_LIMIT);
}

/** Turns raw model output into a draft, or null when it is unusable. */
export function validateDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const { claims, category, keywords } = raw as Record<string, unknown>;

  if (!Array.isArray(claims)) return null;
  // Malformed or out-of-range entries are dropped; the draft stands if 3..5 valid ones remain.
  const kept = [
    ...new Set(
      claims
        .filter((c): c is string => typeof c === "string")
        .map(normalizeClaim)
        .filter(isValidClaim),
    ),
  ];
  if (kept.length < CLAIMS_MIN || kept.length > CLAIMS_LIMIT) return null;

  const cat = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!(CATEGORIES as readonly string[]).includes(cat)) return null;

  return { claims: kept, category: cat as Category, keywords: normalizeKeywords(keywords) };
}

const CATEGORY_WORDS: Record<Exclude<Category, "other">, string[]> = {
  travel: ["travel", "trip", "hotel", "flight", "tour", "vacation", "holiday", "booking"],
  software: ["software", "app", "platform", "saas", "api", "cloud", "dashboard", "tool"],
  outdoor: ["hiking", "outdoor", "camping", "trail", "climbing", "backpack", "boots"],
  education: ["course", "learn", "lesson", "tutor", "class", "school", "training"],
  "food and drink": ["coffee", "espresso", "tea", "food", "meal", "wine", "restaurant", "snack"],
  home: ["kitchen", "home", "furniture", "appliance", "garden", "decor", "machine"],
  finance: ["bank", "loan", "invest", "payment", "insurance", "credit", "savings"],
  health: ["health", "fitness", "wellness", "medical", "nutrition", "sleep", "therapy"],
  retail: ["shop", "store", "clothing", "fashion", "shoes", "gift", "jewelry"],
};

const STOPWORDS = new Set(
  "the and for with from that this your you our are was were has have had not but all any can will into over each every more than then them they their its a an of in on at to by as is be or we us".split(
    " ",
  ),
);

function splitFacts(description: string): string[] {
  const facts = description.split(/(?<=[.!?])\s+|\n+/).map(normalizeClaim).filter(isValidClaim);
  if (facts.length >= CLAIMS_MIN) return facts;
  // Few sentences: split further on clause punctuation.
  return description
    .split(/[.!?;,\n]+/)
    .map(normalizeClaim)
    .filter(isValidClaim);
}

function stubCategory(text: string): Category {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  let best: Category = "other";
  let bestHits = 0;
  for (const [category, list] of Object.entries(CATEGORY_WORDS)) {
    const hits = list.filter((w) => words.has(w) || words.has(`${w}s`)).length;
    if (hits > bestHits) {
      best = category as Category;
      bestHits = hits;
    }
  }
  return best;
}

function stubKeywords(brand: string, description: string): string[] {
  const counts = new Map<string, number>();
  for (const w of description.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (!STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const brandWords = new Set(brand.toLowerCase().match(/[a-z]+/g) ?? []);
  return [...counts.entries()]
    .filter(([w]) => !brandWords.has(w))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, KEYWORDS_LIMIT)
    .map(([w]) => w);
}

/** Dev-only deterministic draft used when no KIMI key is set: the description's own sentences. */
export function stubDraft({ brand, description }: DraftInput): DraftResult {
  const claims = [...new Set(splitFacts(description))].slice(0, 4);
  if (claims.length < CLAIMS_MIN) return { manual: true };
  return {
    claims,
    category: stubCategory(description),
    keywords: stubKeywords(brand, description),
  };
}

async function kimiDraft(input: DraftInput, signal: AbortSignal): Promise<Draft | null> {
  const model = process.env.KIMI_MODEL;
  if (!model) throw new Error("KIMI_MODEL is not set");
  const client = new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || DEFAULT_BASE_URL,
  });
  const user = `Brand: ${input.brand}\nWebsite: ${input.url}\nDescription:\n${input.description}`;
  const res = await client.chat.completions.create(
    {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: user },
      ],
    },
    { signal },
  );
  return validateDraft(parsePickJson(res.choices[0]?.message?.content ?? ""));
}

/** Drafts claims, category and keywords. Never rejects: any failure gives `{manual: true}`. */
export async function draftClaims(input: DraftInput): Promise<DraftResult> {
  const model = activeModel();
  if (model === "stub") return stubDraft(input);
  if (model !== "kimi") return { manual: true };
  const draft = await pickWithDeadline((signal) => kimiDraft(input, signal), DRAFT_DEADLINE_MS);
  return draft ?? { manual: true };
}
