import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postDraft } from "../app/api/advertise/draft/route";
import { POST as chat } from "../app/api/chat/route";
import { draftClaims } from "../lib/claims-draft";
import { createKimiLimiter, setKimiLimiter } from "../lib/kimi-limiter";
import { PICK_SENTINEL, streamAnswer, streamTurn, type ChatFrame, type TurnEvent } from "../lib/kimi";
import { readSite } from "../lib/site-reader";
import { FALLBACK_ANSWER, KIMI_BUSY_NOTICE, KIMI_STOPPED_NOTICE } from "../lib/stub";
import { campaigns, lisbon } from "./fixtures";

vi.mock("@/lib/advertiser-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/advertiser-auth")>()),
  verifyAdvertiser: async () => ({ userId: "did:privy:test" }),
}));

vi.mock("../lib/site-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/site-reader")>()),
  readSite: vi.fn(),
}));

type Reply = (req: IncomingMessage, res: ServerResponse) => void;

const bodies: Record<string, unknown>[] = [];
let reply: Reply;
let server: Server;
let dir: string;
const saved = { ...process.env };

function json(content: string): Reply {
  return (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "kimi-test",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      }),
    );
  };
}

const sseOf = (deltas: string[]): Reply => (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  for (const delta of deltas) {
    const chunk = {
      id: "x",
      object: "chat.completion.chunk",
      created: 0,
      model: "kimi-test",
      choices: [{ index: 0, delta: { content: delta } }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end("data: [DONE]\n\n");
};

const sse = sseOf(["Hello", " there"]);

const rateLimited: Reply = (_req, res) => {
  res.statusCode = 429;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: { message: "request reached organization max RPM: 3, please try again after 1 seconds" } }));
};

/** A 429 asking to wait longer than any request deadline. */
const rateLimitedFor = (seconds: number): Reply => (_req, res) => {
  res.statusCode = 429;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: { message: `rate limited, please try again after ${seconds} seconds` } }));
};

const serverError: Reply = (_req, res) => {
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: { message: "internal error" } }));
};

/** Streams one delta, then drops the connection. */
const brokenStream = (delta: string): Reply => (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  const chunk = { id: "x", object: "chat.completion.chunk", created: 0, model: "kimi-test", choices: [{ index: 0, delta: { content: delta } }] };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  setTimeout(() => res.destroy(), 20);
};

function expectFallback(frames: ChatFrame[], slug: string | null) {
  expect(frames[0]).toMatchObject({ type: "meta" });
  expect(frames[1]).toEqual({ type: "notice", message: KIMI_BUSY_NOTICE });
  const text = frames.flatMap((f) => (f.type === "text" ? [f.delta] : [])).join("");
  expect(text).toBe(FALLBACK_ANSWER);
  expect(frames.some((f) => f.type === "error")).toBe(false);
  const card = frames.find((f) => f.type === "card");
  if (slug) expect(card).toMatchObject({ card: { slug } });
  else expect(card).toBeUndefined();
  expect(frames.at(-1)).toEqual({ type: "done" });
}

const RATIONALE = "Every package includes airport transfers.";
const PICK_LINE = `${PICK_SENTINEL}${JSON.stringify({ intent: "commercial", slug: lisbon.slug, claimRefs: [4], rationale: RATIONALE })}`;

async function readFrames(res: Response): Promise<ChatFrame[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatFrame);
}

function ask(content: string): Promise<Response> {
  return chat(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content }] }),
    }),
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(text));
      reply(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.KIMI_API_KEY = "test-key";
  process.env.KIMI_MODEL = "kimi-test";
  process.env.KIMI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  dir = mkdtempSync(join(tmpdir(), "aria-kimi-"));
  process.env.ARIA_CAMPAIGNS_FILE = join(dir, "campaigns.json");
});

