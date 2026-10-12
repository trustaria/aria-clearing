import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as chat } from "../app/api/chat/route";
import { draftClaims } from "../lib/claims-draft";
import { createKimiLimiter, setKimiLimiter } from "../lib/kimi-limiter";
import { PICK_SENTINEL, streamAnswer, streamTurn, type ChatFrame, type TurnEvent } from "../lib/kimi";
import { campaigns, lisbon } from "./fixtures";

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

  it("sends the error frame when no slot opens before the deadline", async () => {
    setKimiLimiter(createKimiLimiter({ rpm: 1, concurrency: 1 }));
    reply = sse;
    await readFrames(await ask("first"));
    const frames = await readFrames(await ask("second"));
    expect(frames.map((f) => f.type)).toEqual(["meta", "error", "done"]);
    expect(frames[1]).toEqual({ type: "error", message: "The model is unavailable right now." });
    expect(bodies).toHaveLength(1);
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
