import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { advertiserWalletOf, createWalletResolver, embeddedWalletOf } from "../lib/advertiser-wallet";

const getUser = vi.fn();

vi.mock("@aria-clearing/ops", () => ({
  privyClient: () => ({ users: () => ({ _get: getUser }) }),
}));

const EMBEDDED = "0x9f1c2a8b7e6d5c4b3a2918070605040302010abc";
const SECOND = "0x1111111111111111111111111111111111111111";
const EXTERNAL = "0x2222222222222222222222222222222222222222";

const email = { type: "email", address: "ana@crema.works" };
const external = { type: "wallet", chain_type: "ethereum", wallet_client_type: "metamask", address: EXTERNAL };
const solana = { type: "wallet", chain_type: "solana", wallet_client_type: "privy", wallet_index: 0, address: "So1ana" };
const embedded = (address: string, wallet_index: number) => ({
  type: "wallet",
  chain_type: "ethereum",
  wallet_client_type: "privy",
  connector_type: "embedded",
  wallet_index,
  address,
});

beforeEach(() => {
  getUser.mockReset();
});

describe("embeddedWalletOf", () => {
  it("picks the Privy embedded Ethereum wallet, checksummed", () => {
    expect(embeddedWalletOf([email, external, solana, embedded(EMBEDDED, 0)])).toBe(getAddress(EMBEDDED));
  });

  it("prefers the lowest wallet index", () => {
    expect(embeddedWalletOf([embedded(SECOND, 1), embedded(EMBEDDED, 0)])).toBe(getAddress(EMBEDDED));
  });

  it("ignores external and non-Ethereum wallets", () => {
    expect(embeddedWalletOf([email, external, solana])).toBeNull();
    expect(embeddedWalletOf([])).toBeNull();
  });
});

describe("advertiserWalletOf", () => {
  it("reads the user through Privy's users API by user id", async () => {
    getUser.mockResolvedValue({ id: "did:privy:ana", linked_accounts: [email, embedded(EMBEDDED, 0)] });
    const wallet = await advertiserWalletOf("did:privy:ana");
    expect(wallet).toBe(getAddress(EMBEDDED));
    expect(getUser).toHaveBeenCalledWith("did:privy:ana");
  });
});

describe("createWalletResolver", () => {
  it("caches a found wallet per user id", async () => {
    const lookup = vi.fn(async (id: string) => ({
      linked_accounts: [embedded(id === "did:privy:ana" ? EMBEDDED : SECOND, 0)],
    }));
    const resolve = createWalletResolver(lookup);
    const first = await resolve("did:privy:ana");
    expect(await resolve("did:privy:ana")).toBe(first);
    expect(await resolve("did:privy:bob")).toBe(getAddress(SECOND));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("does not cache a user without a wallet yet", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ linked_accounts: [email] })
      .mockResolvedValueOnce({ linked_accounts: [email, embedded(EMBEDDED, 0)] });
    const resolve = createWalletResolver(lookup);
    expect(await resolve("did:privy:ana")).toBeNull();
    expect(await resolve("did:privy:ana")).toBe(getAddress(EMBEDDED));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("propagates lookup failures without caching them", async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error("privy down")).mockResolvedValueOnce({
      linked_accounts: [embedded(EMBEDDED, 0)],
    });
    const resolve = createWalletResolver(lookup);
    await expect(resolve("did:privy:ana")).rejects.toThrow("privy down");
    expect(await resolve("did:privy:ana")).not.toBeNull();
  });
});
