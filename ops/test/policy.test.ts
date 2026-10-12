import { describe, expect, it } from "vitest";
import { ariaClearingAbi } from "@aria-clearing/receipt";
import { functionAbi, normalizeAddress, relayerPolicy, testTransferPolicy } from "../src/policy";

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
