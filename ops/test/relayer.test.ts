import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "@privy-io/node";
import { privyErrorCode, sendFromRelayer, sendFromWallet } from "../src/relayer";

type SendCall = {
  walletId: string;
  body: Record<string, unknown>;
  resolve: (hash: string) => void;
  reject: (err: unknown) => void;
};

const calls: SendCall[] = [];

vi.mock("../src/privy", () => ({
  authorizationContext: () => ({ authorization_private_keys: ["test-key"] }),
  privyClient: () => ({
    wallets: () => ({
      ethereum: () => ({
        sendTransaction: (walletId: string, body: Record<string, unknown>) =>
          new Promise((resolve, reject) => {
            calls.push({ walletId, body, resolve: (hash) => resolve({ hash }), reject });
          }),
      }),
    }),
  }),
}));

const tx = { to: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", data: "0x1234" as const, gasLimit: 150_000 };

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

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

describe("sendFromWallet", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("sends a zero-value call on Monad testnet with a hex gas limit", async () => {
    const hash = sendFromWallet("wallet-a", tx);
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].walletId).toBe("wallet-a");
    expect(calls[0].body).toEqual({
      caip2: "eip155:10143",
      authorization_context: { authorization_private_keys: ["test-key"] },
      params: {
        transaction: {
          to: "0xabcdef0123456789abcdef0123456789abcdef01",
          data: "0x1234",
          value: "0x0",
          chain_id: 10143,
          gas_limit: "0x249f0",
        },
      },
    });
    calls[0].resolve("0xaa");
    await expect(hash).resolves.toBe("0xaa");
  });

  it("sends one transaction at a time per wallet, in call order", async () => {
    const first = sendFromWallet("wallet-a", tx);
    const second = sendFromWallet("wallet-a", { ...tx, data: "0x5678" });
    await settle();
    expect(calls.map((call) => call.body)).toHaveLength(1);

    calls[0].resolve("0x01");
    await expect(first).resolves.toBe("0x01");
    await settle();
    expect(calls).toHaveLength(2);
    expect((calls[1].body.params as { transaction: { data: string } }).transaction.data).toBe("0x5678");
    calls[1].resolve("0x02");
    await expect(second).resolves.toBe("0x02");
  });

  it("does not make one wallet wait for another", async () => {
    sendFromWallet("wallet-a", tx);
    sendFromWallet("wallet-b", tx);
    await settle();
    expect(calls.map((call) => call.walletId)).toEqual(["wallet-a", "wallet-b"]);
    for (const call of calls) call.resolve("0x00");
  });

  it("keeps the queue moving after a failed send", async () => {
    const failed = sendFromWallet("wallet-a", tx);
    const next = sendFromWallet("wallet-a", tx);
    await settle();
    calls[0].reject(new Error("denied"));
    await expect(failed).rejects.toThrow("denied");
    await settle();
    expect(calls).toHaveLength(2);
    calls[1].resolve("0x03");
    await expect(next).resolves.toBe("0x03");
  });
});

describe("sendFromRelayer", () => {
  const saved = process.env.RELAYER_WALLET_ID;

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.RELAYER_WALLET_ID;
    else process.env.RELAYER_WALLET_ID = saved;
  });

  it("sends from RELAYER_WALLET_ID", async () => {
    process.env.RELAYER_WALLET_ID = "relayer-wallet";
    const hash = sendFromRelayer(tx);
    await settle();
    expect(calls[0].walletId).toBe("relayer-wallet");
    calls[0].resolve("0xbb");
    await expect(hash).resolves.toBe("0xbb");
  });

  it("rejects when RELAYER_WALLET_ID is missing", async () => {
    delete process.env.RELAYER_WALLET_ID;
    await expect(sendFromRelayer(tx)).rejects.toThrow("Missing env: RELAYER_WALLET_ID");
  });
});
