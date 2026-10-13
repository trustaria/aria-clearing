import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chat } from "../app/api/chat/route";
import { POST as serve } from "../app/api/v1/serve/route";
import type { ChatFrame } from "../lib/kimi";
import { isRequestId } from "../lib/request-id";
import { getServed } from "../lib/served";
import { STUB_ANSWER } from "../lib/stub";
import { routeServeFetch } from "./serve-fetch";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-chat-"));
  vi.stubEnv("ARIA_DATA_DIR", dir);
  vi.stubEnv("ARIA_EVENTS_FILE", "");
  vi.stubEnv("ARIA_CAMPAIGNS_FILE", "");
  vi.stubEnv("ARIA_API_KEY", "ak_test_9Fq2LmZ0tR7wYb3XcVn8Ke1PsAd4Gh6J");
  vi.stubEnv("ARIA_PUBLISHER_ID", "");
  vi.stubEnv("ARIA_BASE_URL", "");
  vi.stubEnv("ARIA_SERVE_TIMEOUT_MS", "");
  vi.stubEnv("PORT", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("KIMI_API_KEY", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

type Message = { role: "user" | "assistant"; content: string };

async function frames(content: string | Message[], extra: Record<string, unknown> = {}): Promise<ChatFrame[]> {
  const messages = typeof content === "string" ? [{ role: "user", content }] : content;
  const res = await chat(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages, ...extra }),
    }),
  );
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatFrame);
}

const textOf = (out: ChatFrame[]) => out.flatMap((f) => (f.type === "text" ? [f.delta] : [])).join("");

describe("/api/chat with the stub", () => {
  it("streams meta, the fixed answer, the served card, then done", async () => {
    routeServeFetch();
    const out = await frames("Family trip to Lisbon next spring");
    expect(out[0]).toEqual({ type: "meta", model: "stub" });
    expect(textOf(out)).toBe(STUB_ANSWER);
    expect(out.at(-2)).toMatchObject({ type: "card", card: { slug: "lisbon-family-trips" } });
    expect(out.at(-1)).toEqual({ type: "done" });
  });

  it("builds the card under the serve API's request_id, which the served record holds", async () => {
    routeServeFetch();
    const card = (await frames("Family trip to Lisbon next spring")).find((f) => f.type === "card");
    if (card?.type !== "card") throw new Error("no card");
    expect(isRequestId(card.card.requestId)).toBe(true);
    expect(card.card.receipt.requestId).toBe(card.card.requestId);
    expect(getServed(card.card.requestId)).toMatchObject({
      slug: card.card.slug,
      rationale: card.card.rationale,
      claimRefs: card.card.claimRefs,
    });
  });

  it("sends the latest user message as prompt, the one before as context, and the session id", async () => {
    const bodies = routeServeFetch();
    await frames(
      [
        { role: "user", content: "Planning a family trip" },
        { role: "assistant", content: "Where to?" },
        { role: "user", content: "Lisbon, what should I book?" },
      ],
      { sessionId: "sess_abc" },
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      publisher_id: "pub_nova",
      prompt: "Lisbon, what should I book?",
      context: "Planning a family trip",
      session_id: "sess_abc",
    });
  });

  it("drops a session id that is not a short string", async () => {
    const bodies = routeServeFetch();
    await frames("Family trip to Lisbon", { sessionId: "x".repeat(200) });
    expect(bodies[0]).not.toHaveProperty("session_id");
  });

  it("sends no card for a question no campaign matches", async () => {
    routeServeFetch();
    const out = await frames("What's the difference between RAM and storage?");
    expect(out.some((f) => f.type === "card")).toBe(false);
    expect(out.at(-1)).toEqual({ type: "done" });
  });

  it.each([
    ["serve answers 500", async () => Response.json({ error: { code: "internal", message: "boom" } }, { status: 500 })],
    ["serve answers 401", async () => Response.json({ error: { code: "invalid_key", message: "no" } }, { status: 401 })],
    [
      "the network fails",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["serve answers garbage", async () => new Response("not json", { status: 200 })],
  ])("streams the answer without a card or error when %s", async (_name, handler) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    routeServeFetch(handler);
    const out = await frames("Family trip to Lisbon next spring");
    expect(textOf(out)).toBe(STUB_ANSWER);
    expect(out.some((f) => f.type === "card" || f.type === "error")).toBe(false);
    expect(out.at(-1)).toEqual({ type: "done" });
  });

  it("streams the answer without a card when serve is slower than the budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ARIA_SERVE_TIMEOUT_MS", "100");
    routeServeFetch(
      (req) => new Promise((_resolve, reject) => req.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const out = await frames("Family trip to Lisbon next spring");
    expect(textOf(out)).toBe(STUB_ANSWER);
    expect(out.some((f) => f.type === "card")).toBe(false);
  });

  it("shows no card when the served ad fails Nova's own validation", async () => {
    routeServeFetch(async (req) => {
      const res = await serve(req);
      const body = await res.json();
      return Response.json({ ...body, ad: { ...body.ad, offer_id: "not-a-campaign" } });
    });
    const out = await frames("Family trip to Lisbon next spring");
    expect(out.some((f) => f.type === "card")).toBe(false);
  });
});
