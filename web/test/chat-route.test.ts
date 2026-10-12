import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chat } from "../app/api/chat/route";
import type { ChatFrame } from "../lib/kimi";
import { STUB_ANSWER } from "../lib/stub";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-chat-"));
  vi.stubEnv("ARIA_CAMPAIGNS_FILE", join(dir, "campaigns.json"));
  vi.stubEnv("KIMI_API_KEY", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function frames(content: string): Promise<ChatFrame[]> {
  const res = await chat(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content }] }),
    }),
  );
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatFrame);
}

describe("/api/chat with the stub", () => {
  it("streams meta, the fixed answer, the card, then done", async () => {
    const out = await frames("Family trip to Lisbon next spring");
    expect(out[0]).toMatchObject({ type: "meta", model: "stub" });
    const text = out.flatMap((f) => (f.type === "text" ? [f.delta] : [])).join("");
    expect(text).toBe(STUB_ANSWER);
    expect(out.at(-2)).toMatchObject({ type: "card", card: { slug: "lisbon-family-trips" } });
    expect(out.at(-1)).toEqual({ type: "done" });
  });

  it("sends no card for a question no campaign matches", async () => {
    const out = await frames("What's the difference between RAM and storage?");
    expect(out.some((f) => f.type === "card")).toBe(false);
    expect(out.at(-1)).toEqual({ type: "done" });
  });
});
