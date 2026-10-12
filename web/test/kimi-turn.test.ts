import { describe, expect, it, vi } from "vitest";
import { parseTurnPick, PICK_SENTINEL, PickSplitter, streamTurn, type TurnEvent } from "../lib/kimi";
import { validatePick } from "../lib/pick";
import { STUB_ANSWER, stubPick } from "../lib/stub";
import { campaigns, lisbon } from "./fixtures";

const PICK = { intent: "commercial", slug: lisbon.slug, claimRefs: [4], rationale: "Every package includes airport transfers." };
const PICK_LINE = `${PICK_SENTINEL}${JSON.stringify(PICK)}`;

function split(chunks: string[]) {
  const splitter = new PickSplitter();
  let text = chunks.map((c) => splitter.push(c)).join("");
  const end = splitter.end();
  text += end.text;
  return { text, payload: end.payload };
}

function chunked(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

describe("PickSplitter", () => {
  it("separates the answer from the pick line", () => {
    expect(split([`Book the hotel first.\n${PICK_LINE}`])).toEqual({
      text: "Book the hotel first.",
      payload: JSON.stringify(PICK),
    });
  });

  it.each([1, 2, 3, 5, 7])("handles the sentinel split across %i-character chunks", (size) => {
    const { text, payload } = split(chunked(`Book the hotel first.\n\n${PICK_LINE}`, size));
    expect(text).toBe("Book the hotel first.");
    expect(payload).toBe(JSON.stringify(PICK));
  });

  it("never streams any part of the sentinel", () => {
    const splitter = new PickSplitter();
    const streamed = chunked(`Answer.\n${PICK_LINE}`, 4).map((c) => splitter.push(c));
    expect(streamed.join("")).not.toContain("<");
  });

  it("keeps the whole answer when the pick line is missing", () => {
    expect(split(["a < b and ", "x <<", "<"])).toEqual({ text: "a < b and x <<<", payload: null });
  });

  it("streams text that only looks like the start of the sentinel once it diverges", () => {
    const splitter = new PickSplitter();
    expect(splitter.push("Use <<<")).toBe("Use");
    expect(splitter.push("x")).toBe(" <<<x");
  });
});

describe("parseTurnPick", () => {
  it("validates the pick JSON", () => {
    expect(parseTurnPick(JSON.stringify(PICK), campaigns)).toEqual({
      slug: lisbon.slug,
      rationale: PICK.rationale,
      claimRefs: [4],
    });
  });

  it("ignores text after the JSON object", () => {
    const payload = `${JSON.stringify(PICK)}\nThat is my pick {really}.`;
    expect(parseTurnPick(payload, campaigns)?.slug).toBe(lisbon.slug);
  });

  it("is null for a missing, malformed or unsafe pick", () => {
    expect(parseTurnPick(null, campaigns)).toBeNull();
    expect(parseTurnPick("", campaigns)).toBeNull();
    expect(parseTurnPick('{"slug": "lisbon-family-trips", "rationale": ', campaigns)).toBeNull();
    expect(parseTurnPick(JSON.stringify({ ...PICK, slug: "nope" }), campaigns)).toBeNull();
    expect(parseTurnPick(JSON.stringify({ ...PICK, claimRefs: [9] }), campaigns)).toBeNull();
    expect(parseTurnPick(JSON.stringify({ ...PICK, intent: "sensitive" }), campaigns)).toBeNull();
    expect(parseTurnPick(JSON.stringify({ ...PICK, slug: null, claimRefs: [], rationale: "" }), campaigns)).toBeNull();
  });

  it("strips claim markers from the rationale", () => {
    const pick = parseTurnPick(JSON.stringify({ ...PICK, rationale: "Airport transfers are included (4)." }), campaigns);
    expect(pick?.rationale).toBe("Airport transfers are included.");
  });
});

describe("streamTurn with the stub", () => {
  it("streams the fixed answer, then the keyword pick", async () => {
    vi.useFakeTimers();
    const question = "Family trip to Lisbon next spring";
    const events: TurnEvent[] = [];
    const done = (async () => {
      const messages = [{ role: "user" as const, content: question }];
      for await (const event of streamTurn("stub", messages, campaigns, new AbortController().signal)) events.push(event);
    })();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();

    const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(text).toBe(STUB_ANSWER);
    expect(events.at(-1)).toEqual({ type: "pick", pick: validatePick(stubPick(question, campaigns), campaigns) });
  });
});
