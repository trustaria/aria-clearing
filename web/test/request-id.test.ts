import { describe, expect, it } from "vitest";
import { isRequestId, newRequestId } from "../lib/request-id";

describe("newRequestId", () => {
  it("is req_ followed by 22 base62 characters", () => {
    for (let i = 0; i < 200; i++) {
      expect(newRequestId()).toMatch(/^req_[0-9A-Za-z]{22}$/);
    }
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRequestId()));
    expect(ids.size).toBe(1000);
  });

  it("isRequestId accepts minted ids and rejects others", () => {
    expect(isRequestId(newRequestId())).toBe(true);
    expect(isRequestId("req_short")).toBe(false);
    expect(isRequestId("req_" + "a".repeat(21) + "!")).toBe(false);
  });
});
