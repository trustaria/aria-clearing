import { PrivyClient, type AuthorizationContext } from "@privy-io/node";
import { requireEnv } from "./env";

let client: PrivyClient | undefined;

/** Shared Privy client built from NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET. */
export function privyClient(): PrivyClient {
  if (!client) {
    const env = requireEnv(["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"]);
    client = new PrivyClient({ appId: env.NEXT_PUBLIC_PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  }
  return client;
}

/** Signs requests with the authorization key that owns Aria's server wallets. */
export function authorizationContext(): AuthorizationContext {
  const { PRIVY_AUTHORIZATION_KEY } = requireEnv(["PRIVY_AUTHORIZATION_KEY"]);
  return { authorization_private_keys: [PRIVY_AUTHORIZATION_KEY] };
}
