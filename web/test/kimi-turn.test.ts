import { describe, expect, it, vi } from "vitest";
import { streamAnswer } from "../lib/kimi";
import { STUB_ANSWER } from "../lib/stub";

describe("streamAnswer with the stub", () => {
  it("streams the fixed answer and nothing else", async () => {
    vi.useFakeTimers();
    const deltas: string[] = [];
    const done = (async () => {
      const messages = [{ role: "user" as const, content: "Family trip to Lisbon next spring" }];
      for await (const delta of streamAnswer("stub", messages, new AbortController().signal)) deltas.push(delta);
    })();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(deltas.join("")).toBe(STUB_ANSWER);
  });
});
