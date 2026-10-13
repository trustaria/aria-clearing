import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as demoKeyCheck } from "../app/api/aria/demo-key/route";
import { POST as dispute } from "../app/api/aria/dispute/route";
import { GET as listEvents, POST as postEvent } from "../app/api/aria/events/route";
import { POST as forge } from "../app/api/aria/forge/route";
import { createPublisherHandlers } from "../app/api/aria/publisher/handlers";
import { POST as relayerPay } from "../app/api/aria/relayer-pay/route";
import { hasDemoKey, requireDemoKey } from "../lib/demo-key";
import { DEMO_KEY_HEADER, demoKeyHeaders, forgetDemoKey, saveDemoKey, storedDemoKey, takeDebugParam } from "../lib/demo-key-client";
import type { PublisherStore } from "../lib/publisher";

const KEY = "s3cret-demo-key";
const ADDRESS = "0xd2d508841c0c99d31c78c03c94338d88ca19416b";

function req(url: string, init: { method?: string; key?: string; body?: unknown } = {}): Request {
  return new Request(`http://localhost${url}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(init.key !== undefined ? { [DEMO_KEY_HEADER]: init.key } : {}),
    },
    body: init.method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
  });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-demo-key-"));
  vi.stubEnv("ARIA_DATA_DIR", dir);
  vi.stubEnv("ARIA_EVENTS_FILE", join(dir, "events.json"));
  vi.stubEnv("ARIA_PUBLISHER_FILE", join(dir, "publisher.json"));
  vi.stubEnv("PUBLISHER_ADDRESS", "");
  vi.stubEnv("ARIA_DEMO_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("hasDemoKey / requireDemoKey", () => {
  it("lets every request through when ARIA_DEMO_KEY is unset", () => {
    expect(requireDemoKey(req("/x"))).toBeNull();
    expect(hasDemoKey(req("/x", { key: "anything" }))).toBe(false);
  });

  it("accepts only the exact key once ARIA_DEMO_KEY is set", async () => {
    vi.stubEnv("ARIA_DEMO_KEY", KEY);
    expect(requireDemoKey(req("/x", { key: KEY }))).toBeNull();
    expect(hasDemoKey(req("/x", { key: KEY }))).toBe(true);
    for (const key of [undefined, "", "wrong", `${KEY}x`, KEY.slice(1)]) {
      const denied = requireDemoKey(req("/x", { key }));
      expect(denied?.status).toBe(403);
      expect(hasDemoKey(req("/x", { key }))).toBe(false);
    }
    expect(await requireDemoKey(req("/x"))!.json()).toEqual({ error: "This demo control is locked." });
  });
});

/** Each gated route with an empty store answers its own early 4xx when the request may go on. */
const GATED: [string, (r: Request) => Promise<Response> | Response, number][] = [
  ["POST /api/aria/forge", (r) => forge(r), 409],
  ["POST /api/aria/dispute", (r) => dispute(r), 409],
  ["POST /api/aria/relayer-pay", (r) => relayerPay(r), 409],
  ["GET /api/aria/events", (r) => listEvents(r), 200],
  ["GET /api/aria/demo-key", (r) => demoKeyCheck(r), 200],
];

describe.each(GATED)("%s", (_name, handler, passStatus) => {
  it("works without a key when ARIA_DEMO_KEY is unset", async () => {
    expect((await handler(req("/x"))).status).toBe(passStatus);
  });

  it("answers 403 without the key or with a wrong one", async () => {
    vi.stubEnv("ARIA_DEMO_KEY", KEY);
    expect((await handler(req("/x"))).status).toBe(403);
    expect((await handler(req("/x", { key: "wrong" }))).status).toBe(403);
  });

  it("goes on with the key", async () => {
    vi.stubEnv("ARIA_DEMO_KEY", KEY);
    expect((await handler(req("/x", { key: KEY }))).status).toBe(passStatus);
  });
});

describe("POST /api/aria/publisher", () => {
  function handlers() {
    const store: PublisherStore = { get: () => undefined, set: vi.fn() };
    return { store, ...createPublisherHandlers({ store, load: vi.fn(async () => ({})) as never }) };
  }

  it("registers without a key when ARIA_DEMO_KEY is unset", async () => {
    const { POST, store } = handlers();
    expect((await POST(req("/api/aria/publisher", { body: { address: ADDRESS } }))).status).toBe(200);
    expect(store.set).toHaveBeenCalled();
  });

  it("needs the key once ARIA_DEMO_KEY is set", async () => {
    vi.stubEnv("ARIA_DEMO_KEY", KEY);
    const { POST, store } = handlers();
    expect((await POST(req("/api/aria/publisher", { body: { address: ADDRESS } }))).status).toBe(403);
    expect(store.set).not.toHaveBeenCalled();
    expect((await POST(req("/api/aria/publisher", { key: KEY, body: { address: ADDRESS } }))).status).toBe(200);
    expect(store.set).toHaveBeenCalled();
  });

  it("keeps the dashboard read open", async () => {
    vi.stubEnv("ARIA_DEMO_KEY", KEY);
    const { GET } = handlers();
    expect((await GET(req(`/api/aria/publisher?address=${ADDRESS}`, { method: "GET" }))).status).toBe(200);
  });
});

describe("visitor routes stay open with ARIA_DEMO_KEY set", () => {
  it("logs impressions without the key", async () => {
    vi.stubEnv("ARIA_DEMO_KEY", KEY);
    const res = await postEvent(req("/api/aria/events", { body: { requestId: "req_zzzzzzzzzzzzzzzzzzzzzz", kind: "impression", viewMs: 1000, visibleRatio: 1 } }));
    expect(res.status).toBe(404);
  });
});

describe("demo key in the browser", () => {
  function memory() {
    const values = new Map<string, string>();
    return {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    };
  }

  it("takes the debug param out of the URL and keeps the rest", () => {
    expect(takeDebugParam("https://nova.app/?debug=abc&x=1#top")).toEqual({ value: "abc", cleaned: "/?x=1#top" });
    expect(takeDebugParam("https://nova.app/advertise?debug=abc")).toEqual({ value: "abc", cleaned: "/advertise" });
    expect(takeDebugParam("https://nova.app/?x=1")).toEqual({ value: null, cleaned: "/?x=1" });
  });

  it("stores, sends and forgets the key", () => {
    const storage = memory();
    expect(demoKeyHeaders(storage)).toEqual({});
    saveDemoKey(KEY, storage);
    expect(storedDemoKey(storage)).toBe(KEY);
    expect(demoKeyHeaders(storage)).toEqual({ [DEMO_KEY_HEADER]: KEY });
    forgetDemoKey(storage);
    expect(storedDemoKey(storage)).toBeNull();
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveDemoKey(KEY, broken)).not.toThrow();
    expect(storedDemoKey(broken)).toBeNull();
    expect(() => forgetDemoKey(broken)).not.toThrow();
    expect(demoKeyHeaders(null)).toEqual({});
    expect(demoKeyHeaders()).toEqual({});
  });
});
