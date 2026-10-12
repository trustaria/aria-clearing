import { privyClient } from "@aria-clearing/ops/src/privy";

export type Advertiser = { userId: string };

/** Verifies a Privy access token and returns the Privy user id. Throws when the token is invalid. */
export type TokenVerifier = (token: string) => Promise<{ userId: string }>;

export const UNAUTHORIZED_MESSAGE = "Sign in to continue.";

/** Verifies the token with Privy's app JWKS. */
export const verifyPrivyToken: TokenVerifier = async (token) => {
  const claims = await privyClient().utils().auth().verifyAccessToken(token);
  return { userId: claims.user_id };
};

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** The signed-in advertiser from `Authorization: Bearer <token>`, or a 401 response. */
export async function verifyAdvertiser(
  req: Request,
  verify: TokenVerifier = verifyPrivyToken,
): Promise<Advertiser | Response> {
  const token = bearerToken(req);
  if (!token) return unauthorized();
  try {
    const { userId } = await verify(token);
    return userId ? { userId } : unauthorized();
  } catch (err) {
    console.warn(`advertiser token rejected: ${err instanceof Error ? err.message : String(err)}`);
    return unauthorized();
  }
}

export function unauthorized(): Response {
  return Response.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401, headers: { "cache-control": "no-store" } });
}
