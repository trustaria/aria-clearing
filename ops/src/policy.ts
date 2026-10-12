import type { AbiSchema, PolicyCreateParams } from "@privy-io/node/resources";

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_TESTNET_CAIP2 = `eip155:${MONAD_TESTNET_CHAIN_ID}`;

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
