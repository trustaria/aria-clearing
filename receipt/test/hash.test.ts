import { describe, expect, it } from "vitest";
import {
  campaignIdOf,
  claimsHash,
  eventIdOf,
  formatClaims,
  Kind,
  normalizeRationale,
  rationaleHash,
  requestKeyOf,
} from "../src/hash";

// Expected values computed with Foundry's `cast keccak` / `cast abi-encode`.

describe("formatClaims", () => {
  it("numbers claims one per line with no trailing newline", () => {
    expect(formatClaims(["Kids under 6 stay free.", "Free cancellation up to 48 hours."])).toBe(
      "1. Kids under 6 stay free.\n2. Free cancellation up to 48 hours.",
    );
  });
});

describe("claimsHash", () => {
  it("matches keccak256 of the formatted claims bytes", () => {
    const claims = formatClaims(["Kids under 6 stay free.", "Free cancellation up to 48 hours."]);
    expect(claimsHash(claims)).toBe("0x155c6c5caa210804e80f17afd5b90251921b46868651c55819fa764c2fd024e0");
  });
});

describe("rationaleHash", () => {
  it("matches keccak256 of the rendered string", () => {
    expect(rationaleHash("Great for families: kids under 6 stay free.")).toBe(
      "0xd55ffa3ba90048d34cdd0874a6ba579e469c1bf06c315535d4ba43942701decd",
    );
  });

  it("trims surrounding whitespace before hashing", () => {
    expect(rationaleHash("  Great for families: kids under 6 stay free.\n")).toBe(
      "0xd55ffa3ba90048d34cdd0874a6ba579e469c1bf06c315535d4ba43942701decd",
    );
  });

  it("hashes decomposed and composed accents identically (NFC)", () => {
    expect(rationaleHash("Café tours")).toBe(
      "0xca053e1cde01fbe6600082feee346853d945ec09ec69bba7d512dbeb81028ba7",
    );
  });
});

describe("normalizeRationale", () => {
  it("returns the exact string the card must render", () => {
    expect(normalizeRationale("  Café tours ")).toBe("Café tours");
  });
});

describe("requestKeyOf", () => {
  it("matches keccak256 of the requestId bytes", () => {
    expect(requestKeyOf("req_abc123")).toBe("0xb6a2cb77e9c8c6f1ed8226260e11fea17273014ee60eae7644bfff9bf9b3fa6f");
  });
});

describe("eventIdOf", () => {
  it("matches keccak256(abi.encode(requestId, kind)) for an impression", () => {
    expect(eventIdOf("req_abc123", Kind.Impression)).toBe(
      "0x673bf8a383caa51748da8ca62a2121fc3744beccd9cb0e19626d01ae5ca87d42",
    );
  });

  it("gives a click a different id from the impression of the same request", () => {
    expect(eventIdOf("req_abc123", Kind.Click)).toBe(
      "0x69edfc15efb6e739388682ec01a3a55eb59d47e8c08765dde2c2a02d68b63503",
    );
  });
});

describe("campaignIdOf", () => {
  it("matches keccak256 of the campaign slug bytes", () => {
    expect(campaignIdOf("lisbon-family-trips")).toBe(
      "0xebe836eea8bdd51ca542ca8da86d4d6bb1072dd47e7a319e57660019c6ded33f",
    );
  });
});
