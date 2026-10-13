import { privyClient } from "@aria-clearing/ops";
import { getAddress, isAddress, type Address } from "viem";

/** The fields of a Privy linked account this module reads. */
export type LinkedAccount = {
  type: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  wallet_index?: number;
};

/** Reads a Privy user by user id. */
export type UserLookup = (userId: string) => Promise<{ linked_accounts: LinkedAccount[] }>;

/** The user's Privy embedded Ethereum wallet (lowest wallet index), or null without one. Pure. */
export function embeddedWalletOf(accounts: LinkedAccount[]): Address | null {
  const wallets = accounts
    .filter(
      (a) =>
        a.type === "wallet" &&
        a.chain_type === "ethereum" &&
        a.wallet_client_type === "privy" &&
        typeof a.address === "string" &&
        isAddress(a.address, { strict: false }),
    )
    .sort((a, b) => (a.wallet_index ?? 0) - (b.wallet_index ?? 0));
  return wallets.length ? getAddress(wallets[0].address as string) : null;
}

/** Resolves a user id to its embedded wallet through `lookup`; found addresses are cached per user id. */
export function createWalletResolver(lookup: UserLookup): (userId: string) => Promise<Address | null> {
  const cache = new Map<string, Address>();
  return async (userId) => {
    const cached = cache.get(userId);
    if (cached) return cached;
    const user = await lookup(userId);
    const wallet = embeddedWalletOf(user.linked_accounts ?? []);
    if (wallet) cache.set(userId, wallet);
    return wallet;
  };
}

/** Privy users API: `GET /v1/users/{id}`. */
const fetchUser: UserLookup = (userId) => privyClient().users()._get(userId);

/** The signed-in advertiser's embedded wallet, looked up server-side from the verified Privy user id. */
export const advertiserWalletOf = createWalletResolver(fetchUser);
