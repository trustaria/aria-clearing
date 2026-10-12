import OpenAI from "openai";
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
  "You decide whether one sponsored campaign fits a user's question. Reply with a JSON object only:",
  '{"slug": string | null, "rationale": string, "claimRefs": number[]}.',
  "Pick a campaign only when the user is planning, buying, booking or choosing something that campaign directly offers.",
  'For informational, factual, technical or general questions reply {"slug": null, "rationale": "", "claimRefs": []}.',
  `The rationale is one sentence of at most ${MAX_RATIONALE - 20} characters, written to the user,`,
  "that states only facts found in the chosen campaign's numbered claims: no other facts, no prices, no superlatives.",
  "claimRefs lists the numbers of the claims the rationale relies on.",
].join(" ");

/** The active model: KIMI when KIMI_API_KEY is set, otherwise the dev-only stub. */
export function activeModel(): ModelName | null {
  if (process.env.KIMI_API_KEY) return "kimi";
  return process.env.NODE_ENV === "production" ? null : "stub";
}

function client(): OpenAI {
  return new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || DEFAULT_BASE_URL,
  });
}

function modelId(): string {
  const id = process.env.KIMI_MODEL;
  if (!id) throw new Error("KIMI_MODEL is not set");
  return id;
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
  const stream = await client().chat.completions.create(
    {
      model: modelId(),
      stream: true,
      messages: [{ role: "system", content: ANSWER_SYSTEM }, ...messages],
    },
    { signal },
  );
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

async function kimiPick(question: string, campaigns: Campaign[], signal: AbortSignal): Promise<Pick | null> {
  const user = `Campaigns:\n\n${describeCampaigns(campaigns)}\n\nQuestion: ${question}`;
  // One retry for unparseable output, inside the same deadline.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await client().chat.completions.create(
        {
          model: modelId(),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: PICK_SYSTEM },
            { role: "user", content: user },
          ],
        },
        { signal },
      );
      return validatePick(parsePickJson(res.choices[0]?.message?.content ?? ""), campaigns);
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
