import OpenAI from "openai";
import type { CompletionUsage } from "openai/resources/completions";
import { describeCampaigns, type Campaign } from "./campaigns";
import { kimiLimiter } from "./kimi-limiter";
import { MAX_RATIONALE, parsePickJson, validatePick, type Pick } from "./pick";
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

/** How long a KIMI request may wait for a rate-limit slot, 429 retries included. */
export const KIMI_START_DEADLINE_MS = 20_000;

/** Marks the start of the hidden pick line at the end of a chat reply. */
export const PICK_SENTINEL = "<<<ARIA_PICK>>>";

const ANSWER_SYSTEM = [
  "You are Nova, a concise and helpful assistant.",
  "Answer in plain text: short paragraphs or simple '-' lists, no headings, no tables, no bold.",
  "Keep answers under 180 words. Never mention ads or sponsors.",
].join(" ");

const PICK_KEYS =
  '{"intent": "commercial" | "informational" | "sensitive", "slug": string | null, "claimRefs": number[], "rationale": string}';

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
  "slug: for a commercial question, the one campaign whose offer best matches what the user wants to get or do;",
  "judge by the need, not by shared words. Otherwise null.",
  "claimRefs: the 1 or 2 claim numbers of that campaign that matter most for this question; [] when slug is null.",
  `rationale: one natural sentence to the user, at most ${MAX_RATIONALE - 50} characters, built from the cited claims.`,
  "Restate those claims in plain words; a short lead-in naming the user's need is fine (\"For a 12 km commute, ...\").",
  "Every fact must come from a cited claim of the chosen campaign, never from another campaign.",
  "Add no facts, benefits, judgements or inferences of your own",
  "(no ideal, perfect, easy, so you can, which covers; free only where the claim says free).",
  'No claim numbers or brackets in the sentence. "" when slug is null.',
].join("\n");

const PICK_SYSTEM = [
  "You choose at most one sponsored card to show next to an AI assistant's answer, as a careful ad network would.",
  "Reply with one JSON object only, keys in this order:",
  PICK_KEYS,
  "",
  PICK_RULES,
].join("\n");

/** System prompt for one chat turn: the answer, then a final pick line for the latest user message. */
function turnSystem(campaigns: Campaign[]): string {
  return [
    ANSWER_SYSTEM,
    "",
    `After the answer, end your reply with one last line: ${PICK_SENTINEL} followed by one JSON object, keys in this order:`,
    PICK_KEYS,
    "The user never sees that line. It chooses at most one sponsored card to show next to your answer,",
    "as a careful ad network would, for the user's latest message. Never refer to it in the answer.",
    "",
    PICK_RULES,
    "",
    "Campaigns:",
    "",
    describeCampaigns(campaigns),
  ].join("\n");
}

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

/**
 * Holds back the pick line of a streamed reply. `push` returns the text that is safe to show and keeps
 * any tail that may start the sentinel (with the whitespace before it) until the next delta resolves it.
 */
export class PickSplitter {
  private held = "";
  private payload: string | null = null;

  push(delta: string): string {
    if (this.payload !== null) {
      this.payload += delta;
      return "";
    }
    this.held += delta;
    const at = this.held.indexOf(PICK_SENTINEL);
    if (at >= 0) {
      this.payload = this.held.slice(at + PICK_SENTINEL.length);
      const text = this.held.slice(0, at).trimEnd();
      this.held = "";
      return text;
    }
    let keep = Math.min(PICK_SENTINEL.length - 1, this.held.length);
    while (keep > 0 && !this.held.endsWith(PICK_SENTINEL.slice(0, keep))) keep--;
    let cut = this.held.length - keep;
    while (cut > 0 && /\s/.test(this.held[cut - 1])) cut--;
    const text = this.held.slice(0, cut);
    this.held = this.held.slice(cut);
    return text;
  }

  /** The held answer text, and everything after the sentinel (null when it never came). */
  end(): { text: string; payload: string | null } {
    const text = this.payload === null ? this.held : "";
    this.held = "";
    return { text, payload: this.payload };
  }
}

/** The first balanced JSON object in `text`, or null. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Turns the text after the sentinel into a pick; null when it is missing, malformed, not commercial or invalid. */
export function parseTurnPick(payload: string | null, campaigns: Campaign[]): Pick | null {
  const json = payload ? firstJsonObject(payload) : null;
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (raw.intent !== undefined && raw.intent !== "commercial") return null;
    return validatePick(raw, campaigns);
  } catch {
    return null;
  }
}

export type TurnEvent = { type: "text"; delta: string } | { type: "pick"; pick: Pick | null };

/**
 * One chat turn: streams the answer text, then yields the validated pick.
 * KIMI answers and picks in one streamed request; the stub answers with fixed text and picks by keyword.
 */
export async function* streamTurn(
  model: ModelName,
  messages: ChatMessage[],
  campaigns: Campaign[],
  signal: AbortSignal,
): AsyncGenerator<TurnEvent> {
  if (model === "stub") {
    for await (const delta of stubAnswer()) yield { type: "text", delta };
    const question = messages[messages.length - 1]?.content ?? "";
    yield { type: "pick", pick: validatePick(stubPick(question, campaigns), campaigns) };
    return;
  }
  const { value: stream, release } = await kimiLimiter().start(
    () =>
      kimiClient().chat.completions.create(
        kimiBody({
          model: kimiModel(),
          stream: true as const,
          messages: [{ role: "system" as const, content: turnSystem(campaigns) }, ...messages],
        }),
        { signal },
      ),
    { deadline: Date.now() + KIMI_START_DEADLINE_MS, signal },
  );
  try {
    const splitter = new PickSplitter();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      const text = delta ? splitter.push(delta) : "";
      if (text) yield { type: "text", delta: text };
    }
    const { text, payload } = splitter.end();
    if (text) yield { type: "text", delta: text };
    if (payload === null) console.warn("pick line missing");
    yield { type: "pick", pick: parseTurnPick(payload, campaigns) };
  } finally {
    release();
  }
}

/** Streams the answer text alone, without a pick. */
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

export type PickReply = { raw: unknown; usage?: CompletionUsage };

/**
 * One standalone pick request: the parsed JSON reply and its token usage. Throws on unparseable output.
 * `maxRetries` overrides the limiter's 429 retries.
 */
export async function requestPick(
  question: string,
  campaigns: Campaign[],
  signal: AbortSignal,
  maxRetries?: number,
): Promise<PickReply> {
  const user = `Campaigns:\n\n${describeCampaigns(campaigns)}\n\nQuestion: ${question}`;
  const res = await kimiLimiter().run(
    () =>
      kimiClient().chat.completions.create(
        kimiBody({
          model: kimiModel(),
          response_format: { type: "json_object" as const },
          messages: [
            { role: "system" as const, content: PICK_SYSTEM },
            { role: "user" as const, content: user },
          ],
        }),
        { signal },
      ),
    { deadline: Date.now() + KIMI_START_DEADLINE_MS, signal, retries: maxRetries },
  );
  return { raw: parsePickJson(res.choices[0]?.message?.content ?? ""), usage: res.usage };
}
