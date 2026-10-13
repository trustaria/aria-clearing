import type { AdPayload } from "@trustaria/core";
import OpenAI from "openai";
import { kimiLimiter } from "./kimi-limiter";
import type { CardData } from "./receipt";
import { stubAnswer } from "./stub";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ModelName = "kimi" | "stub";

/** One NDJSON line of the /api/chat response. */
export type ChatFrame =
  | { type: "meta"; model: ModelName }
  | { type: "text"; delta: string }
  | { type: "card"; card: CardData; ad: AdPayload }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

/** How long a KIMI request may wait for a rate-limit slot, 429 retries included. */
export const KIMI_START_DEADLINE_MS = 20_000;

const ANSWER_SYSTEM = [
  "You are Nova, a concise and helpful assistant.",
  "Answer in plain text: short paragraphs or simple '-' lists, no headings, no tables, no bold.",
  "Keep answers under 180 words. Never mention ads or sponsors.",
].join(" ");

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
    // 429s are retried by the limiter, which counts every attempt.
    maxRetries: 0,
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

/** Streams Nova's answer text: one KIMI request, or the stub's fixed answer. */
export async function* streamAnswer(
  model: ModelName,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (model === "stub") {
    yield* stubAnswer();
    return;
  }
  const { value: stream, release } = await kimiLimiter().start(
    () =>
      kimiClient().chat.completions.create(
        kimiBody({
          model: kimiModel(),
          stream: true as const,
          messages: [{ role: "system" as const, content: ANSWER_SYSTEM }, ...messages],
        }),
        { signal },
      ),
    { deadline: Date.now() + KIMI_START_DEADLINE_MS, signal },
  );
  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  } finally {
    release();
  }
}