afterAll(async () => {
  process.env = saved;
  setKimiLimiter();
  rmSync(dir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  bodies.length = 0;
  setKimiLimiter(createKimiLimiter({ rpm: 1000, concurrency: 1 }));
});

describe("KIMI request body", () => {
  it("answers and picks in one streamed request with thinking disabled", async () => {
    reply = sseOf(["Book the hotel ", "first.\n<<<ARIA", PICK_LINE.slice(7)]);
    const events: TurnEvent[] = [];
    const messages = [{ role: "user" as const, content: "Planning Lisbon with kids, what should I book?" }];
    for await (const event of streamTurn("kimi", messages, campaigns, new AbortController().signal)) events.push(event);

    expect(events).toEqual([
      { type: "text", delta: "Book the hotel" },
      { type: "text", delta: " first." },
      { type: "pick", pick: { slug: lisbon.slug, rationale: RATIONALE, claimRefs: [4] } },
    ]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: "kimi-test", stream: true, thinking: { type: "disabled" } });
    expect(bodies[0]).not.toHaveProperty("response_format");
    const system = (bodies[0].messages as { role: string; content: string }[])[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain(PICK_SENTINEL);
    expect(system.content).toContain(`slug: ${lisbon.slug}`);
  });

  it("disables thinking on the streamed answer", async () => {
    reply = sse;
    let text = "";
    const messages = [{ role: "user" as const, content: "hi" }];
    for await (const delta of streamAnswer("kimi", messages, new AbortController().signal)) text += delta;
    expect(text).toBe("Hello there");
    expect(bodies[0]).toMatchObject({ stream: true, thinking: { type: "disabled" } });
  });

  it("disables thinking on the claims draft request", async () => {
    const claims = ["Family packages for Lisbon.", "Children under 6 stay free.", "Airport transfers included."];
    reply = json(JSON.stringify({ claims, category: "travel", keywords: [] }));
    const draft = await draftClaims({ brand: "Tagus", url: "https://example.com", description: "Family trips." });
    expect(draft).toMatchObject({ category: "travel" });
    expect(bodies[0]).toMatchObject({ thinking: { type: "disabled" }, response_format: { type: "json_object" } });
  });
});

describe("/api/chat with KIMI", () => {
  it("streams meta, text, card and done from one request", async () => {
    reply = sseOf(["Book the hotel first.", `\n${PICK_LINE}`]);
    const frames = await readFrames(await ask("Planning Lisbon with kids, what should I book?"));
    expect(frames.map((f) => f.type)).toEqual(["meta", "text", "card", "done"]);
    expect(frames[1]).toEqual({ type: "text", delta: "Book the hotel first." });
    expect(frames[2]).toMatchObject({ card: { slug: lisbon.slug, rationale: RATIONALE, claimRefs: [4] } });
    expect(bodies).toHaveLength(1);
  });

  it("shows the answer without a card when the pick line is malformed", async () => {
    reply = sseOf(["RAM is working memory.", `\n${PICK_SENTINEL}{"slug": "lisbon-`]);
    const frames = await readFrames(await ask("What's the difference between RAM and storage?"));
    expect(frames.map((f) => f.type)).toEqual(["meta", "text", "done"]);
    expect(frames[1]).toEqual({ type: "text", delta: "RAM is working memory." });
  });

  it("retries a 429, then answers", async () => {
    let calls = 0;
    reply = (req, res) => (++calls === 1 ? rateLimited(req, res) : sse(req, res));
    const frames = await readFrames(await ask("hi"));
    expect(frames.map((f) => f.type)).toEqual(["meta", "text", "text", "done"]);
    expect(calls).toBe(2);
  });

  it("shows the fallback answer and keyword card when no slot opens before the deadline", async () => {
    setKimiLimiter(createKimiLimiter({ rpm: 1, concurrency: 1 }));
    reply = sse;
    await readFrames(await ask("first"));
    const frames = await readFrames(await ask("Planning a family trip to Lisbon"));
    expectFallback(frames, lisbon.slug);
    expect(bodies).toHaveLength(1);
  });

  it("shows the fallback answer when KIMI keeps answering 429", async () => {
    reply = rateLimitedFor(120);
    expectFallback(await readFrames(await ask("Planning a family trip to Lisbon")), lisbon.slug);
  });

  it("shows the fallback answer without a card when KIMI fails and no campaign matches", async () => {
    reply = serverError;
    expectFallback(await readFrames(await ask("What's the difference between RAM and storage?")), null);
  });

  it("keeps KIMI's card and sends no second one when only the pick line came", async () => {
    reply = sseOf([PICK_LINE]);
    const frames = await readFrames(await ask("Planning Lisbon with kids, what should I book?"));
    const cards = frames.filter((f) => f.type === "card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ card: { slug: lisbon.slug, rationale: RATIONALE } });
    expect(frames.flatMap((f) => (f.type === "text" ? [f.delta] : [])).join("")).toBe(FALLBACK_ANSWER);
  });

  it("shows the fallback answer when KIMI streams no text", async () => {
    reply = sseOf([]);
    expectFallback(await readFrames(await ask("hi")), null);
  });

  it("keeps the streamed text and adds a notice when KIMI stops mid-answer", async () => {
    reply = brokenStream("Book the hotel first.");
    const frames = await readFrames(await ask("Planning Lisbon with kids, what should I book?"));
    expect(frames.map((f) => f.type)).toEqual(["meta", "text", "notice", "done"]);
    expect(frames[1]).toEqual({ type: "text", delta: "Book the hotel first." });
    expect(frames[2]).toEqual({ type: "notice", message: KIMI_STOPPED_NOTICE });
  });
});

describe("/api/advertise/draft when KIMI is unavailable", () => {
  const post = (body: unknown) =>
    postDraft(new Request("http://localhost/api/advertise/draft", { method: "POST", body: JSON.stringify(body) }));
  const description = "Family trips to Lisbon with airport transfers, kids clubs and hotels near the beach.";

  it.each([
    ["a 429", () => rateLimitedFor(120)],
    ["a server error", () => serverError],
  ])("answers manual claims on %s", async (_name, make) => {
    reply = make();
    const res = await post({ brand: "Tagus", url: "https://example.com", description });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ manual: true });
  });

  it("answers manual claims when no slot opens before the deadline", async () => {
    setKimiLimiter(createKimiLimiter({ rpm: 1, concurrency: 1 }));
    reply = serverError;
    await post({ brand: "Tagus", url: "https://example.com", description });
    const res = await post({ brand: "Tagus", url: "https://example.com", description });
    expect(await res.json()).toEqual({ manual: true });
  });

  it("answers the website manual-entry reason when KIMI fails", async () => {
    vi.mocked(readSite).mockResolvedValue({
      site: { url: "https://example.com", title: "Tagus", description: "", ogTitle: "", ogDescription: "", siteName: "", text: description },
    });
    reply = rateLimitedFor(120);
    const res = await post({ url: "https://example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ manual: true, reason: "draft_failed" });
  });
});

describe("claims draft through the limiter", () => {
  const input = { brand: "Tagus", url: "https://example.com", description: "Family trips." };
  const claims = ["Family packages for Lisbon.", "Children under 6 stay free.", "Airport transfers included."];

  it("retries a 429, then drafts", async () => {
    let calls = 0;
    const ok = json(JSON.stringify({ claims, category: "travel", keywords: [] }));
    reply = (req, res) => (++calls === 1 ? rateLimited(req, res) : ok(req, res));
    expect(await draftClaims(input)).toMatchObject({ category: "travel" });
    expect(calls).toBe(2);
  });

  it("falls back to manual when no slot opens before the deadline", async () => {
    setKimiLimiter(createKimiLimiter({ rpm: 1, concurrency: 1 }));
    reply = json(JSON.stringify({ claims, category: "travel", keywords: [] }));
    await draftClaims(input);
    expect(await draftClaims(input)).toEqual({ manual: true });
    expect(bodies).toHaveLength(1);
  });
});
