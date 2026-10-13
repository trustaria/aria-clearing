import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import { parsePickJson } from "../pick";
import { PICK_SYSTEM, pickPrompt, type Picker } from "./select";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/** Hard limit on one pick request; past it the keyword selector answers. */
export const GEMINI_TIMEOUT_MS = 4000;

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

/** The lowest thinking level a model accepts: off on 2.5 Flash, minimal on the 3.x Flash models that allow it, else low. */
export function reasoningEffort(model: string): ReasoningEffort {
  if (/^gemini-2\.5-flash/.test(model)) return "none";
  if (/^gemini-(3-flash|3\.1-flash-lite|3\.5-flash-lite|3\.6-flash)/.test(model)) return "minimal";
  return "low";
}

/** A picker backed by one Gemini JSON-mode call; null when GEMINI_API_KEY is unset. */
export function geminiPicker({ timeoutMs = GEMINI_TIMEOUT_MS }: { timeoutMs?: number } = {}): Picker | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL,
    maxRetries: 0,
    timeout: timeoutMs,
  });
  return async (input) => {
    const model = geminiModel();
    const res = await client.chat.completions.create(
      {
        model,
        reasoning_effort: reasoningEffort(model),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PICK_SYSTEM },
          { role: "user", content: pickPrompt(input) },
        ],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return parsePickJson(res.choices[0]?.message?.content ?? "");
  };
}
