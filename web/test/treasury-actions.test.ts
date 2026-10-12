import { ariaClearingAbi, campaignIdOf } from "@aria-clearing/receipt";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  type Hex,
  type Log,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPUTE_GAS,
  disputeEvent,
  type TreasuryDeps,
  WITHDRAW_GAS,
  withdrawCampaign,
  withdrawnAmount,
} from "../lib/treasury";

const TREASURY = "0x1C2222B3D0D8C3909453dFFb39ff43f06DDF1B11";
const CLEARING = "0xfb6bA8e6c48c806AFC40aFee5F85deE42Ce8F2fb";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const TX = `0x${"ab".repeat(32)}` as Hex;
const CAMPAIGN = campaignIdOf("crema-works-a1b2");
const OTHER_CAMPAIGN = campaignIdOf("other-0000");
const EVENT = `0x${"0e".repeat(32)}` as Hex;
const NOW_MS = 1_700_000_100_000;
const WINDOW = 20;

/** A Withdrawn log as the clearing contract emits it. */
function withdrawnLog(campaignId: Hex, amount: bigint, address: string = CLEARING): Log {
  return {
    address: address as Hex,
    topics: encodeEventTopics({ abi: ariaClearingAbi, eventName: "Withdrawn", args: { campaignId } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    blockHash: `0x${"11".repeat(32)}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: TX,
    transactionIndex: 0,
    removed: false,
  };
}

function reverted(functionName: "dispute" | "withdraw", errorName: string, args: readonly unknown[]) {
  const cause = new ContractFunctionRevertedError({
    abi: ariaClearingAbi,
    functionName,
    data: encodeErrorResult({ abi: ariaClearingAbi, errorName: errorName as never }),
  });
  return new ContractFunctionExecutionError(cause, {
    abi: ariaClearingAbi,
    functionName,
    args,
    contractAddress: CLEARING,
  });
}

/** Fake chain and Privy sender; `event` is what the clearingEvent view returns. */
function fakeTreasury({
  event = { campaignId: CAMPAIGN, status: 1, loggedAt: BigInt(NOW_MS / 1000 - 5) },
  logs = [withdrawnLog(CAMPAIGN, 3_770_000n)],
}: { event?: { campaignId: Hex; status: number; loggedAt: bigint }; logs?: Log[] } = {}) {
  const sent: { walletId: string; to: string; data: Hex; gasLimit: bigint | number }[] = [];
  const client = {
    readContract: vi.fn(async () => event),
    simulateContract: vi.fn(async ({ functionName }: { functionName: string }) => ({
      request: {},
      result: functionName === "withdraw" ? 3_770_000n : undefined,
    })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 70_500_200n, logs })),
  };
  const treasury: TreasuryDeps = {
    address: TREASURY,
    walletId: "treasury-wallet",
    clearing: CLEARING,
    usdc: USDC,
    client: client as never,
    send: vi.fn(async (walletId, tx) => {
      sent.push({ walletId, ...tx });
      return TX;
    }),
  };
  return { treasury, client, sent };
}

const clock = { window: WINDOW, now: () => NOW_MS };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("withdrawnAmount", () => {
  it("reads the amount of this campaign's Withdrawn log from the clearing contract", () => {
    const logs = [
      withdrawnLog(OTHER_CAMPAIGN, 1n),
      withdrawnLog(CAMPAIGN, 9n, "0x0000000000000000000000000000000000000001"),
      withdrawnLog(CAMPAIGN, 3_770_000n),
    ];
    expect(withdrawnAmount(logs, CLEARING, CAMPAIGN)).toBe(3_770_000n);
  });

  it("reads a zero refund", () => {
    expect(withdrawnAmount([withdrawnLog(CAMPAIGN, 0n)], CLEARING, CAMPAIGN)).toBe(0n);
  });

  it("is null without a matching log", () => {
    expect(withdrawnAmount([withdrawnLog(OTHER_CAMPAIGN, 5n)], CLEARING, CAMPAIGN)).toBeNull();
  });
});

describe("disputeEvent", () => {
  it("simulates, then sends dispute(eventId) from the treasury with the dispute gas limit", async () => {
    const { treasury, client, sent } = fakeTreasury();
    await expect(disputeEvent(CAMPAIGN, EVENT, treasury, clock)).resolves.toEqual({ txHash: TX });
    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ account: TREASURY, address: CLEARING, functionName: "dispute", args: [EVENT] }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ walletId: "treasury-wallet", to: CLEARING, gasLimit: DISPUTE_GAS });
    expect(decodeFunctionData({ abi: ariaClearingAbi, data: sent[0].data })).toEqual({
      functionName: "dispute",
      args: [EVENT],
    });
  });

  it("refuses an event of another campaign without sending", async () => {
    const { treasury, sent } = fakeTreasury({ event: { campaignId: OTHER_CAMPAIGN, status: 1, loggedAt: 0n } });
    await expect(disputeEvent(CAMPAIGN, EVENT, treasury, clock)).rejects.toMatchObject({ code: "not-found" });
    expect(sent).toEqual([]);
  });

  it("refuses once the window has closed", async () => {
    const loggedAt = BigInt(NOW_MS / 1000 - WINDOW);
    const { treasury, sent } = fakeTreasury({ event: { campaignId: CAMPAIGN, status: 1, loggedAt } });
    await expect(disputeEvent(CAMPAIGN, EVENT, treasury, clock)).rejects.toMatchObject({ code: "window-closed" });
    expect(sent).toEqual([]);
  });

  it("refuses a settled event as closed and a disputed one as already disputed", async () => {
    const settled = fakeTreasury({ event: { campaignId: CAMPAIGN, status: 3, loggedAt: BigInt(NOW_MS / 1000) } });
    await expect(disputeEvent(CAMPAIGN, EVENT, settled.treasury, clock)).rejects.toMatchObject({ code: "window-closed" });
    const disputed = fakeTreasury({ event: { campaignId: CAMPAIGN, status: 2, loggedAt: BigInt(NOW_MS / 1000) } });
    await expect(disputeEvent(CAMPAIGN, EVENT, disputed.treasury, clock)).rejects.toMatchObject({
      code: "already-disputed",
    });
  });

  it("maps a NotDisputable simulation revert to a closed window", async () => {
    const { treasury, client, sent } = fakeTreasury();
    client.simulateContract.mockRejectedValueOnce(reverted("dispute", "NotDisputable", [EVENT]));
    await expect(disputeEvent(CAMPAIGN, EVENT, treasury, clock)).rejects.toMatchObject({ code: "window-closed" });
    expect(sent).toEqual([]);
  });

  it("fails when the send is denied", async () => {
    const { treasury } = fakeTreasury();
    treasury.send = async () => {
      throw new Error("policy_violation");
    };
    await expect(disputeEvent(CAMPAIGN, EVENT, treasury, clock)).rejects.toMatchObject({ code: "failed" });
  });
});

describe("withdrawCampaign", () => {
  it("sends withdraw(campaignId) and returns the Withdrawn amount", async () => {
    const { treasury, client, sent } = fakeTreasury({ logs: [withdrawnLog(CAMPAIGN, 3_500_000n)] });
    await expect(withdrawCampaign(CAMPAIGN, treasury)).resolves.toEqual({ amount: 3_500_000n, txHash: TX });
    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ account: TREASURY, address: CLEARING, functionName: "withdraw", args: [CAMPAIGN] }),
    );
    expect(sent[0]).toMatchObject({ to: CLEARING, gasLimit: WITHDRAW_GAS });
    expect(decodeFunctionData({ abi: ariaClearingAbi, data: sent[0].data })).toEqual({
      functionName: "withdraw",
      args: [CAMPAIGN],
    });
  });

  it("falls back to the simulated amount when the receipt has no Withdrawn log", async () => {
    const { treasury } = fakeTreasury({ logs: [] });
    await expect(withdrawCampaign(CAMPAIGN, treasury)).resolves.toEqual({ amount: 3_770_000n, txHash: TX });
  });

  it("fails without sending when the simulation reverts", async () => {
    const { treasury, client, sent } = fakeTreasury();
    client.simulateContract.mockRejectedValueOnce(reverted("withdraw", "NotAdvertiser", [CAMPAIGN]));
    await expect(withdrawCampaign(CAMPAIGN, treasury)).rejects.toMatchObject({ code: "failed" });
    expect(sent).toEqual([]);
  });

  it("fails when the tx reverts", async () => {
    const { treasury, client } = fakeTreasury();
    client.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted", blockNumber: 1n, logs: [] });
    await expect(withdrawCampaign(CAMPAIGN, treasury)).rejects.toMatchObject({ code: "failed" });
  });
});
