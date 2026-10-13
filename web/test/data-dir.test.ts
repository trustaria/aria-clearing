import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campaignStore, type StoredCampaign } from "../lib/campaign-store";
import { dataFile } from "../lib/data-dir";
import { publisherStore } from "../lib/publisher";
import { eventStore } from "../lib/store";

const ALICE = "0x1111111111111111111111111111111111111111";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aria-data-dir-"));
  delete process.env.ARIA_DATA_DIR;
  delete process.env.ARIA_EVENTS_FILE;
  delete process.env.ARIA_CAMPAIGNS_FILE;
  delete process.env.ARIA_PUBLISHER_FILE;
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("dataFile", () => {
  it("defaults to .data under the working directory", () => {
    expect(dataFile("events.json")).toBe(join(process.cwd(), ".data", "events.json"));
  });

  it("uses ARIA_DATA_DIR and creates it when missing", () => {
    const base = join(dir, "volume", "aria");
    vi.stubEnv("ARIA_DATA_DIR", base);
    expect(dataFile("events.json")).toBe(join(base, "events.json"));
    expect(existsSync(base)).toBe(true);
  });

  it("lets a per-file override win over ARIA_DATA_DIR", () => {
    vi.stubEnv("ARIA_DATA_DIR", join(dir, "volume"));
    expect(dataFile("events.json", join(dir, "own.json"))).toBe(join(dir, "own.json"));
  });

  it("treats an empty override as unset", () => {
    vi.stubEnv("ARIA_DATA_DIR", join(dir, "volume"));
    expect(dataFile("events.json", "")).toBe(join(dir, "volume", "events.json"));
  });
});

describe("stores under ARIA_DATA_DIR", () => {
  it("writes events.json, campaigns.json and publisher.json there", () => {
    vi.stubEnv("ARIA_DATA_DIR", dir);
    eventStore().putServed({
      requestId: "req_datadir",
      slug: "x",
      campaignId: `0x${"00".repeat(32)}`,
      rationale: "",
      claimRefs: [],
      servedAt: 1,
    });
    expect(existsSync(join(dir, "events.json"))).toBe(true);

    campaignStore().saveCampaign({ slug: "datadir-test" } as StoredCampaign);
    expect(existsSync(join(dir, "campaigns.json"))).toBe(true);

    publisherStore.set(ALICE);
    expect(JSON.parse(readFileSync(join(dir, "publisher.json"), "utf8"))).toEqual({ address: ALICE });
    expect(publisherStore.get()).toBe(ALICE);
  });

  it("keeps ARIA_PUBLISHER_FILE over ARIA_DATA_DIR", () => {
    vi.stubEnv("ARIA_DATA_DIR", join(dir, "volume"));
    vi.stubEnv("ARIA_PUBLISHER_FILE", join(dir, "pub.json"));
    publisherStore.set(ALICE);
    expect(existsSync(join(dir, "pub.json"))).toBe(true);
    expect(existsSync(join(dir, "volume", "publisher.json"))).toBe(false);
  });
});
