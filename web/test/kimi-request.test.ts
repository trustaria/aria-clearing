import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { draftClaims } from "../lib/claims-draft";
import { pickCampaign, streamAnswer } from "../lib/kimi";
import { campaigns, lisbon } from "./fixtures";

type Reply = (req: IncomingMessage, res: ServerResponse) => void;

const bodies: Record<string, unknown>[] = [];
let reply: Reply;
let server: Server;
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

const sse: Reply = (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  for (const delta of ["Hello", " there"]) {
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
});

afterAll(async () => {
  process.env = saved;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  bodies.length = 0;
});

describe("KIMI request body", () => {
  it("disables thinking on the pick request", async () => {
    const rationale = "Every package includes airport transfers.";
    reply = json(JSON.stringify({ slug: lisbon.slug, rationale, claimRefs: [4] }));
    const pick = await pickCampaign("kimi", "Planning Lisbon with kids, what should I book?", campaigns);
    expect(pick?.slug).toBe(lisbon.slug);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "kimi-test",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
    });
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
