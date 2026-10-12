import OpenAI from "openai";
import type { CompletionUsage } from "openai/resources/completions";
import { describeCampaigns, type Campaign } from "./campaigns";
import { MAX_RATIONALE, parsePickJson, PICK_DEADLINE_MS, pickWithDeadline, validatePick, type Pick } from "./pick";
import type { CardData } from "./receipt";
import { stubAnswer, stubPick } from "./stub";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ModelName = "kimi" | "stub";

/** One NDJSON line of the /api/chat response. */
export type ChatFrame =
  | { type: "meta"; requestId: string; model: ModelName }
  | { type: "text"; delta: string }
  | { type: "card"; card: CardData }
  | { type: "error"; message: string }
  | { type: "done" };

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

const ANSWER_SYSTEM = [
  "You are Nova, a concise and helpful assistant.",
  "Answer in plain text: short paragraphs or simple '-' lists, no headings, no tables, no bold.",
  "Keep answers under 180 words. Never mention ads or sponsors.",
].join(" ");

const PICK_SYSTEM = [
  "You choose at most one sponsored card to show next to an AI assistant's answer, as a careful ad network would.",
  "Reply with one JSON object only, keys in this order:",
  '{"intent": "commercial" | "informational" | "sensitive", "slug": string | null, "claimRefs": number[], "rationale": string}',
  "",
  "intent:",
  "- commercial: the user is choosing, comparing, planning, booking, or deciding whether to buy or try something,",
  "and a product or service in the list would genuinely help with that decision. Examples: what should I book,",
  "which X should I buy, is an e-bike worth it, best notes app for meetings, gift ideas, where should we stay,",
  "are online tutors worth it, recommend a meal kit.",
  "- informational: how-to, explanations, facts, comparisons of concepts, troubleshooting, customer support,",
  "returns, or anything no listed campaign helps with.",
  "- sensitive: health, symptoms, medicine, mental health, money, investing, debt, legal or personal crisis.",
  "No card for these, even when a campaign looks related.",
  "",
  "slug: for a commercial question, the one campaign whose offer best matches what the user wants to get or do;",
  "judge by the need, not by shared words. Otherwise null.",
  "claimRefs: the 1 or 2 claim numbers of that campaign that matter most for this question; [] when slug is null.",
  `rationale: one natural sentence to the user, at most ${MAX_RATIONALE - 30} characters, on why this offer fits`,
  "their question, stating only facts from the cited claims. No other facts, prices or superlatives,",
  'no claim numbers or brackets in the sentence. "" when slug is null.',
].join("\n");

/** The active model: KIMI when KIMI_API_KEY is set, otherwise the dev-only stub. */
export function activeModel(): ModelName | null {
  if (process.env.KIMI_API_KEY) return "kimi";
  return process.env.NODE_ENV === "production" ? null : "stub";
}

/** KIMI client from KIMI_API_KEY and KIMI_BASE_URL. */
export function kimiClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || DEFAULT_BASE_URL,
  });
}

/** The KIMI_MODEL id; throws when unset. */
export function kimiModel(): string {
  const id = process.env.KIMI_MODEL;
  if (!id) throw new Error("KIMI_MODEL is not set");
  return id;
}

/**
 * Adds the fields every KIMI request carries: reasoning off, so a reply starts in about
 * a second instead of 30. kimi-k2.6 accepts only temperature 0.6, its default, so none is set.
 */
export function kimiBody<T extends object>(body: T): T & { thinking: { type: "disabled" } } {
  return { ...body, thinking: { type: "disabled" } };
}

/** Streams the answer text. */
export async function* streamAnswer(
  model: ModelName,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (model === "stub") {
    yield* stubAnswer();
    return;
  }
  const stream = await kimiClient().chat.completions.create(
    kimiBody({
      model: kimiModel(),
      stream: true as const,
      messages: [{ role: "system" as const, content: ANSWER_SYSTEM }, ...messages],
    }),
    { signal },
  );
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

export type PickReply = { raw: unknown; usage?: CompletionUsage };

/**
 * One pick request: the parsed JSON reply and its token usage. Throws on unparseable output.
 * `maxRetries` overrides the client's automatic retries on 429 and 5xx.
 */
export async function requestPick(
  question: string,
  campaigns: Campaign[],
  signal: AbortSignal,
  maxRetries?: number,
): Promise<PickReply> {
  const user = `Campaigns:\n\n${describeCampaigns(campaigns)}\n\nQuestion: ${question}`;
  const res = await kimiClient().chat.completions.create(
    kimiBody({
      model: kimiModel(),
      response_format: { type: "json_object" as const },
      messages: [
        { role: "system" as const, content: PICK_SYSTEM },
        { role: "user" as const, content: user },
      ],
    }),
    { signal, maxRetries },
  );
  return { raw: parsePickJson(res.choices[0]?.message?.content ?? ""), usage: res.usage };
}

async function kimiPick(question: string, campaigns: Campaign[], signal: AbortSignal): Promise<Pick | null> {
  // One retry for unparseable output, inside the same deadline.
  for (let attempt = 0; ; attempt++) {
    try {
      return validatePick((await requestPick(question, campaigns, signal)).raw, campaigns);
    } catch (error) {
      if (attempt >= 1 || signal.aborted) throw error;
    }
  }
}

/** Picks a campaign for the question, or null. Never rejects; gives up after the deadline. */
export function pickCampaign(model: ModelName, question: string, campaigns: Campaign[]): Promise<Pick | null> {
  if (model === "stub") return Promise.resolve(validatePick(stubPick(question, campaigns), campaigns));
  return pickWithDeadline(
    (signal) =>
      kimiPick(question, campaigns, signal).catch((error: Error) => {
        if (!signal.aborted) console.warn(`pick failed: ${error.message}`);
        throw error;
      }),
    PICK_DEADLINE_MS,
  );
}
