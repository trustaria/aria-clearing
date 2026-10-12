import { describe, expect, it } from "vitest";
import { envLines, missingEnv, requireEnv } from "../src/env";

const env = { PRIVY_APP_SECRET: "super-secret-value", EMPTY: "" };

describe("missingEnv", () => {
  it("lists unset and empty names", () => {
    expect(missingEnv(["PRIVY_APP_SECRET", "EMPTY", "RELAYER_WALLET_ID"], env)).toEqual(["EMPTY", "RELAYER_WALLET_ID"]);
  });
});

describe("requireEnv", () => {
  it("returns the requested values", () => {
    expect(requireEnv(["PRIVY_APP_SECRET"], env)).toEqual({ PRIVY_APP_SECRET: "super-secret-value" });
  });

  it("names the missing variables without printing any value", () => {
    let message = "";
    try {
      requireEnv(["PRIVY_APP_SECRET", "EMPTY", "RELAYER_WALLET_ID"], env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Missing env: EMPTY, RELAYER_WALLET_ID");
    expect(message).not.toContain("super-secret-value");
  });
});

describe("envLines", () => {
  it("adds a leading newline when the file does not end with one", () => {
    expect(envLines({ A: "1", B: "2" }, "X=0")).toBe("\nA=1\nB=2\n");
    expect(envLines({ A: "1" }, "X=0\n")).toBe("A=1\n");
    expect(envLines({ A: "1" }, "")).toBe("A=1\n");
  });
});
