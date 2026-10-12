import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPublisherStore } from "../lib/publisher";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

describe("publisher store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-publisher-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the env address when no publisher logged in", () => {
    const store = createPublisherStore(join(dir, "publisher.json"), ALICE);
    expect(store.get()).toBe(ALICE);
  });

  it("returns undefined with no login and no fallback", () => {
    const store = createPublisherStore(join(dir, "publisher.json"), undefined);
    expect(store.get()).toBeUndefined();
  });

  it("prefers the logged-in publisher over the fallback", () => {
    const store = createPublisherStore(join(dir, "publisher.json"), ALICE);
    store.set(BOB);
    expect(store.get()).toBe(BOB);
  });

  it("keeps the publisher across a restart", () => {
    createPublisherStore(join(dir, "publisher.json"), undefined).set(BOB);
    expect(createPublisherStore(join(dir, "publisher.json"), undefined).get()).toBe(BOB);
  });

  it("rejects a malformed address", () => {
    const store = createPublisherStore(join(dir, "publisher.json"), undefined);
    expect(() => store.set("0x123")).toThrow("Invalid publisher address");
  });
});
