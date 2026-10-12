import { ariaClearingAbi } from "@aria-clearing/receipt";
import type { AbiSchema, PolicyCreateParams } from "@privy-io/node/resources";
import { erc20Abi } from "viem";

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_TESTNET_CAIP2 = `eip155:${MONAD_TESTNET_CHAIN_ID}`;
/** Circle USDC on Monad testnet, the token AriaClearing escrows. */
export const MONAD_TESTNET_USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

type PolicyBody = Omit<PolicyCreateParams, "owner" | "owner_id" | "privy-idempotency-key">;
type Rule = PolicyCreateParams.Rule;
type Condition = Rule["conditions"][number];
type AbiItem = { readonly type: string; readonly name?: string };

/** Lowercase address, so policy values and request `to` fields compare equal. */
export function normalizeAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Not an address: ${address}`);
  return address.toLowerCase();
}

/** The single function entry `name` from `abi`. */
export function functionAbi(abi: readonly AbiItem[], name: string): AbiSchema {
  const items = abi.filter((item) => item.type === "function" && item.name === name);
  if (items.length !== 1) throw new Error(`Expected one function ${name} in ABI, found ${items.length}`);
  return items as unknown as AbiSchema;
}

function onMonadTestnet(): Condition {
  return {
    field_source: "ethereum_transaction",
    field: "chain_id",
    operator: "eq",
    value: String(MONAD_TESTNET_CHAIN_ID),
  };
}

function toAddress(address: string): Condition {
  return { field_source: "ethereum_transaction", field: "to", operator: "eq", value: normalizeAddress(address) };
}

/** Allows only `logEvent` calls to the clearing contract on Monad testnet; everything else falls to default deny. */
export function relayerPolicy(input: { clearingAddress: string; abi: readonly AbiItem[] }): PolicyBody {
  return {
    version: "1.0",
    name: "Aria relayer: logEvent only",
    chain_type: "ethereum",
    rules: [
      {
        name: "Allow logEvent on AriaClearing",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          onMonadTestnet(),
          toAddress(input.clearingAddress),
          {
            field_source: "ethereum_calldata",
            field: "function_name",
            abi: functionAbi(input.abi, "logEvent"),
            operator: "eq",
            value: "logEvent",
          },
        ],
      },
    ],
  };
}

function callsFunction(abi: readonly AbiItem[], name: string): Condition {
  return {
    field_source: "ethereum_calldata",
    field: "function_name",
    abi: functionAbi(abi, name),
    operator: "eq",
    value: name,
  };
}

function allowSend(name: string, conditions: Condition[]): Rule {
  return { name, method: "eth_sendTransaction", action: "ALLOW", conditions: [onMonadTestnet(), ...conditions] };
}

/**
 * Allows the treasury only USDC `approve` with AriaClearing as spender, and AriaClearing `createCampaign`,
 * `dispute` and `withdraw`, on Monad testnet. Everything else, including any USDC transfer, falls to default deny.
 */
export function treasuryPolicy(input: { clearingAddress: string; usdcAddress: string }): PolicyBody {
  const clearing = toAddress(input.clearingAddress);
  return {
    version: "1.0",
    name: "Aria treasury: escrow only",
    chain_type: "ethereum",
    rules: [
      allowSend("Allow USDC approve to AriaClearing", [
        toAddress(input.usdcAddress),
        callsFunction(erc20Abi, "approve"),
        {
          field_source: "ethereum_calldata",
          field: "approve.spender",
          abi: functionAbi(erc20Abi, "approve"),
          operator: "eq",
          value: normalizeAddress(input.clearingAddress),
        },
      ]),
      allowSend("Allow createCampaign on AriaClearing", [clearing, callsFunction(ariaClearingAbi, "createCampaign")]),
      allowSend("Allow dispute on AriaClearing", [clearing, callsFunction(ariaClearingAbi, "dispute")]),
      allowSend("Allow withdraw on AriaClearing", [clearing, callsFunction(ariaClearingAbi, "withdraw")]),
    ],
  };
}

/** Allows only transactions to `recipient` on Monad testnet, for both send and sign-only requests. */
export function testTransferPolicy(input: { recipient: string }): PolicyBody {
  const conditions = [onMonadTestnet(), toAddress(input.recipient)];
  return {
    version: "1.0",
    name: "Aria policy probe: transfers to deployer only",
    chain_type: "ethereum",
    rules: [
      { name: "Allow send to recipient", method: "eth_sendTransaction", action: "ALLOW", conditions },
      { name: "Allow sign to recipient", method: "eth_signTransaction", action: "ALLOW", conditions },
    ],
  };
}
