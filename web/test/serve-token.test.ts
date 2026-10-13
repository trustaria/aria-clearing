import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_TOKEN_SECRET, signImpressionToken, tokenSecret, verifyImpressionToken } from "../lib/serve/token";

const ID = "req_0123456789abcdefABCDEF";
const OTHER = "req_zzzzzzzzzzzzzzzzzzzzzz";
const SECRET = "token-secret-for-tests";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("impression tokens", () => {
  it("is the request id, a dot, then a base64url HMAC", () => {
    const token = signImpressionToken(ID, SECRET);
    expect(token).toMatch(/^req_[0-9A-Za-z]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(token.startsWith(`${ID}.`)).toBe(true);
    expect(signImpressionToken(ID, SECRET)).toBe(token);
    expect(signImpressionToken(OTHER, SECRET)).not.toBe(token);
  });

  it("verifies to its request id", () => {
    expect(verifyImpressionToken(signImpressionToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("rejects a token signed with another secret", () => {
    expect(verifyImpressionToken(signImpressionToken(ID, "other"), SECRET)).toBeNull();
  });

  it("rejects a MAC moved onto another request id", () => {
    const mac = signImpressionToken(ID, SECRET).split(".")[1];
    expect(verifyImpressionToken(`${OTHER}.${mac}`, SECRET)).toBeNull();
  });

  it("rejects a tampered or truncated MAC", () => {
    const token = signImpressionToken(ID, SECRET);
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyImpressionToken(flipped, SECRET)).toBeNull();
    expect(verifyImpressionToken(token.slice(0, -4), SECRET)).toBeNull();
    expect(verifyImpressionToken(`${token}x`, SECRET)).toBeNull();
  });

  it.each([
    ["an empty token", ""],
    ["no dot", ID],
    ["an empty MAC", `${ID}.`],
    ["a malformed request id", "req_short.abc"],
    ["two dots", `${ID}.a.b`],
  ])("rejects %s", (_name, token) => {
    expect(verifyImpressionToken(token, SECRET)).toBeNull();
  });

  it("rejects everything with an empty secret", () => {
    expect(verifyImpressionToken(signImpressionToken(ID, ""), "")).toBeNull();
  });
});

describe("tokenSecret", () => {
  it("reads ARIA_TOKEN_SECRET", () => {
    vi.stubEnv("ARIA_TOKEN_SECRET", "s3cret");
    expect(tokenSecret()).toBe("s3cret");
  });

  it("falls back to the dev secret outside production only", () => {
    vi.stubEnv("ARIA_TOKEN_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(tokenSecret()).toBe(DEV_TOKEN_SECRET);
    vi.stubEnv("NODE_ENV", "production");
    expect(tokenSecret()).toBeUndefined();
  });
});
