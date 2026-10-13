import { formatClaims } from "@aria-clearing/receipt";
import type { Campaign } from "../campaigns";
import { MAX_RATIONALE, validatePick, type Pick } from "../pick";
import { stubPick } from "../stub";

const PICK_KEYS =
  '{"intent": "commercial" | "informational" | "sensitive", "slug": string | null, "claimRefs": number[], "sentence": string}';

const PICK_RULES = [
  "intent:",
  "- commercial: the user is choosing, comparing, planning, booking, or deciding whether to buy or try something,",
  "and a product or service in the list would genuinely help with that decision. Examples: what should I book,",
  "which X should I buy, is an e-bike worth it, best notes app for meetings, gift ideas, where should we stay,",
  "are online tutors worth it, recommend a meal kit, best way to learn or practise X with a teacher.",
  "- informational: how-to, explanations, facts, comparisons of concepts, troubleshooting, customer support,",
  "returns, or anything no listed campaign helps with.",
  "- sensitive: health, symptoms, medicine, mental health, money, investing, debt, legal or personal crisis.",
  "No card for these, even when a campaign looks related.",
  "",
  "Judge the Question. The previous message, when given, is the user's earlier message: use it only to understand the Question.",
  "",
  "slug: for a commercial question, the one campaign whose offer best matches what the user wants to get or do;",
  "judge by the need, not by shared words. Otherwise null.",
  "claimRefs: the 1 or 2 claim numbers of that campaign that matter most for this question; [] when slug is null.",
  `sentence: one natural sentence to the user, at most ${MAX_RATIONALE - 50} characters, about 20 words, built from the cited claims.`,
  "Restate those claims in plain words; a short lead-in naming the user's need is fine (\"For a 12 km commute, ...\").",
  "Every fact must come from a cited claim of the chosen campaign, never from another campaign.",
  "Add no facts, benefits, judgements or inferences of your own",
  "(no ideal, perfect, easy, so you can, which covers; free only where the claim says free).",
  'No claim numbers or brackets in the sentence. "" when slug is null.',
].join("\n");

export const PICK_SYSTEM = [
  "You choose at most one sponsored card to show next to an AI assistant's answer, as a careful ad network would.",
  "Reply with one JSON object only, keys in this order:",
  PICK_KEYS,
  "",
  PICK_RULES,
].join("\n");

/** Campaigns as the prompt shows them: slug, advertiser, category, keywords, then the numbered claims. */
export function describeCampaigns(list: Campaign[]): string {
  return list
    .map((c) => {
      const lines = [`slug: ${c.slug}`, `advertiser: ${c.advertiser}`, `category: ${c.category}`];
      if (c.keywords?.length) lines.push(`keywords: ${c.keywords.join(", ")}`);
      lines.push(`claims:\n${formatClaims(c.claims)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export type SelectInput = { prompt: string; context?: string; campaigns: Campaign[] };

/** The user message of a pick request. */
export function pickPrompt({ prompt, context, campaigns }: SelectInput): string {
  const parts = [`Campaigns:\n\n${describeCampaigns(campaigns)}`];
  if (context) parts.push(`Previous message: ${context}`);
  parts.push(`Question: ${prompt}`);
  return parts.join("\n\n");
}

/** One model call: resolves the parsed JSON reply, rejects on any failure. */
export type Picker = (input: SelectInput) => Promise<unknown>;

export type Intent = "commercial" | "informational" | "sensitive";

export type NoFill = "not_monetizable" | "no_candidates";

export type Selection = { intent: Intent | null; source: "model" | "keyword" | "none" } & (
  | { decision: "served"; pick: Pick }
  | { decision: "no_fill"; reason: NoFill }
);

const INTENTS: Intent[] = ["commercial", "informational", "sensitive"];

/** Reads a model reply: null slug or a non-commercial intent is not monetizable, anything unsafe has no candidate. */
function fromModel(raw: unknown, campaigns: Campaign[]): Selection {
  const reply = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const intent = INTENTS.find((i) => i === reply?.intent) ?? null;
  const base = { intent, source: "model" as const };
  if (!reply) return { ...base, decision: "no_fill", reason: "no_candidates" };
  if (reply.slug === null || (intent && intent !== "commercial")) {
    return { ...base, decision: "no_fill", reason: "not_monetizable" };
  }
  const pick = validatePick({ slug: reply.slug, rationale: reply.sentence, claimRefs: reply.claimRefs }, campaigns);
  return pick ? { ...base, decision: "served", pick } : { ...base, decision: "no_fill", reason: "no_candidates" };
}

/** Keyword match on the prompt: the campaign with the most keyword hits, its first claims as the sentence. */
function fromKeywords(prompt: string, campaigns: Campaign[]): Selection {
  const raw = stubPick(prompt, campaigns);
  if (raw.slug === null) return { intent: null, source: "keyword", decision: "no_fill", reason: "not_monetizable" };
  const pick = validatePick(raw, campaigns);
  return pick
    ? { intent: "commercial", source: "keyword", decision: "served", pick }
    : { intent: "commercial", source: "keyword", decision: "no_fill", reason: "no_candidates" };
}

/** Chooses at most one live campaign for the prompt; a failed model call falls back to keywords. */
export async function selectAd(input: SelectInput, picker: Picker | null): Promise<Selection> {
  if (input.campaigns.length === 0) return { intent: null, source: "none", decision: "no_fill", reason: "no_candidates" };
  if (!picker) return fromKeywords(input.prompt, input.campaigns);
  try {
    return fromModel(await picker(input), input.campaigns);
  } catch (error) {
    console.warn(`model pick failed, using keywords: ${(error as Error).message}`);
    return fromKeywords(input.prompt, input.campaigns);
  }
}
