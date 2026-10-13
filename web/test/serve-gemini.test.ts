import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GEMINI_MODEL, geminiModel, geminiPicker, reasoningEffort } from "../lib/serve/gemini";
import { PICK_SYSTEM } from "../lib/serve/select";
import { campaigns, lisbon } from "./fixtures";

type Reply = (req: IncomingMessage, res: ServerResponse) => void;

const bodies: Record<string, unknown>[] = [];
const auth: (string | undefined)[] = [];
let reply: Reply;
let server: Server;
let baseUrl: string;

function json(content: string): Reply {
  return (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "gemini-test",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      }),
    );
  };
}

const PICK = { intent: "commercial", slug: lisbon.slug, claimRefs: [4], sentence: "Every package includes airport transfers." };

beforeAll(async () => {
  server = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(text));
      auth.push(req.headers.authorization);
      reply(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta/openai/`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  bodies.length = 0;
  auth.length = 0;
  vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
  vi.stubEnv("GEMINI_BASE_URL", baseUrl);
  vi.stubEnv("GEMINI_MODEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("geminiPicker", () => {
  it("is null without GEMINI_API_KEY", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(geminiPicker()).toBeNull();
  });

  it("sends one JSON-mode request with minimal thinking and returns the parsed object", async () => {
    reply = json(JSON.stringify(PICK));
    const raw = await geminiPicker()!({ prompt: "What should I book?", context: "Lisbon with kids", campaigns });
    expect(raw).toEqual(PICK);
    expect(bodies).toHaveLength(1);
    expect(auth[0]).toBe("Bearer gemini-test-key");
    expect(bodies[0]).toMatchObject({
      model: DEFAULT_GEMINI_MODEL,
      response_format: { type: "json_object" },
      reasoning_effort: "minimal",
    });
    expect(bodies[0]).not.toHaveProperty("stream");
    const messages = bodies[0].messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: PICK_SYSTEM });
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain(`slug: ${lisbon.slug}`);
    expect(messages[1].content).toContain("Previous message: Lisbon with kids");
    expect(messages[1].content).toContain("Question: What should I book?");
  });

  it("uses GEMINI_MODEL when set", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    reply = json(JSON.stringify(PICK));
    await geminiPicker()!({ prompt: "q", campaigns });
    expect(bodies[0]).toMatchObject({ model: "gemini-2.5-flash", reasoning_effort: "none" });
  });

  it("reads the JSON object out of fenced output", async () => {
    reply = json("```json\n" + JSON.stringify(PICK) + "\n```");
    expect(await geminiPicker()!({ prompt: "q", campaigns })).toEqual(PICK);
  });

  it("rejects on output with no JSON object", async () => {
    reply = json("I cannot help with that.");
    await expect(geminiPicker()!({ prompt: "q", campaigns })).rejects.toThrow();
  });

  it("rejects on an API error, without retrying", async () => {
    reply = (_req, res) => {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: "thinking level not supported" } }));
    };
    await expect(geminiPicker()!({ prompt: "q", campaigns })).rejects.toThrow(/thinking level not supported/);
    expect(bodies).toHaveLength(1);
  });

  it("rejects when the reply takes longer than the timeout", async () => {
    reply = () => {};
    const started = Date.now();
    await expect(geminiPicker({ timeoutMs: 150 })!({ prompt: "q", campaigns })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("Gemini settings", () => {
  it("defaults the model and reads GEMINI_MODEL", () => {
    expect(geminiModel()).toBe(DEFAULT_GEMINI_MODEL);
    vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash-lite");
    expect(geminiModel()).toBe("gemini-3.5-flash-lite");
  });

  it.each([
    ["gemini-2.5-flash", "none"],
    ["gemini-2.5-flash-lite", "none"],
    ["gemini-3.6-flash", "minimal"],
    ["gemini-3.5-flash-lite", "minimal"],
    ["gemini-3.1-flash-lite", "minimal"],
    ["gemini-3-flash-preview", "minimal"],
    ["gemini-3.8-flash", "low"],
    ["gemini-2.5-pro", "low"],
  ])("thinks as little as %s allows", (model, effort) => {
    expect(reasoningEffort(model)).toBe(effort);
  });
});
