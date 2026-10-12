import { describe, expect, it } from "vitest";
import { ariaClearingAbi } from "@aria-clearing/receipt";
import { erc20Abi } from "viem";
import {
  functionAbi,
  MONAD_TESTNET_USDC,
  normalizeAddress,
  relayerPolicy,
  testTransferPolicy,
  treasuryPolicy,
} from "../src/policy";

const clearing = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const logEventAbi = ariaClearingAbi.filter((item) => item.type === "function" && item.name === "logEvent");

describe("relayerPolicy", () => {
  it("allows only logEvent to the clearing contract on Monad testnet", () => {
    expect(relayerPolicy({ clearingAddress: clearing, abi: ariaClearingAbi })).toEqual({
      version: "1.0",
      name: "Aria relayer: logEvent only",
      chain_type: "ethereum",
      rules: [
        {
          name: "Allow logEvent on AriaClearing",
          method: "eth_sendTransaction",
          action: "ALLOW",
          conditions: [
            { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "10143" },
            {
              field_source: "ethereum_transaction",
              field: "to",
              operator: "eq",
              value: "0xabcdef0123456789abcdef0123456789abcdef01",
            },
            {
              field_source: "ethereum_calldata",
              field: "function_name",
              abi: logEventAbi,
              operator: "eq",
              value: "logEvent",
            },
          ],
        },
      ],
    });
  });

  it("embeds exactly the logEvent ABI entry", () => {
    const [entry] = functionAbi(ariaClearingAbi, "logEvent");
    expect(entry.name).toBe("logEvent");
    expect(entry.inputs?.map((input) => input.name)).toEqual([
      "requestId",
      "campaignId",
      "publisher",
      "kind",
      "rationale",
      "claimRefs",
    ]);
  });

  it("rejects a malformed clearing address", () => {
    expect(() => relayerPolicy({ clearingAddress: "0x1234", abi: ariaClearingAbi })).toThrow("Not an address");
  });
});

describe("testTransferPolicy", () => {
  it("allows send and sign to the recipient on Monad testnet only", () => {
    const policy = testTransferPolicy({ recipient: clearing });
    expect(policy.rules.map((rule) => [rule.method, rule.action])).toEqual([
      ["eth_sendTransaction", "ALLOW"],
      ["eth_signTransaction", "ALLOW"],
    ]);
    for (const rule of policy.rules) {
      expect(rule.conditions).toEqual([
        { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "10143" },
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: normalizeAddress(clearing) },
      ]);
    }
  });
});

describe("functionAbi", () => {
  it("throws when the function is absent", () => {
    expect(() => functionAbi(ariaClearingAbi, "transfer")).toThrow("Expected one function transfer");
  });
});

describe("treasuryPolicy", () => {
  const usdc = MONAD_TESTNET_USDC;
  const policy = treasuryPolicy({ clearingAddress: clearing, usdcAddress: usdc });
  const chain = { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "10143" };
  const to = (address: string) => ({
    field_source: "ethereum_transaction",
    field: "to",
    operator: "eq",
    value: address.toLowerCase(),
  });
  const entry = (abi: readonly { type: string; name?: string }[], name: string) =>
    abi.filter((item) => item.type === "function" && item.name === name);
  const calls = (abi: readonly { type: string; name?: string }[], name: string) => ({
    field_source: "ethereum_calldata",
    field: "function_name",
    abi: entry(abi, name),
    operator: "eq",
    value: name,
  });

  it("names the policy and allows four eth_sendTransaction rules", () => {
    expect(policy.version).toBe("1.0");
    expect(policy.name).toBe("Aria treasury: escrow only");
    expect(policy.chain_type).toBe("ethereum");
    expect(policy.rules.map((rule) => [rule.name, rule.method, rule.action])).toEqual([
      ["Allow USDC approve to AriaClearing", "eth_sendTransaction", "ALLOW"],
      ["Allow createCampaign on AriaClearing", "eth_sendTransaction", "ALLOW"],
      ["Allow dispute on AriaClearing", "eth_sendTransaction", "ALLOW"],
      ["Allow withdraw on AriaClearing", "eth_sendTransaction", "ALLOW"],
    ]);
  });

  it("allows USDC approve only with AriaClearing as spender", () => {
    expect(policy.rules[0].conditions).toEqual([
      chain,
      to(usdc),
      calls(erc20Abi, "approve"),
      {
        field_source: "ethereum_calldata",
        field: "approve.spender",
        abi: entry(erc20Abi, "approve"),
        operator: "eq",
        value: clearing.toLowerCase(),
      },
    ]);
  });

  it("allows createCampaign, dispute and withdraw on AriaClearing", () => {
    expect(policy.rules.slice(1).map((rule) => rule.conditions)).toEqual([
      [chain, to(clearing), calls(ariaClearingAbi, "createCampaign")],
      [chain, to(clearing), calls(ariaClearingAbi, "dispute")],
      [chain, to(clearing), calls(ariaClearingAbi, "withdraw")],
    ]);
  });

  it("allows no token transfer", () => {
    const names = policy.rules.flatMap((rule) =>
      rule.conditions.filter((condition) => condition.field === "function_name").map((condition) => condition.value),
    );
    expect(names).toEqual(["approve", "createCampaign", "dispute", "withdraw"]);
  });

  it("rejects a malformed address", () => {
    expect(() => treasuryPolicy({ clearingAddress: clearing, usdcAddress: "0x12" })).toThrow("Not an address");
  });
});
