import { describe, expect, it } from "vitest";
import { APIError } from "@privy-io/node";
import { privyErrorCode } from "../src/relayer";

describe("privyErrorCode", () => {
  it("reads the code from a Privy API error body", () => {
    const denied = new APIError(
      400,
      { error: "RPC request denied due to policy violation", code: "policy_violation" },
      undefined,
      new Headers(),
    );
    expect(privyErrorCode(denied)).toBe("policy_violation");
  });

  it("returns undefined for other errors", () => {
    expect(privyErrorCode(new Error("network down"))).toBeUndefined();
    expect(privyErrorCode(new APIError(500, undefined, "boom", new Headers()))).toBeUndefined();
  });
});
