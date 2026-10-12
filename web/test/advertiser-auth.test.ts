import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as draftPOST } from "../app/api/advertise/draft/route";
import { verifyAdvertiser, UNAUTHORIZED_MESSAGE } from "../lib/advertiser-auth";

const verifyAccessToken = vi.fn();

vi.mock("@aria-clearing/ops/src/privy", () => ({
  privyClient: () => ({ utils: () => ({ auth: () => ({ verifyAccessToken }) }) }),
}));

function request(authorization?: string) {
  return new Request("http://x/api/advertise/campaigns", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  verifyAccessToken.mockReset();
  verifyAccessToken.mockImplementation(async (token: string) => {
    if (token !== "good-token") throw new Error("invalid token");
    return { user_id: "did:privy:alice" };
  });
});

describe("verifyAdvertiser", () => {
  it("returns the Privy user id for a valid bearer token", async () => {
    expect(await verifyAdvertiser(request("Bearer good-token"))).toEqual({ userId: "did:privy:alice" });
    expect(verifyAccessToken).toHaveBeenCalledWith("good-token");
  });

  it.each([[undefined], ["good-token"], ["Basic good-token"], ["Bearer "]])(
    "answers 401 without a bearer token (%s)",
    async (header) => {
      const res = await verifyAdvertiser(request(header));
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(401);
      expect(await (res as Response).json()).toEqual({ error: UNAUTHORIZED_MESSAGE });
      expect(verifyAccessToken).not.toHaveBeenCalled();
    },
  );

  it("answers 401 when Privy rejects the token", async () => {
    const res = await verifyAdvertiser(request("Bearer forged"));
    expect((res as Response).status).toBe(401);
  });
});

describe("POST /api/advertise/draft auth", () => {
  it("answers 401 without a token", async () => {
    const res = await draftPOST(
      new Request("http://x/api/advertise/draft", { method: "POST", body: JSON.stringify({ brand: "Crema" }) }),
    );
    expect(res.status).toBe(401);
  });

  it("validates once the token is valid", async () => {
    const res = await draftPOST(
      new Request("http://x/api/advertise/draft", {
        method: "POST",
        headers: { authorization: "Bearer good-token" },
        body: JSON.stringify({ brand: "A" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
